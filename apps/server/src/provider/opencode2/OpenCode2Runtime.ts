import { OpenCode, type V2Event } from "@opencode/client";
import type { OpenCodeSettings } from "@t3tools/contracts";
import { parseSemver } from "@t3tools/shared/semver";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { OpenCodeRuntime, OpenCodeRuntimeError } from "../opencodeRuntime.ts";

export type OpenCode2Client = ReturnType<typeof OpenCode.make>;
export interface OpenCode2Connection {
  readonly client: OpenCode2Client;
  readonly version: string;
  readonly external: boolean;
  /** Opens the stream before returning, so prompts cannot outrun subscription. */
  readonly subscribe: Effect.Effect<
    Stream.Stream<V2Event, OpenCodeRuntimeError>,
    OpenCodeRuntimeError,
    Scope.Scope
  >;
}
export interface OpenCode2Runtime {
  readonly acquire: Effect.Effect<OpenCode2Connection, OpenCodeRuntimeError, Scope.Scope>;
}

export const runOpenCode2 = <A>(operation: string, run: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) =>
      new OpenCodeRuntimeError({ operation, detail: `OpenCode 2 ${operation} failed.`, cause }),
  });

export function requireOpenCode2Version(output: string): string | undefined {
  const version = /\bv?(\d+\.\d+\.\d+)\b/.exec(output)?.[1];
  const parsed = version ? parseSemver(version) : undefined;
  return parsed?.major === 2 ? (version ?? undefined) : undefined;
}

/** One authenticated server per instance, released when its last caller leaves. */
export const makeOpenCode2Runtime = Effect.fn("makeOpenCode2Runtime")(function* (
  settings: OpenCodeSettings,
  environment: NodeJS.ProcessEnv,
) {
  const native = yield* OpenCodeRuntime;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const crypto = yield* Crypto.Crypto;
  const mutex = yield* Semaphore.make(1);
  let shared:
    | { connection: OpenCode2Connection; scope: Scope.Closeable; borrowers: number }
    | undefined;

  const connect = Effect.fn("OpenCode2Runtime.connect")(function* () {
    let url = settings.serverUrl.trim();
    const external = url.length > 0;
    let password = settings.serverPassword;
    if (!external) {
      const probe = yield* native
        .runOpenCodeCommand({
          binaryPath: settings.binaryPath,
          args: ["--version"],
          environment,
        })
        .pipe(
          Effect.timeout("5 seconds"),
          Effect.mapError(
            (cause) =>
              new OpenCodeRuntimeError({
                operation: "version",
                detail: "OpenCode 2 version check failed or timed out.",
                cause,
              }),
          ),
        );
      if (probe.code !== 0 || !requireOpenCode2Version(probe.stdout))
        return yield* new OpenCodeRuntimeError({
          operation: "version",
          detail:
            "Test Rig requires OpenCode 2. Install a supported 2.x executable; OpenCode 1 is not supported.",
        });
      password = Buffer.from(yield* crypto.randomBytes(32).pipe(Effect.orDie)).toString(
        "base64url",
      );
      const { OPENCODE_SERVER_PASSWORD: _oldPassword, ...inherited } = environment;
      const spawn = yield* resolveSpawnCommand(
        settings.binaryPath,
        ["serve", "--hostname=127.0.0.1", "--port=0"],
        { env: inherited },
      );
      const child = yield* spawner
        .spawn(
          ChildProcess.make(spawn.command, spawn.args, {
            shell: spawn.shell,
            env: { ...inherited, OPENCODE_PASSWORD: password },
            extendEnv: false,
          }),
        )
        .pipe(
          Effect.mapError(
            (cause) =>
              new OpenCodeRuntimeError({
                operation: "spawn",
                detail: "Could not start the OpenCode 2 server.",
                cause,
              }),
          ),
        );
      const listening = yield* Deferred.make<string, OpenCodeRuntimeError>();
      const read = (stream: typeof child.stdout) =>
        stream.pipe(
          Stream.decodeText(),
          Stream.splitLines,
          Stream.runForEach((line) => {
            const match = /server listening on\s+(https?:\/\/[^\s]+)/i.exec(line);
            return match?.[1] ? Deferred.succeed(listening, match[1]) : Effect.void;
          }),
          Effect.catch(() => Effect.void),
          Effect.forkScoped,
        );
      yield* read(child.stdout);
      yield* read(child.stderr);
      yield* child.exitCode.pipe(
        Effect.flatMap(() =>
          Deferred.fail(
            listening,
            new OpenCodeRuntimeError({
              operation: "spawn",
              detail: "OpenCode 2 exited before becoming ready.",
            }),
          ),
        ),
        Effect.forkScoped,
      );
      url = yield* Deferred.await(listening).pipe(
        Effect.timeoutOrElse({
          duration: "30 seconds",
          orElse: () =>
            new OpenCodeRuntimeError({
              operation: "spawn",
              detail: "OpenCode 2 did not become ready in time.",
            }),
        }),
      );
    }
    const headers = {
      Authorization: `Basic ${Buffer.from(`opencode:${password}`, "utf8").toString("base64")}`,
    };
    const client = OpenCode.make({ baseUrl: url, headers });
    const info = yield* runOpenCode2("server.info", (signal) =>
      client.server.info({ signal }),
    ).pipe(
      Effect.timeout("5 seconds"),
      Effect.mapError(
        (cause) =>
          new OpenCodeRuntimeError({
            operation: "server.info",
            detail: "Could not verify the OpenCode 2 server. Check its version, URL, and password.",
            cause,
          }),
      ),
    );
    if (!requireOpenCode2Version(info.version))
      return yield* new OpenCodeRuntimeError({
        operation: "version",
        detail: "The configured server is not a supported OpenCode 2 server.",
      });
    return {
      client,
      version: info.version,
      external,
      subscribe: Effect.gen(function* () {
        const controller = new AbortController();
        yield* Effect.addFinalizer(() => Effect.sync(() => controller.abort()));
        const subscription = client.event.subscribe({ signal: controller.signal });
        const iterator = subscription[Symbol.asyncIterator]();
        const first = yield* runOpenCode2("event.subscribe", () => iterator.next()).pipe(
          Effect.timeout("10 seconds"),
          Effect.mapError(
            (cause) =>
              new OpenCodeRuntimeError({
                operation: "event.subscribe",
                detail: "Could not subscribe to OpenCode 2 events.",
                cause,
              }),
          ),
        );
        if (first.done)
          return yield* new OpenCodeRuntimeError({
            operation: "event.subscribe",
            detail: "OpenCode 2 closed its event stream.",
          });
        const source = { [Symbol.asyncIterator]: () => iterator };
        return Stream.concat(
          Stream.make(first.value),
          Stream.fromAsyncIterable(
            source,
            (cause) =>
              new OpenCodeRuntimeError({
                operation: "events",
                detail: "The OpenCode 2 event stream was lost.",
                cause,
              }),
          ),
        );
      }),
    } satisfies OpenCode2Connection;
  });

  const acquire = Effect.acquireRelease(
    mutex.withPermit(
      Effect.gen(function* () {
        if (shared) {
          shared.borrowers++;
          return shared;
        }
        const scope = yield* Scope.make();
        const connection = yield* connect().pipe(
          Effect.provideService(Scope.Scope, scope),
          Effect.onError((cause) => Scope.close(scope, Exit.failCause(cause))),
        );
        shared = { connection, scope, borrowers: 1 };
        return shared;
      }),
    ),
    (lease) =>
      mutex.withPermit(
        Effect.gen(function* () {
          lease.borrowers--;
          if (lease.borrowers !== 0) return;
          if (shared === lease) shared = undefined;
          yield* Scope.close(lease.scope, Exit.void);
        }),
      ),
  ).pipe(Effect.map((lease) => lease.connection));
  yield* Effect.addFinalizer(() =>
    mutex.withPermit(
      Effect.gen(function* () {
        const last = shared;
        shared = undefined;
        if (last) yield* Scope.close(last.scope, Exit.void);
      }),
    ),
  );
  return { acquire } satisfies OpenCode2Runtime;
});
