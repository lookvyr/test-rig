import {
  CommandId,
  IDLE_COMPACTION_TEXT,
  isProviderDriverKind,
  MessageId,
  ProviderDriverKind,
  type ProviderInstanceId,
  resolveIdleCompaction,
  resolveProviderInstanceEnabled,
  type RunId,
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
import { idleCompactionWindow, latestStartedRun } from "./IdleCompaction.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

// Longest single wait. A timer's countdown can pause while the machine sleeps, so
// waiting in short steps against the wall clock keeps a short sleep from making
// the compaction fire after the cache has already expired.
const MAX_WAIT_STEP_MS = 60_000;

// A built-in instance without its own entry follows the older per-provider toggle.
function providerInstanceEnabled(
  settings: Pick<ServerSettingsValue, "providerInstances" | "providers">,
  instanceId: ProviderInstanceId,
): boolean {
  if (Object.hasOwn(settings.providerInstances, instanceId)) {
    return resolveProviderInstanceEnabled(settings.providerInstances[instanceId]!);
  }
  if (!isProviderDriverKind(instanceId)) return true;
  return resolveProviderInstanceEnabled({
    driver: ProviderDriverKind.make(instanceId),
    config: (settings.providers as Record<string, unknown>)[instanceId],
  });
}

// A Claude instance enabled in settings whose idle compaction mode is "beforeCacheExpires".
function compactsBeforeCacheExpires(
  settings: ServerSettingsValue,
  instanceId: ProviderInstanceId,
): boolean {
  const driver = Object.hasOwn(settings.providerInstances, instanceId)
    ? settings.providerInstances[instanceId]?.driver
    : instanceId;
  return (
    driver === "claudeAgent" &&
    resolveIdleCompaction(settings, instanceId) === "beforeCacheExpires" &&
    providerInstanceEnabled(settings, instanceId)
  );
}

const sleepUntil = Effect.fnUntraced(function* (targetMs: number) {
  while (true) {
    const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
    if (nowMs >= targetMs) return;
    yield* Effect.sleep(Duration.millis(Math.min(targetMs - nowMs, MAX_WAIT_STEP_MS)));
  }
});

/**
 * When a run completes on a Claude instance set to compact before the cache
 * expires, waits until shortly before its prompt cache expires and sends
 * `/compact` as a visible Test Rig turn. Waits live in memory, so a server
 * restart skips compactions that were still waiting.
 */
export const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const settings = yield* ServerSettings.ServerSettingsService;

  const compactWhenDue = Effect.fn("IdleCompactionService.compactWhenDue")(
    function* (threadId: ThreadId, completedRunId: RunId) {
      let runId = completedRunId;
      // Loops after the wait or a retarget: the thread may have moved on.
      while (true) {
        const current = yield* settings.getSettings;
        // The thread row alone rules most threads out, before any history is read.
        const thread = yield* projections.getThread(threadId);
        if (!compactsBeforeCacheExpires(current, thread.providerInstanceId)) return;
        const activeProviderThreadIds =
          thread.activeProviderThreadId === null ? [] : [thread.activeProviderThreadId];
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
          {
            messageRunIds: [runId],
            turnItemStatuses: ["pending", "running", "waiting"],
            // The latest run, active runs that hold background work, and rolled-back runs whose
            // items it ignores.
            runStatuses: ["preparing", "starting", "running", "rolled_back"],
            includeLatestRun: true,
            // Without an active provider thread there is no session to compact.
            providerTurnThreadIds: activeProviderThreadIds,
            latestProviderTurnUsageOnly: true,
            runtimeRequestStatuses: ["pending"],
            contextTransferStatuses: ["pending"],
          },
        );
        if (!compactsBeforeCacheExpires(current, records.thread.providerInstanceId)) return;
        const latestRun = latestStartedRun(records.runs);
        // An update for an earlier run replaced the latest run's wait, so take it over.
        if (latestRun?.status === "completed" && latestRun.id !== runId) {
          runId = latestRun.id;
          continue;
        }
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
          text: IDLE_COMPACTION_TEXT,
          attachments: [],
          createdBy: "agent",
          creationSource: "server",
          idleCompaction: "beforeCacheExpires",
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
