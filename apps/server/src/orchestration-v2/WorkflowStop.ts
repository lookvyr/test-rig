import {
  OrchestrationV2StopWorkflowError,
  type OrchestrationV2StopWorkflowInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as Orchestrator from "./Orchestrator.ts";
import * as ProviderSessionManager from "./ProviderSessionManager.ts";

/**
 * Stops one running provider-native workflow (Claude's Workflow tool) without
 * ending the turn that launched it. The provider settles the workflow through
 * its own task notification, so nothing is written here.
 */
export const stopWorkflow = Effect.fn("orchestrationV2.stopWorkflow")(function* (
  input: OrchestrationV2StopWorkflowInput,
) {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const sessions = yield* ProviderSessionManager.ProviderSessionManagerV2;
  const fail = (reason: OrchestrationV2StopWorkflowError["reason"], cause?: unknown) =>
    new OrchestrationV2StopWorkflowError({
      threadId: input.threadId,
      subagentId: input.subagentId,
      reason,
      ...(cause === undefined ? {} : { cause }),
    });
  const records = yield* orchestrator
    .getThreadRecords(input.threadId, ["subagents", "runs", "providerThreads"])
    .pipe(Effect.mapError((cause) => fail("unavailable", cause)));
  if (records.thread.deletedAt !== null) return yield* fail("unavailable");
  const task = records.subagents.find((candidate) => candidate.id === input.subagentId);
  if (
    task === undefined ||
    task.threadId !== input.threadId ||
    task.workflow === undefined ||
    task.status !== "running"
  ) {
    return yield* fail("not-running");
  }
  if (task.origin !== "provider_native" || task.driver !== "claudeAgent") {
    return yield* fail("unsupported");
  }
  const providerThreadId =
    task.providerThreadId ?? records.runs.find((run) => run.id === task.runId)?.providerThreadId;
  const providerThread = records.providerThreads.find(
    (candidate) =>
      candidate.id === providerThreadId &&
      candidate.appThreadId === input.threadId &&
      candidate.providerInstanceId === task.providerInstanceId &&
      candidate.driver === task.driver,
  );
  const taskId = task.nativeTaskRef?.nativeId;
  if (providerThread?.providerSessionId == null || taskId == null || taskId.length === 0) {
    return yield* fail("unavailable");
  }
  const runtime = yield* sessions
    .get(providerThread.providerSessionId)
    .pipe(Effect.mapError((cause) => fail("unavailable", cause)));
  if (Option.isNone(runtime)) return yield* fail("unavailable");
  if (runtime.value.stopTask === undefined) return yield* fail("unsupported");
  // Bounded so a provider that never answers cannot hold the request open.
  yield* runtime.value.stopTask({ providerThread, taskId }).pipe(
    Effect.timeout("15 seconds"),
    Effect.mapError((cause) => fail("stop-failed", cause)),
  );
});
