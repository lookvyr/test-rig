import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as NetService from "@t3tools/shared/Net";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { signalProcessGroup } from "../process/processGroup.ts";
import * as OpenCodeServerLedger from "./OpenCodeServerLedger.ts";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as P from "effect/Predicate";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import { isWindowsCommandNotFound } from "../processRunner.ts";
import { collectStreamAsString } from "./providerSnapshot.ts";

export function resolveOpenCodeConfigContent(
  inputEnvironment: Readonly<Record<string, string | undefined>> | undefined,
  inheritedEnvironment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return (
    inputEnvironment?.OPENCODE_CONFIG_CONTENT ??
    inheritedEnvironment.OPENCODE_CONFIG_CONTENT ??
    "{}"
  );
}

export function resolveOpenCodeServerPassword(
  input: {
    readonly external: boolean;
    readonly serverPassword?: string;
    readonly environment?: Readonly<Record<string, string | undefined>>;
  },
  inheritedEnvironment: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  if (input.serverPassword !== undefined) {
    return input.serverPassword;
  }
  if (input.external) {
    return undefined;
  }
  return input.environment === undefined
    ? inheritedEnvironment.OPENCODE_SERVER_PASSWORD
    : input.environment.OPENCODE_SERVER_PASSWORD;
}

const DEFAULT_OPENCODE_SERVER_TIMEOUT_MS = 30_000;
const DEFAULT_HOSTNAME = "127.0.0.1";
const OPENCODE_SERVER_STARTUP_MAX_OUTPUT_CHARS = 64 * 1024;
export interface OpenCodeServerProcess {
  readonly url: string;
  readonly serverPassword?: string;
  readonly version: string;
  readonly isRunning: Effect.Effect<boolean>;
  readonly exitCode: Effect.Effect<number, never>;
}

const OPENCODE_RUNTIME_ERROR_TAG = "OpenCodeRuntimeError";
export class OpenCodeRuntimeError extends Data.TaggedError(OPENCODE_RUNTIME_ERROR_TAG)<{
  readonly operation: string;
  readonly cause?: unknown;
  readonly detail: string;
}> {
  static readonly is = (u: unknown): u is OpenCodeRuntimeError =>
    P.isTagged(u, OPENCODE_RUNTIME_ERROR_TAG);
}

export function openCodeRuntimeErrorDetail(cause: unknown): string {
  return OpenCodeRuntimeError.is(cause)
    ? cause.detail
    : "OpenCode 2 is unavailable. Check the executable or configured server.";
}
export interface OpenCodeCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}
export interface ParsedOpenCodeModelSlug {
  readonly providerID: string;
  readonly modelID: string;
}
export interface OpenCodeRuntimeShape {
  readonly startOpenCodeServerProcess: (input: {
    readonly binaryPath: string;
    readonly directory: string;
    readonly serverPassword?: string;
    readonly environment?: NodeJS.ProcessEnv;
    readonly port?: number;
    readonly hostname?: string;
    readonly timeoutMs?: number;
    /** Checks the listening server and returns its version. Required for the supported OpenCode 2 transport. */
    readonly verify: (url: string) => Effect.Effect<string, OpenCodeRuntimeError>;
  }) => Effect.Effect<OpenCodeServerProcess, OpenCodeRuntimeError, Scope.Scope>;
  readonly runOpenCodeCommand: (input: {
    readonly binaryPath: string;
    readonly args: ReadonlyArray<string>;
    readonly environment?: NodeJS.ProcessEnv;
  }) => Effect.Effect<OpenCodeCommandResult, OpenCodeRuntimeError>;
}
export function parseOpenCodeModelSlug(
  slug: string | null | undefined,
): ParsedOpenCodeModelSlug | null {
  if (typeof slug !== "string") {
    return null;
  }

  const trimmed = slug.trim();
  const separator = trimmed.indexOf("/");
  if (separator <= 0 || separator === trimmed.length - 1) {
    return null;
  }

  return {
    providerID: trimmed.slice(0, separator),
    modelID: trimmed.slice(separator + 1),
  };
}

function parseServerUrlFromOutput(output: string): string | null {
  for (const line of output.split("\n")) {
    const match = line.match(/server listening on\s+(https?:\/\/[^\s]+)/i);
    if (match?.[1]) return match[1];
  }
  return null;
}

function ensureRuntimeError(
  operation: OpenCodeRuntimeError["operation"],
  detail: string,
  cause: unknown,
): OpenCodeRuntimeError {
  return OpenCodeRuntimeError.is(cause)
    ? cause
    : new OpenCodeRuntimeError({ operation, detail, cause });
}

const makeOpenCodeRuntime = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const netService = yield* NetService.NetService;
  const hostPlatform = yield* HostProcessPlatform;
  const serverLedger = yield* OpenCodeServerLedger.OpenCodeServerLedger;
  const resolveCommand = (command: string, args: ReadonlyArray<string>, env?: NodeJS.ProcessEnv) =>
    resolveSpawnCommand(command, args, env ? { env } : {});
  const runOpenCodeCommand: OpenCodeRuntimeShape["runOpenCodeCommand"] = (input) =>
    Effect.gen(function* () {
      const spawnCommand = yield* resolveCommand(input.binaryPath, input.args, input.environment);
      const child = yield* spawner.spawn(
        ChildProcess.make(spawnCommand.command, spawnCommand.args, {
          shell: spawnCommand.shell,
          ...(input.environment ? { env: input.environment } : { extendEnv: true }),
        }),
      );
      const [stdout, stderr, code] = yield* Effect.all(
        [collectStreamAsString(child.stdout), collectStreamAsString(child.stderr), child.exitCode],
        { concurrency: "unbounded" },
      );
      const exitCode = Number(code);
      if (yield* isWindowsCommandNotFound(exitCode, stderr)) {
        return yield* new OpenCodeRuntimeError({
          operation: "runOpenCodeCommand",
          detail: `spawn ${input.binaryPath} ENOENT`,
        });
      }
      return {
        stdout,
        stderr,
        code: exitCode,
      } satisfies OpenCodeCommandResult;
    }).pipe(
      Effect.scoped,
      Effect.mapError(
        (cause) =>
          new OpenCodeRuntimeError({
            operation: "runOpenCodeCommand",
            detail: "Could not execute the configured OpenCode executable.",
            cause,
          }),
      ),
    );

  const startOpenCodeServerProcess: OpenCodeRuntimeShape["startOpenCodeServerProcess"] = (input) =>
    Effect.gen(function* () {
      // Bind this server's lifetime to the caller's scope. When the caller's
      // scope closes, the spawned child is killed and all associated fibers
      // are interrupted automatically — no `close()` method needed.
      const runtimeScope = yield* Scope.Scope;

      const hostname = input.hostname ?? DEFAULT_HOSTNAME;
      const port =
        input.port ??
        (yield* netService.findAvailablePort(0).pipe(
          Effect.mapError(
            (cause) =>
              new OpenCodeRuntimeError({
                operation: "startOpenCodeServerProcess",
                detail: `Failed to find available port: ${openCodeRuntimeErrorDetail(cause)}`,
                cause,
              }),
          ),
        ));
      const timeoutMs = input.timeoutMs ?? DEFAULT_OPENCODE_SERVER_TIMEOUT_MS;
      const args = ["serve", `--hostname=${hostname}`, `--port=${port}`];
      const spawnCommand = yield* resolveCommand(input.binaryPath, args, input.environment);
      const serverPassword = resolveOpenCodeServerPassword({
        external: false,
        ...(input.serverPassword !== undefined ? { serverPassword: input.serverPassword } : {}),
        ...(input.environment !== undefined ? { environment: input.environment } : {}),
      });

      // Scopes close in reverse order. Forking this before the group kill is
      // registered forgets the ledger entry only once the group is stopped.
      const ledgerScope = yield* Scope.fork(runtimeScope);
      const child = yield* spawner
        .spawn(
          ChildProcess.make(spawnCommand.command, spawnCommand.args, {
            detached: hostPlatform !== "win32",
            shell: spawnCommand.shell,
            env: {
              ...input.environment,
              ...(serverPassword !== undefined ? { OPENCODE_SERVER_PASSWORD: serverPassword } : {}),
              // Respect an OPENCODE_CONFIG_CONTENT provided by the caller or
              // the inherited process environment, only falling back to the
              // empty config when neither is set. Setting it unconditionally
              // previously clobbered the user's opencode config, hiding their
              // providers/models. The value is set explicitly (rather than
              // relying on inheritance) because `extendEnv` is false whenever
              // `input.environment` is provided.
              OPENCODE_CONFIG_CONTENT: resolveOpenCodeConfigContent(input.environment),
            },
            extendEnv: input.environment === undefined,
          }),
        )
        .pipe(
          Effect.provideService(Scope.Scope, runtimeScope),
          Effect.mapError(
            (cause) =>
              new OpenCodeRuntimeError({
                operation: "startOpenCodeServerProcess",
                detail: `Failed to spawn OpenCode server process: ${openCodeRuntimeErrorDetail(cause)}`,
                cause,
              }),
          ),
        );

      const killOpenCodeProcessGroup = (signal: NodeJS.Signals) =>
        hostPlatform === "win32"
          ? child.kill({ killSignal: signal, forceKillAfter: "1 second" }).pipe(Effect.asVoid)
          : Effect.sync(() => {
              try {
                signalProcessGroup(Number(child.pid), signal);
              } catch {
                // The direct child may already have exited after starting the
                // server; the process group kill is best-effort cleanup for
                // any serve process left in that group.
              }
            });
      const terminateChild = killOpenCodeProcessGroup("SIGTERM").pipe(
        Effect.andThen(Effect.sleep("1 second")),
        Effect.andThen(killOpenCodeProcessGroup("SIGKILL")),
        Effect.ignore,
      );
      // Registered before recording, so an interrupt while the ledger writes
      // still stops the group.
      yield* Scope.addFinalizer(runtimeScope, terminateChild);
      const forgetServer = yield* serverLedger.track({ pid: Number(child.pid), port, args });
      yield* Scope.addFinalizer(ledgerScope, forgetServer);

      const stdoutRef = yield* Ref.make<string | null>("");
      const stderrRef = yield* Ref.make<string | null>("");
      const readyDeferred = yield* Deferred.make<string, OpenCodeRuntimeError>();

      const setReadyFromChunk = (output: Ref.Ref<string | null>) => (chunk: string) =>
        Ref.modify(output, (stdout) => {
          if (stdout === null) {
            return [null, null] as const;
          }
          const nextStdout = `${stdout}${chunk}`;
          return [
            parseServerUrlFromOutput(nextStdout),
            nextStdout.slice(-OPENCODE_SERVER_STARTUP_MAX_OUTPUT_CHARS),
          ] as const;
        }).pipe(
          Effect.flatMap((parsed) =>
            parsed ? Deferred.succeed(readyDeferred, parsed).pipe(Effect.ignore) : Effect.void,
          ),
        );

      const stdoutFiber = yield* child.stdout.pipe(
        Stream.decodeText(),
        Stream.runForEach(setReadyFromChunk(stdoutRef)),
        Effect.ignore,
        Effect.forkIn(runtimeScope),
      );
      const stderrFiber = yield* child.stderr.pipe(
        Stream.decodeText(),
        Stream.runForEach(setReadyFromChunk(stderrRef)),
        Effect.ignore,
        Effect.forkIn(runtimeScope),
      );

      const exitFiber = yield* child.exitCode.pipe(
        Effect.flatMap((code) =>
          Effect.gen(function* () {
            const stdout = (yield* Ref.get(stdoutRef)) ?? "";
            const stderr = (yield* Ref.get(stderrRef)) ?? "";
            const exitCode = Number(code);
            yield* Deferred.fail(
              readyDeferred,
              new OpenCodeRuntimeError({
                operation: "startOpenCodeServerProcess",
                detail: [
                  `OpenCode server exited before startup completed (code: ${String(exitCode)}).`,
                  stdout.trim() ? `stdout:\n${stdout.trim()}` : null,
                  stderr.trim() ? `stderr:\n${stderr.trim()}` : null,
                ]
                  .filter(Boolean)
                  .join("\n\n"),
                cause: { exitCode, stdout, stderr },
              }),
            ).pipe(Effect.ignore);
          }),
        ),
        Effect.catch((cause) =>
          Deferred.fail(
            readyDeferred,
            new OpenCodeRuntimeError({
              operation: "startOpenCodeServerProcess",
              detail: `OpenCode server stopped before startup completed: ${cause.cause instanceof Error ? cause.cause.message : cause.message}`,
              cause,
            }),
          ).pipe(Effect.ignore),
        ),
        Effect.forkIn(runtimeScope),
      );

      const readyExit = yield* Effect.exit(
        Deferred.await(readyDeferred).pipe(Effect.timeoutOption(timeoutMs)),
      );

      if (Exit.isFailure(readyExit) || Option.isNone(readyExit.value)) {
        yield* Fiber.interruptAll([stdoutFiber, stderrFiber, exitFiber]).pipe(Effect.ignore);
      }

      if (Exit.isFailure(readyExit)) {
        const squashed = Cause.squash(readyExit.cause);
        return yield* ensureRuntimeError(
          "startOpenCodeServerProcess",
          `Failed while waiting for OpenCode server startup: ${openCodeRuntimeErrorDetail(squashed)}`,
          squashed,
        );
      }

      const readyOption = readyExit.value;
      if (Option.isNone(readyOption)) {
        return yield* new OpenCodeRuntimeError({
          operation: "startOpenCodeServerProcess",
          detail: `Timed out waiting for OpenCode server start after ${timeoutMs}ms.`,
        });
      }

      // Keep draining both pipes until the process scope closes. Stopping the
      // readers can block OpenCode when its output buffers fill. Startup output
      // is no longer needed, so discard later output instead of retaining it.
      yield* Ref.set(stdoutRef, null);
      yield* Ref.set(stderrRef, null);

      const url = readyOption.value;
      const version = yield* input.verify(url);

      return {
        url,
        ...(serverPassword !== undefined ? { serverPassword } : {}),
        version,
        isRunning: child.isRunning.pipe(Effect.orElseSucceed(() => false)),
        exitCode: child.exitCode.pipe(
          Effect.map(Number),
          Effect.orElseSucceed(() => 0),
        ),
      } satisfies OpenCodeServerProcess;
    });

  return { runOpenCodeCommand, startOpenCodeServerProcess } satisfies OpenCodeRuntimeShape;
});
export class OpenCodeRuntime extends Context.Service<OpenCodeRuntime, OpenCodeRuntimeShape>()(
  "t3/provider/opencodeRuntime",
) {}
export const OpenCodeRuntimeLayer = Layer.effect(OpenCodeRuntime, makeOpenCodeRuntime).pipe(
  Layer.provide(NetService.layer),
);
export const OpenCodeRuntimeLive = OpenCodeRuntimeLayer.pipe(
  Layer.provide(OpenCodeServerLedger.layer),
);
