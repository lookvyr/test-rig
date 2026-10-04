import { CheckpointId, CheckpointScopeId, ProviderThreadId, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

export const ROLLBACK_FAILED_MESSAGE =
  "Conversation rewind is not supported. Fork from an earlier response instead.";

export class CheckpointRollbackExecutionError extends Schema.TaggedError<CheckpointRollbackExecutionError>()(
  "CheckpointRollbackExecutionError",
  {
    threadId: ThreadId,
    providerThreadId: ProviderThreadId,
    checkpointId: CheckpointId,
  },
) {
  override get message(): string {
    return ROLLBACK_FAILED_MESSAGE;
  }
}

export interface CheckpointRollbackServiceV2Shape {
  readonly execute: (input: {
    readonly threadId: ThreadId;
    readonly providerThreadId: ProviderThreadId;
    readonly checkpointId: CheckpointId;
    readonly scopeId: CheckpointScopeId;
    readonly restoreFiles?: boolean;
  }) => Effect.Effect<void, CheckpointRollbackExecutionError>;
}

export class CheckpointRollbackServiceV2 extends Context.Service<
  CheckpointRollbackServiceV2,
  CheckpointRollbackServiceV2Shape
>()("t3/orchestration-v2/CheckpointRollbackService/CheckpointRollbackServiceV2") {}

// Old outbox records remain readable, but cannot rewind providers or restore files.
export const layer = Layer.succeed(CheckpointRollbackServiceV2, {
  execute: (input) =>
    Effect.fail(
      new CheckpointRollbackExecutionError({
        threadId: input.threadId,
        providerThreadId: input.providerThreadId,
        checkpointId: input.checkpointId,
      }),
    ),
});
