import { CommandId, ProviderSessionId, type ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { ProviderSessionManagerV2 } from "./ProviderSessionManager.ts";
import { RuntimePolicyV2 } from "./RuntimePolicy.ts";
import { ThreadManagementService } from "./ThreadManagementService.ts";

class SideChatContextUnavailable extends Schema.TaggedError<SideChatContextUnavailable>()(
  "SideChatContextUnavailable",
  {},
) {}

/** Capture native context once, at open time. A failed fork must never retry against a later parent. */
export const openSideChat = Effect.fn("orchestrationV2.openSideChat")(function* (input: {
  readonly commandId: CommandId;
  readonly parentThreadId: ThreadId;
  readonly sideThreadId: ThreadId;
}) {
  const threads = yield* ThreadManagementService;
  const sessions = yield* ProviderSessionManagerV2;
  const policy = yield* RuntimePolicyV2;
  const childSessionId = ProviderSessionId.make(`side-open:${input.commandId}`);
  const capture = Effect.gen(function* () {
    const child = yield* threads.getThreadRecords(input.sideThreadId, ["providerThreads"]);
    if (child.thread.deletedAt !== null || child.thread.sideOfThreadId !== input.parentThreadId)
      return;
    const pending = child.providerThreads.find(
      (row) => row.id === child.thread.activeProviderThreadId,
    );
    if (pending?.status !== "not_loaded" || pending.forkedFrom === null) return;
    const parent = yield* threads.getThreadRecords(input.parentThreadId, [
      "providerThreads",
      "providerTurns",
    ]);
    const source = parent.providerThreads.find(
      (row) => row.id === pending.forkedFrom?.providerThreadId,
    );
    if (parent.thread.deletedAt !== null || source?.nativeThreadRef?.strength !== "strong") {
      return yield* Effect.fail(new SideChatContextUnavailable({}));
    }
    const sourceProviderTurns = parent.providerTurns.filter(
      (turn) => turn.providerThreadId === source.id,
    );
    const boundary = pending.forkedFrom.providerTurnId;
    const completedTurn =
      boundary === undefined
        ? sourceProviderTurns
            .filter((turn) => turn.status === "completed")
            .sort((a, b) => b.ordinal - a.ordinal)[0]
        : sourceProviderTurns.find((turn) => turn.id === boundary && turn.status === "completed");
    if (completedTurn === undefined) return yield* new SideChatContextUnavailable({});
    const runtimePolicy = yield* policy.resolve({
      thread: child.thread,
      modelSelection: child.thread.modelSelection,
    });
    const temporary = yield* sessions.open({
      threadId: child.thread.id,
      providerSessionId: childSessionId,
      modelSelection: child.thread.modelSelection,
      runtimePolicy,
    });
    return yield* temporary.forkThread({
      sourceProviderThread: source,
      sourceProviderTurns,
      providerTurnId: completedTurn.id,
      targetThreadId: child.thread.id,
      modelSelection: child.thread.modelSelection,
      runtimePolicy,
    });
  }).pipe(Effect.ensuring(sessions.close(childSessionId).pipe(Effect.ignore)));
  const result = yield* Effect.result(capture);
  if (result._tag === "Success" && result.success === undefined) return;
  if (result._tag === "Failure") {
    yield* Effect.logWarning("Native side chat capture failed", {
      threadId: input.sideThreadId,
      cause: result.failure,
    });
  }
  yield* threads.dispatch({
    type: "thread.side.open.complete",
    commandId: CommandId.make(`${input.commandId}:complete`),
    threadId: input.parentThreadId,
    sideThreadId: input.sideThreadId,
    ...(result._tag === "Success"
      ? { providerThread: result.success }
      : {
          error:
            "The provider could not capture this conversation. Discard this side chat and try opening a new one.",
        }),
  });
});
