import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { ProviderAdapterRequestError, type ProviderAdapterError } from "../Errors.ts";

export interface ClaudeForkSessionInput {
  readonly sessionId: string;
  readonly cwd: string;
  readonly upToMessageId?: string;
  readonly afterMessageId?: string;
}

// The SDK's session helpers read CLAUDE_CONFIG_DIR from process.env. A short-lived
// process keeps concurrent provider instances isolated without changing our env.
const FORK_SCRIPT = `
try {
  const { forkSession, getSessionMessages, importSessionToStore } = await import(process.argv[1]);
  const sessionId = process.argv[2];
  const dir = process.argv[3];
  let upToMessageId = process.argv[4] || undefined;
  const afterMessageId = process.argv[5] || undefined;
  if (!upToMessageId) {
    const messages = await getSessionMessages(sessionId, { dir, includeSystemMessages: true });
    upToMessageId = messages.at(-1)?.uuid;
    if (!upToMessageId) throw new Error("The source conversation has no saved messages.");
  }
  if (afterMessageId) {
    // Queued prompts are native attachments, hidden by getSessionMessages.
    // Let the SDK locate/read the transcript; retain only inclusion metadata.
    const entries = [];
    await importSessionToStore(sessionId, {
      append: async (_key, batch) => {
        for (const entry of batch) {
          if (typeof entry.uuid !== "string" || entry.isSidechain ||
              !["user", "assistant", "system", "attachment", "progress"].includes(entry.type)) continue;
          entries.push({
            uuid: entry.uuid,
            parentUuid: entry.parentUuid,
            requestId: entry.type === "attachment" && entry.attachment?.type === "queued_command"
              ? entry.attachment.source_uuid : undefined,
          });
        }
      },
      load: async () => null,
    }, { dir, includeSubagents: false });
    const resolve = (id) => entries.find((entry) => entry.uuid === id)
      ?? entries.find((entry) => entry.requestId === id);
    const boundary = resolve(upToMessageId);
    const required = resolve(afterMessageId);
    // Native forkSession copies the prefix ending at the first boundary UUID.
    // A request elsewhere in the file need not belong to that conversation.
    const boundaryOffset = entries.findIndex((entry) => entry === boundary);
    const ancestors = new Map(entries.slice(0, boundaryOffset + 1).map((entry) => [entry.uuid, entry]));
    const visited = new Set();
    let entry = boundary;
    while (entry && entry.uuid !== required?.uuid && !visited.has(entry.uuid)) {
      visited.add(entry.uuid);
      entry = ancestors.get(entry.parentUuid);
    }
    if (!entry || !required || entry.uuid !== required.uuid) {
      throw new Error("The latest parent request is not saved at the requested fork boundary yet.");
    }
    upToMessageId = boundary.uuid;
  }
  const result = await forkSession(sessionId, { dir, upToMessageId });
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
`;

const decodeForkResult = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ sessionId: Schema.String.check(Schema.isUUID()) })),
);

export const makeClaudeSessionForker = Effect.fn("makeClaudeSessionForker")(function* (
  environment: NodeJS.ProcessEnv,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const sdkUrl = import.meta.resolve("@anthropic-ai/claude-agent-sdk");

  return Effect.fn("forkClaudeSession")(function* (
    input: ClaudeForkSessionInput,
  ): Effect.fn.Return<string, ProviderAdapterError> {
    const result = yield* Effect.gen(function* () {
      const child = yield* spawner.spawn(
        ChildProcess.make(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            FORK_SCRIPT,
            sdkUrl,
            input.sessionId,
            input.cwd,
            input.upToMessageId ?? "",
            input.afterMessageId ?? "",
          ],
          {
            cwd: input.cwd,
            env: { ...environment, ELECTRON_RUN_AS_NODE: "1" },
            extendEnv: false,
          },
        ),
      );
      return yield* Effect.all(
        {
          stdout: child.stdout.pipe(Stream.decodeText(), Stream.mkString),
          stderr: child.stderr.pipe(Stream.decodeText(), Stream.mkString),
          exitCode: child.exitCode,
        },
        { concurrency: "unbounded" },
      );
    }).pipe(
      Effect.scoped,
      Effect.mapError(
        (cause) =>
          new ProviderAdapterRequestError({
            provider: "claudeAgent",
            method: "forkSession",
            detail: "Failed to run the Claude session fork helper.",
            cause,
          }),
      ),
    );
    if (result.exitCode !== 0) {
      return yield* new ProviderAdapterRequestError({
        provider: "claudeAgent",
        method: "forkSession",
        detail: result.stderr.trim() || "The Claude session fork helper failed.",
      });
    }
    const fork = yield* decodeForkResult(result.stdout).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderAdapterRequestError({
            provider: "claudeAgent",
            method: "forkSession",
            detail: "The Claude session fork helper returned an invalid session id.",
            cause,
          }),
      ),
    );
    if (fork.sessionId === input.sessionId) {
      return yield* new ProviderAdapterRequestError({
        provider: "claudeAgent",
        method: "forkSession",
        detail: "The Claude session fork helper did not create a new conversation.",
      });
    }
    return fork.sessionId;
  });
});
