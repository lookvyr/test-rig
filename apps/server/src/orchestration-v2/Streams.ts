import {
  buildActiveShellSnapshot,
  archivedShellStreamItemFromThreadShell,
  coalesceStoredThreadEvents,
  coalesceShellApplicationEvents,
  composeShellStreamWithEnrichment,
  dedupeShellEnrichment,
  shellStreamItemFromEnrichmentRefresh,
  shellStreamItemFromThreadShell,
  shellStreamItemsFromInitialSnapshot,
  shellStreamItemsFromResumeSnapshot,
  toShellApplicationEvent,
  type ShellApplicationEvent,
} from "./ShellStream.ts";
import { ORCHESTRATION_V2_PROJECTION_SCHEMA_VERSION } from "./ProjectionStore.ts";
import { bufferLiveStream } from "./LiveStreamBudget.ts";
import { coalesceThreadLiveStream } from "./ThreadLiveEventCoalescer.ts";
import {
  buildBoundedThreadStreamSnapshot,
  decideThreadResume,
  isThreadReplayRawPayloadSafe,
  threadReplayEncodedBytes,
  THREAD_RESUME_MAX_REPLAY_EVENTS,
} from "./ThreadStream.ts";
import {
  THREAD_HISTORY_PAGE_POLICY,
  THREAD_HISTORY_SNAPSHOT_ROW_LIMIT,
} from "./threadHistoryPaging.ts";
import { projectDomainEventForWire, projectThreadProjectionForWire } from "./WireProjection.ts";
import * as ProjectStore from "./ProjectStore.ts";

import {
  type OrchestrationProjectShell,
  type OrchestrationV2ShellSnapshot,
  ThreadId,
  OrchestrationV2GetShellSnapshotError,
  OrchestrationV2GetThreadProjectionError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Duration from "effect/Duration";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as ThreadManagementService from "./ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProjectEnrichmentService from "../project/ProjectEnrichmentService.ts";
import * as OrchestrationEventStore from "./Services/OrchestrationEventStore.ts";
import { rpcInitialItems } from "../rpcInitialItems.ts";

const SHELL_RESUME_MAX_GAP = 1_000;
const ORCHESTRATION_REPLAY_PAYLOAD_BUDGET_BYTES = 8 * 1024 * 1024;

const canReplayPersistedRange = Effect.fnUntraced(function* (
  afterSequence: number,
  headSequence: number,
  maxGap: number,
) {
  const applicationEvents = yield* OrchestrationEventStore.OrchestrationEventStore;

  const replayGap = headSequence - afterSequence;
  if (replayGap < 0 || replayGap > maxGap) {
    return false;
  }
  const stats = yield* applicationEvents.getReplayStats({
    afterSequence,
    throughSequence: headSequence,
  });
  if (stats.rawPayloadBytes > ORCHESTRATION_REPLAY_PAYLOAD_BUDGET_BYTES) {
    yield* Effect.logDebug("orchestration replay replaced by snapshot", {
      afterSequence,
      headSequence,
      replayGap,
      eventCount: stats.eventCount,
      payloadBytes: stats.rawPayloadBytes,
      payloadBudgetBytes: ORCHESTRATION_REPLAY_PAYLOAD_BUDGET_BYTES,
    });
    return false;
  }
  return true;
});

const enrichProjectShells = Effect.fn("ws.orchestrationV2.enrichProjectShells")(
  (projects: ReadonlyArray<OrchestrationProjectShell>) =>
    Effect.flatMap(ProjectEnrichmentService.ProjectEnrichmentService, (projectEnrichment) =>
      Effect.forEach(
        projects,
        (project) =>
          // Non-blocking: emit with cached identity (or null) and schedule
          // background resolution. subscribeChanges is attached before
          // loadSnapshot, so later identity completions push refreshed
          // shells for multi-env grouping without blocking the initial
          // snapshot or completion marker on slow git probes.
          projectEnrichment.getAvailable(project.workspaceRoot).pipe(
            Effect.map((enrichment) => ({
              project: {
                ...project,
                repositoryIdentity: enrichment.repositoryIdentity,
              },
              repositoryIdentityResolved: enrichment.repositoryIdentityResolved,
            })),
          ),
        { concurrency: 16 },
      ).pipe(
        Effect.map((enriched) => ({
          projects: enriched.map((entry) => entry.project),
          resolvedRepositoryIdentityRoots: enriched
            .filter((entry) => entry.repositoryIdentityResolved)
            .map((entry) => entry.project.workspaceRoot),
        })),
      ),
    ),
);

export const subscribeOrchestrationV2Thread = Effect.fn("ws.orchestrationV2.subscribeThread")(
  function* (input: {
    readonly threadId: ThreadId;
    readonly afterSequence?: number;
    readonly requestCompletionMarker?: boolean;
    readonly acceptBoundedSnapshot?: boolean;
  }) {
    const threadManagement = yield* ThreadManagementService.ThreadManagementService;
    const applicationEvents = yield* OrchestrationEventStore.OrchestrationEventStore;

    yield* Effect.annotateCurrentSpan({
      "orchestration_v2.thread_id": input.threadId,
    });
    yield* threadManagement.ensureLegacyTranscript(input.threadId).pipe(
      Effect.mapError(
        (cause) =>
          new OrchestrationV2GetThreadProjectionError({
            threadId: input.threadId,
            message: `Failed to hydrate migrated thread ${input.threadId}`,
            cause,
          }),
      ),
    );

    const eventStreamFrom = (afterSequence: number) =>
      threadManagement
        .streamStoredEventsFrom({
          threadId: input.threadId,
          afterSequence,
        })
        .pipe(
          Stream.map((stored) => ({
            kind: "event" as const,
            sequence: stored.sequence,
            event: projectDomainEventForWire(stored.event),
          })),
          coalesceThreadLiveStream,
          Stream.mapError(
            (cause) =>
              new OrchestrationV2GetThreadProjectionError({
                threadId: input.threadId,
                message: `Failed while streaming orchestration V2 thread ${input.threadId}`,
                cause,
              }),
          ),
        );

    const loadReplayThrough = (afterSequence: number, throughSequence: number) =>
      applicationEvents
        .readAgentEvents({
          threadId: input.threadId,
          afterSequence,
          throughSequence,
          limit: THREAD_RESUME_MAX_REPLAY_EVENTS + 1,
        })
        .pipe(
          Stream.map((stored) => ({
            kind: "event" as const,
            sequence: stored.sequence,
            event: projectDomainEventForWire(stored.event),
          })),
          Stream.runCollect,
          Effect.map((items) => Array.from(items)),
          Effect.mapError(
            (cause) =>
              new OrchestrationV2GetThreadProjectionError({
                threadId: input.threadId,
                message: `Failed while replaying orchestration V2 thread ${input.threadId}`,
                cause,
              }),
          ),
        );

    const completionMarker =
      input.requestCompletionMarker === true
        ? Stream.make({ kind: "synchronized" as const })
        : Stream.empty;

    const snapshotThenLive = Effect.fn("ws.orchestrationV2.threadSnapshotThenLive")(function* () {
      const useBoundedSnapshot = true;
      const snapshot = yield* (
        useBoundedSnapshot
          ? threadManagement.getThreadSnapshotWindow(input.threadId, {
              rowLimit: THREAD_HISTORY_SNAPSHOT_ROW_LIMIT,
              userTurnLimit: THREAD_HISTORY_PAGE_POLICY.maxUserTurns,
            })
          : threadManagement.getThreadSnapshot(input.threadId)
      ).pipe(
        Effect.mapError(
          (cause) =>
            new OrchestrationV2GetThreadProjectionError({
              threadId: input.threadId,
              message: `Failed to load orchestration V2 thread ${input.threadId}`,
              cause,
            }),
        ),
      );
      const { snapshotSequence } = snapshot;
      const snapshotItem = useBoundedSnapshot
        ? buildBoundedThreadStreamSnapshot(snapshot)
        : {
            kind: "snapshot" as const,
            snapshotSequence,
            projection: projectThreadProjectionForWire(snapshot.projection),
          };
      return Stream.concat(
        Stream.concat(rpcInitialItems([snapshotItem]), completionMarker),
        eventStreamFrom(snapshotSequence),
      );
    });

    // When the client already holds the projection (cached, or loaded over
    // HTTP) it passes that snapshot's sequence, and we resume by replaying
    // persisted events after it instead of re-sending the (potentially
    // multi-KB) snapshot frame over the socket. The event sink subscribes
    // to live events before reading the persisted tail, so no event
    // published during the replay window is lost; overlapping events are
    // deduped by sequence on the client.
    if (input.afterSequence !== undefined) {
      const highWater = yield* applicationEvents.latestAgentSequence(input.threadId).pipe(
        Effect.mapError(
          (cause) =>
            new OrchestrationV2GetThreadProjectionError({
              threadId: input.threadId,
              message: `Failed to prepare orchestration V2 thread ${input.threadId} replay`,
              cause,
            }),
        ),
      );
      if (input.afterSequence > highWater) {
        return yield* snapshotThenLive();
      }
      const stats = yield* applicationEvents
        .getAgentReplayStats({
          threadId: input.threadId,
          afterSequence: input.afterSequence,
          throughSequence: highWater,
          maxEvents: THREAD_RESUME_MAX_REPLAY_EVENTS,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new OrchestrationV2GetThreadProjectionError({
                threadId: input.threadId,
                message: `Failed to measure orchestration V2 thread ${input.threadId} replay`,
                cause,
              }),
          ),
        );
      // Bound stored JSON before decoding, then check projected event
      // size separately. Neither byte count is a bound on process memory.
      if (
        stats.eventCount > THREAD_RESUME_MAX_REPLAY_EVENTS ||
        !isThreadReplayRawPayloadSafe(stats.rawPayloadBytes)
      ) {
        return yield* snapshotThenLive();
      }
      if (stats.hasCreateEvent) {
        const shell = yield* threadManagement.getThreadShell(input.threadId).pipe(
          Effect.mapError(
            (cause) =>
              new OrchestrationV2GetThreadProjectionError({
                threadId: input.threadId,
                message: `Failed to locate recreated orchestration V2 thread ${input.threadId}`,
                cause,
              }),
          ),
        );
        // A retained creation can belong to a thread already deleted.
        // Only replace its bounded replay when a snapshot can exist.
        if (shell !== null) return yield* snapshotThenLive();
      }
      const replay = yield* loadReplayThrough(input.afterSequence, highWater);
      const plan = decideThreadResume({
        afterSequence: input.afterSequence,
        highWater,
        replayEventCount: replay.length,
        replayEncodedBytes: threadReplayEncodedBytes(replay),
      });
      if (plan.mode === "snapshot") {
        return yield* snapshotThenLive();
      }
      return Stream.concat(
        Stream.concat(rpcInitialItems(replay), completionMarker),
        eventStreamFrom(highWater),
      );
    }

    return yield* snapshotThenLive();
  },
);

export const subscribeOrchestrationV2Shell = Effect.fn("ws.orchestrationV2.subscribeShell")(
  function* (input: {
    readonly afterSequence?: number;
    readonly requestCompletionMarker?: boolean;
  }) {
    const sql = yield* SqlClient.SqlClient;
    const threadManagement = yield* ThreadManagementService.ThreadManagementService;
    const applicationEvents = yield* OrchestrationEventStore.OrchestrationEventStore;
    const projects = yield* ProjectStore.ProjectStoreV2;
    const projectService = yield* ProjectService.ProjectService;
    const projectEnrichment = yield* ProjectEnrichmentService.ProjectEnrichmentService;

    const enrichmentChanges = yield* projectEnrichment.subscribeChanges;
    const loadProjectMetadataSnapshot = Effect.fn("ws.orchestrationV2.loadProjectMetadataSnapshot")(
      function* (snapshotSequence: number) {
        const enriched = yield* enrichProjectShells(yield* projects.listShells());
        return {
          snapshot: {
            schemaVersion: ORCHESTRATION_V2_PROJECTION_SCHEMA_VERSION,
            snapshotSequence,
            projects: enriched.projects,
            threads: [],
            archivedThreads: [],
          } as OrchestrationV2ShellSnapshot,
          resolvedRepositoryIdentityRoots: enriched.resolvedRepositoryIdentityRoots,
        };
      },
    );
    const loadSnapshot = Effect.fn("ws.orchestrationV2.loadShellSnapshot")(function* () {
      const base = yield* sql.withTransaction(
        Effect.gen(function* () {
          const threads = yield* threadManagement.getShellSnapshot({ location: "active" });
          return buildActiveShellSnapshot({
            projects: yield* projects.listShells(),
            threads,
            snapshotSequence: yield* applicationEvents.latestApplicationSequence,
          });
        }),
      );
      const enriched = yield* enrichProjectShells(base.projects);
      return {
        snapshot: { ...base, projects: enriched.projects } as OrchestrationV2ShellSnapshot,
        resolvedRepositoryIdentityRoots: enriched.resolvedRepositoryIdentityRoots,
      };
    });
    const projectItem = Effect.fn("ws.orchestrationV2.projectShellItem")(function* (
      stored: Extract<ShellApplicationEvent, { readonly aggregateKind: "project" }>,
    ) {
      if (stored.type === "project.deleted") {
        return {
          kind: "project.removed" as const,
          sequence: stored.sequence,
          projectId: stored.aggregateId,
        };
      }
      const project = yield* projectService.getShell(stored.aggregateId);
      return Option.match(project, {
        onNone: () => ({
          kind: "project.removed" as const,
          sequence: stored.sequence,
          projectId: stored.aggregateId,
        }),
        onSome: (value) => ({
          kind: "project.updated" as const,
          sequence: stored.sequence,
          project: value,
        }),
      });
    });

    // Coalescing makes each per-thread shell read represent every event
    // for that thread in the current window; reading only the affected
    // threads keeps the cost of a busy stream independent of how many
    // threads exist overall.
    const projectShellItems = Effect.fn("ws.orchestrationV2.projectShellItems")(function* (
      events: ReadonlyArray<ShellApplicationEvent>,
    ) {
      return yield* Effect.forEach(
        coalesceShellApplicationEvents(events),
        (stored) =>
          Effect.gen(function* () {
            if ("aggregateKind" in stored) {
              return yield* projectItem(stored);
            }
            const shell = yield* threadManagement.getThreadShell(stored.event.threadId);
            return shellStreamItemFromThreadShell({ stored, shell });
          }),
        { concurrency: 8 },
      );
    });

    const toShellStream = <E, R>(stream: Stream.Stream<ShellApplicationEvent, E, R>) =>
      stream.pipe(
        Stream.groupedWithin(512, Duration.millis(50)),
        Stream.mapEffect((events) => projectShellItems(Array.from(events))),
        Stream.flatMap(Stream.fromIterable),
      );

    const liveFrom = (afterSequence: number) =>
      bufferLiveStream(
        toShellStream(
          applicationEvents.streamProjectedApplicationEvents({
            afterSequence,
            project: toShellApplicationEvent,
          }),
        ),
      );

    const enrichmentRefreshes = Stream.fromSubscription(enrichmentChanges).pipe(
      Stream.filter((change) => change.repositoryIdentityResolved),
      Stream.groupedWithin(64, Duration.millis(25)),
      Stream.mapEffect((changes) =>
        applicationEvents.latestApplicationSequence.pipe(
          Effect.flatMap(loadProjectMetadataSnapshot),
          Effect.map(({ snapshot }) =>
            shellStreamItemFromEnrichmentRefresh({
              snapshot,
              changes: Array.from(changes),
            }),
          ),
        ),
      ),
    );

    // Always attach the enrichment subscription before the first load so
    // completions that race HTTP snapshot fetch still push a refresh.
    // When the client already holds a shell snapshot (cached, or loaded
    // over HTTP) it passes that snapshot's sequence. We still emit one
    // compact metadata refresh up front: getAvailable may have been cold on the
    // HTTP path (null identity), and enrichment PubSub events published
    // before this subscribe attached are dropped. Rehydrating here fills
    // repositoryIdentity for cross-environment project grouping even on
    // afterSequence resumes. Application events after the sequence still
    // stream as deltas; overlapping events are deduped by sequence on the
    // client.
    //
    // After the unmarked authoritative frame, emit a same-sequence
    // metadata-only frame for roots that already resolved successfully
    // (including cached null). Cold/failed roots stay unmarked and use
    // the PubSub enrichment path when they complete later.
    const completionMarker =
      input.requestCompletionMarker === true
        ? Stream.make({ kind: "synchronized" as const })
        : Stream.empty;
    const initialSnapshotItems = (loaded: {
      readonly snapshot: OrchestrationV2ShellSnapshot;
      readonly resolvedRepositoryIdentityRoots: ReadonlyArray<string>;
    }) =>
      rpcInitialItems(
        shellStreamItemsFromInitialSnapshot({
          snapshot: loaded.snapshot,
          resolvedRepositoryIdentityRoots: loaded.resolvedRepositoryIdentityRoots,
        }),
      );
    const initialEnrichmentItems = (loaded: {
      readonly snapshot: OrchestrationV2ShellSnapshot;
      readonly resolvedRepositoryIdentityRoots: ReadonlyArray<string>;
    }) =>
      rpcInitialItems(
        shellStreamItemsFromResumeSnapshot({
          snapshot: loaded.snapshot,
          resolvedRepositoryIdentityRoots: loaded.resolvedRepositoryIdentityRoots,
        }),
      );
    // Initial unmarked (+ optional same-load marked) always drains first.
    // Enrichment merges only with the post-prefix tail so a ready marked
    // refresh cannot interleave before the authoritative initial frame.
    const completionThenLive = (afterSequence: number) =>
      Stream.concat(completionMarker, liveFrom(afterSequence));

    const stream = yield* Effect.gen(function* () {
      if (input.afterSequence === undefined) {
        const loaded = yield* loadSnapshot();
        return composeShellStreamWithEnrichment({
          initial: initialSnapshotItems(loaded),
          tail: completionThenLive(loaded.snapshot.snapshotSequence),
          enrichment: enrichmentRefreshes,
        });
      }

      const highWater = yield* applicationEvents.latestApplicationSequence;
      if (!(yield* canReplayPersistedRange(input.afterSequence, highWater, SHELL_RESUME_MAX_GAP))) {
        const loaded = yield* loadSnapshot();
        return composeShellStreamWithEnrichment({
          initial: initialSnapshotItems(loaded),
          tail: completionThenLive(loaded.snapshot.snapshotSequence),
          enrichment: enrichmentRefreshes,
        });
      }

      const loaded = yield* loadProjectMetadataSnapshot(highWater);
      const replay = toShellStream(
        applicationEvents.readApplicationEvents({
          afterSequence: input.afterSequence,
          throughSequence: highWater,
        }),
      );
      return composeShellStreamWithEnrichment({
        initial: initialEnrichmentItems(loaded),
        tail: Stream.concat(Stream.concat(replay, completionMarker), liveFrom(highWater)),
        enrichment: enrichmentRefreshes,
      });
    }).pipe(
      Effect.mapError(
        (cause) =>
          new OrchestrationV2GetShellSnapshotError({
            message: "Failed to prepare the application shell stream",
            cause,
          }),
      ),
    );

    return stream.pipe(
      dedupeShellEnrichment,
      Stream.mapError(
        (cause) =>
          new OrchestrationV2GetShellSnapshotError({
            message: "Failed while streaming the application shell",
            cause,
          }),
      ),
    );
  },
);

export const makeArchivedShellStreams = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const threadManagement = yield* ThreadManagementService.ThreadManagementService;
  const applicationEvents = yield* OrchestrationEventStore.OrchestrationEventStore;
  const projectStore = yield* ProjectStore.ProjectStoreV2;
  const projectEnrichment = yield* ProjectEnrichmentService.ProjectEnrichmentService;
  const getOrchestrationV2ArchivedShellSnapshot = sql
    .withTransaction(
      Effect.gen(function* () {
        const threads = yield* threadManagement.getShellSnapshot({ location: "archive" });
        return {
          schemaVersion: threads.schemaVersion,
          snapshotSequence: yield* applicationEvents.latestApplicationSequence,
          projects: yield* projectStore.listShells(),
          threads: threads.archivedThreads,
        } as const;
      }),
    )
    .pipe(
      Effect.flatMap((snapshot) =>
        enrichProjectShells(snapshot.projects)
          .pipe(
            Effect.provideService(
              ProjectEnrichmentService.ProjectEnrichmentService,
              projectEnrichment,
            ),
          )
          .pipe(Effect.map(({ projects }) => ({ ...snapshot, projects }))),
      ),
      Effect.mapError(
        (cause) =>
          new OrchestrationV2GetShellSnapshotError({
            message: "Failed to load archived thread snapshot",
            cause,
          }),
      ),
    );

  const subscribeOrchestrationV2ArchivedShell = Effect.fn(
    "ws.orchestrationV2.subscribeArchivedShell",
  )(function* () {
    const snapshot = yield* getOrchestrationV2ArchivedShellSnapshot;
    const live = threadManagement
      .streamStoredEventsFrom({ afterSequence: snapshot.snapshotSequence })
      .pipe(
        Stream.groupedWithin(512, Duration.millis(50)),
        Stream.mapEffect((events) =>
          Effect.forEach(
            coalesceStoredThreadEvents(Array.from(events)),
            (stored) =>
              threadManagement
                .getThreadShell(stored.event.threadId)
                .pipe(
                  Effect.map((shell) => archivedShellStreamItemFromThreadShell({ stored, shell })),
                ),
            { concurrency: 8 },
          ),
        ),
        Stream.flatMap(Stream.fromIterable),
        Stream.filterMap((item) => (item === null ? Result.failVoid : Result.succeed(item))),
        (stream) => bufferLiveStream(stream),
        Stream.mapError(
          (cause) =>
            new OrchestrationV2GetShellSnapshotError({
              message: "Failed while streaming archived threads",
              cause,
            }),
        ),
      );
    return Stream.concat(rpcInitialItems([{ kind: "snapshot" as const, snapshot }]), live);
  });

  return {
    snapshot: getOrchestrationV2ArchivedShellSnapshot,
    subscribe: subscribeOrchestrationV2ArchivedShell,
  };
});
