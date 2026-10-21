import {
  CommandId,
  MessageId,
  type ProviderInstanceId,
  type RunId,
  resolveProviderInstanceEnabled,
  type ServerSettings as ServerSettingsValue,
  type ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Stream from "effect/Stream";

import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";
import { idleCompactionWindow } from "./IdleCompaction.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

// Longest single wait. A timer's countdown can pause while the machine sleeps, so
// waiting in short steps against the wall clock keeps a short sleep from making
// the compaction fire after the cache has already expired.
const MAX_WAIT_STEP_MS = 60_000;

function providerInstanceEnabled(
  settings: Pick<ServerSettingsValue, "providerInstances">,
  instanceId: ProviderInstanceId,
): boolean {
  const config = Object.hasOwn(settings.providerInstances, instanceId)
    ? settings.providerInstances[instanceId]
    : undefined;
  return config === undefined || resolveProviderInstanceEnabled(config);
}

const sleepUntil = Effect.fnUntraced(function* (targetMs: number) {
  while (true) {
    const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
    if (nowMs >= targetMs) return;
    yield* Effect.sleep(Duration.millis(Math.min(targetMs - nowMs, MAX_WAIT_STEP_MS)));
  }
});

/**
 * Opt-in: when a Claude run completes, waits until shortly before its prompt
 * cache expires and sends `/compact` as a visible Test Rig turn. Waits live in
 * memory, so a server restart skips compactions that were still waiting.
 */
export const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const settings = yield* ServerSettings.ServerSettingsService;

  const compactWhenDue = Effect.fn("IdleCompactionService.compactWhenDue")(
    function* (threadId: ThreadId, runId: RunId) {
      // Loops once after the wait: the thread may have moved on.
      while (true) {
        const current = yield* settings.getSettings;
        if (!current.compactIdleThreads) return;
        const records = yield* projections.getThreadRecords(
          threadId,
          [
            "runs",
            "messages",
            "providerThreads",
            "providerTurns",
            "runtimeRequests",
            "turnItems",
            "contextTransfers",
          ],
          { messageRunIds: [runId], turnItemStatuses: ["pending", "running", "waiting"] },
        );
        if (!providerInstanceEnabled(current, records.thread.providerInstanceId)) return;
        const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
        const window = idleCompactionWindow(records, nowMs);
        if (window?.runId !== runId) return;
        if (nowMs < window.startMs) {
          yield* sleepUntil(window.startMs);
          continue;
        }
        yield* orchestrator.dispatch({
          type: "message.dispatch",
          // One compaction per completed run, even across duplicate events.
          commandId: CommandId.make(`server:idle-compact:${threadId}:${runId}`),
          messageId: MessageId.make(`idle-compact:${threadId}:${runId}`),
          threadId,
          text: "/compact",
          attachments: [],
          createdBy: "agent",
          creationSource: "server",
          dispatchMode: { type: "start_immediately" },
        });
        return;
      }
    },
    (effect, threadId) =>
      effect.pipe(
        Effect.catch((cause) => Effect.logWarning("idle compaction skipped", { threadId, cause })),
      ),
  );

  const start = Effect.fn("IdleCompactionService.start")(function* () {
    // Keyed by thread: a newer completed run replaces the waiting timer.
    const timers = yield* FiberMap.make<ThreadId>();
    yield* forkParked(
      Stream.runForEach(orchestrator.streamDomainEvents, (event) =>
        event.type === "run.updated" && event.payload.status === "completed"
          ? FiberMap.run(timers, event.threadId, compactWhenDue(event.threadId, event.payload.id))
          : Effect.void,
      ),
    );
  });
  return { start };
});
