import { assert, it } from "@effect/vitest";
import { CheckpointId, CheckpointScopeId, ProviderThreadId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as CheckpointRollbackService from "./CheckpointRollbackService.ts";

for (const restoreFiles of [undefined, false, true]) {
  it.effect(`rejects historical rollback effects with restoreFiles=${restoreFiles}`, () =>
    Effect.gen(function* () {
      const service = yield* CheckpointRollbackService.CheckpointRollbackServiceV2;
      const error = yield* service
        .execute({
          threadId: ThreadId.make("thread:legacy-rollback"),
          providerThreadId: ProviderThreadId.make("provider-thread:legacy-rollback"),
          checkpointId: CheckpointId.make("checkpoint:legacy-rollback"),
          scopeId: CheckpointScopeId.make("scope:legacy-rollback"),
          ...(restoreFiles === undefined ? {} : { restoreFiles }),
        })
        .pipe(Effect.flip);

      assert.instanceOf(error, CheckpointRollbackService.CheckpointRollbackExecutionError);
      assert.equal(error.message, CheckpointRollbackService.ROLLBACK_FAILED_MESSAGE);
    }).pipe(Effect.provide(CheckpointRollbackService.layer)),
  );
}
