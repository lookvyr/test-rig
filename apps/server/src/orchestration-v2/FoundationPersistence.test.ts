import { assert, it } from "@effect/vitest";
import {
  CheckpointId,
  CheckpointRef,
  CheckpointScopeId,
  CommandId,
  ContextTransferId,
  EventId,
  MessageId,
  type ModelSelection,
  NodeId,
  type OrchestrationV2AppThread,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2Run,
  type OrchestrationV2TurnItem,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  ProviderThreadId,
  RunAttemptId,
  RunId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as Tracer from "effect/Tracer";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Statement from "effect/unstable/sql/Statement";

import { LIVE_STREAM_MAX_ITEMS, LiveStreamBufferError } from "./LiveStreamBudget.ts";
import { V2SqlitePersistenceMemory } from "../persistence/Layers/V2Sqlite.ts";
import * as CommandReceiptStore from "./CommandReceiptStore.ts";
import * as EffectOutbox from "./EffectOutbox.ts";
import * as EffectWorker from "./EffectWorker.ts";
import * as EventSink from "./EventSink.ts";
import * as EventStore from "./EventStore.ts";
import * as IdAllocator from "./IdAllocator.ts";
import * as ProjectionMaintenance from "./ProjectionMaintenance.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

const isLiveStreamBufferError = Schema.is(LiveStreamBufferError);
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const databaseLayer = V2SqlitePersistenceMemory;
const eventStoreProvided = EventStore.layer.pipe(Layer.provideMerge(databaseLayer));
const projectionStoreProvided = ProjectionStore.layer.pipe(Layer.provideMerge(databaseLayer));
const storesProvided = Layer.mergeAll(databaseLayer, eventStoreProvided, projectionStoreProvided);
const eventSinkProvided = EventSink.layer.pipe(Layer.provide(storesProvided));
const effectOutboxProvided = EffectOutbox.layer.pipe(Layer.provide(databaseLayer));
const commandReceiptStoreProvided = CommandReceiptStore.layer.pipe(Layer.provide(databaseLayer));
const projectionMaintenanceProvided = ProjectionMaintenance.layer.pipe(
  Layer.provide(storesProvided),
);
const TestLayer = Layer.mergeAll(
  storesProvided,
  eventSinkProvided,
  effectOutboxProvided,
  commandReceiptStoreProvided,
  IdAllocator.layer,
  projectionMaintenanceProvided,
);

// A fixture payload for persistence, not a provider implementation.
const fixtureCapabilities = {
  sessions: {
    supportsMultipleProviderThreadsPerSession: true,
    supportsModelSwitchInSession: true,
    supportsProviderSwitchingViaHandoff: true,
    supportsRuntimeModeSwitchInSession: true,
    pendingRequestsSurviveRestart: false,
  },
  threads: {
    canCreateEmptyThread: true,
    canReadThreadSnapshot: true,
    canRollbackThread: true,
    canForkThread: true,
    canForkFromTurn: true,
    canForkFromSubagentThread: true,
    exposesNativeThreadId: true,
  },
  turns: {
    exposesNativeTurnId: true,
    emitsTurnStarted: true,
    emitsTurnCompleted: true,
    supportsInterrupt: true,
    supportsActiveSteering: true,
    supportsSteeringByInterruptRestart: true,
    supportsQueuedMessages: true,
    terminalStatusQuality: "strong",
  },
  streaming: {
    streamsAssistantText: true,
    streamsReasoning: true,
    streamsToolOutput: true,
    streamsPlanText: true,
    emitsMessageCompleted: true,
  },
  tools: {
    exposesToolItemIds: true,
    emitsToolStarted: true,
    emitsToolCompleted: true,
    emitsToolOutput: true,
    supportsMcpTools: true,
    supportsDynamicToolCallbacks: true,
  },
  approvals: {
    supportsCommandApproval: true,
    supportsFileReadApproval: true,
    supportsFileChangeApproval: true,
    supportsApplyPatchApproval: true,
    approvalsHaveNativeRequestIds: true,
    approvalCallbacksAreLiveOnly: true,
    approvalsCanOriginateFromSubagents: true,
  },
  planning: {
    emitsPlanUpdated: true,
    emitsTodoList: true,
    emitsProposedPlan: true,
    supportsStructuredQuestions: true,
    planDeltasHaveItemIds: true,
  },
  subagents: {
    supportsSubagents: true,
    exposesSubagentThreadIds: true,
    emitsSubagentLifecycle: true,
    canWaitForSubagents: true,
    canCloseSubagents: true,
    canForkSubagentThread: true,
  },
  context: {
    acceptsSystemContext: true,
    acceptsDeveloperContext: true,
    acceptsSyntheticUserContext: true,
    canGenerateSummaries: true,
    canConsumeHandoffSummaries: true,
    supportsDeltaHandoff: true,
    supportsFullThreadHandoff: true,
    maxRecommendedHandoffChars: null,
  },
  checkpointing: {
    appCanCheckpointFilesystem: true,
    supportsNestedCheckpointScopes: true,
    providerCanRollbackConversation: true,
    providerRollbackReturnsSnapshot: true,
    providerCanReadConversationSnapshot: true,
  },
  identity: {
    nativeThreadIds: "strong",
    nativeTurnIds: "strong",
    nativeItemIds: "strong",
    nativeRequestIds: "strong",
  },
  runtimePolicy: {
    enforcement: "native",
  },
} satisfies import("@t3tools/contracts").OrchestrationV2ProviderCapabilities;

const providerInstanceId = ProviderInstanceId.make("codex");
const providerDriver = ProviderDriverKind.make("codex");
const modelSelection = {
  instanceId: providerInstanceId,
  model: "gpt-5.4",
} satisfies ModelSelection;

function makeThread(threadId: ThreadId, now: DateTime.Utc): OrchestrationV2AppThread {
  return {
    createdBy: "user",
    creationSource: "web",
    id: threadId,
    projectId: ProjectId.make(`project:${threadId}`),
    title: `Thread ${threadId}`,
    providerInstanceId,
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: {
      parentThreadId: null,
      relationshipToParent: null,
      rootThreadId: threadId,
    },
    forkedFrom: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  };
}

function threadCreatedEvent(input: {
  readonly id: string;
  readonly thread: OrchestrationV2AppThread;
  readonly now: DateTime.Utc;
}): OrchestrationV2DomainEvent {
  return {
    id: EventId.make(input.id),
    type: "thread.created",
    threadId: input.thread.id,
    providerInstanceId,
    occurredAt: input.now,
    payload: input.thread,
  };
}

it.effect("rebuilds event history one bounded page at a time", () =>
  Effect.gen(function* () {
    const eventStore = yield* EventStore.EventStoreV2;
    const projectionStore = yield* ProjectionStore.ProjectionStoreV2;
    const now = yield* DateTime.now;
    const threadId = ThreadId.make("thread:foundation-paged-rebuild");
    const thread = makeThread(threadId, now);
    const eventCount = 1_005;
    yield* eventStore.append({
      events: [
        threadCreatedEvent({ id: "event:paged-rebuild:0", thread, now }),
        ...Array.from({ length: eventCount - 1 }, (_, index) => ({
          id: EventId.make(`event:paged-rebuild:${index + 1}`),
          type: "thread.metadata-updated" as const,
          threadId,
          occurredAt: now,
          payload: { ...thread, title: `Rebuilt update ${index + 1}` },
        })),
      ],
    });
    let applied = 0;
    let failAfterFirstPage = false;
    const appliedAtRead: Array<number> = [];
    const observedStores = Layer.mergeAll(
      Layer.succeed(EventStore.EventStoreV2, {
        ...eventStore,
        read: (input) =>
          Stream.suspend(() => {
            appliedAtRead.push(applied);
            if (failAfterFirstPage && applied >= 500) {
              return Stream.fail(
                new EventStore.EventStoreReadEventsError({ afterSequence: input?.afterSequence }),
              );
            }
            return eventStore.read(input);
          }),
      }),
      Layer.succeed(ProjectionStore.ProjectionStoreV2, {
        ...projectionStore,
        apply: (event) =>
          projectionStore.apply(event).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                applied += 1;
              }),
            ),
          ),
      }),
    );
    const rebuild = Effect.gen(function* () {
      const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
      return yield* maintenance.rebuild;
    }).pipe(
      Effect.provide(Layer.fresh(ProjectionMaintenance.layer.pipe(Layer.provide(observedStores)))),
    );
    const rebuilt = yield* rebuild;
    assert.isTrue(rebuilt.valid);
    assert.equal(applied, eventCount);
    assert.deepEqual(appliedAtRead, [0, 500, 1_000]);
    assert.equal(
      (yield* projectionStore.getThreadProjection(threadId)).thread.title,
      "Rebuilt update 1004",
    );
    applied = 0;
    failAfterFirstPage = true;
    const failed = yield* Effect.exit(rebuild);
    assert.equal(failed._tag, "Failure");
    assert.equal(applied, 500);
    assert.equal(
      (yield* projectionStore.getThreadProjection(threadId)).thread.title,
      "Rebuilt update 1004",
    );
    const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
    assert.isTrue((yield* maintenance.verify).valid);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("verifies thread membership using only the thread-created partial index", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
    const now = DateTime.formatIso(yield* DateTime.now);
    yield* sql`
      WITH RECURSIVE history(n) AS (
        SELECT 1 UNION ALL SELECT n + 1 FROM history WHERE n < 25000
      )
      INSERT INTO orchestration_events (
        event_id, aggregate_kind, stream_id, stream_version, event_type,
        occurred_at, actor_kind, payload_json, metadata_json, application_event_version
      )
      SELECT 'history:' || n, 'thread', 'thread:history', n,
        'provider-session.detached', ${now}, 'server', '{}', '{}', 2
      FROM history
    `;
    let membershipQuery: string | undefined;
    const tracer = Tracer.make({
      span(options) {
        const span = new Tracer.NativeSpan(options);
        const end = span.end.bind(span);
        span.end = (endTime, exit) => {
          end(endTime, exit);
          const query = span.attributes.get("db.query.text");
          if (
            typeof query === "string" &&
            query.includes("SELECT DISTINCT stream_id AS thread_id")
          ) {
            membershipQuery = query;
          }
        };
        return span;
      },
    });
    yield* maintenance.verify.pipe(Effect.withTracer(tracer));
    assert.isDefined(membershipQuery);
    const plan = yield* sql.unsafe<{ readonly detail: string }>(
      `EXPLAIN QUERY PLAN ${membershipQuery}`,
    );
    const details = plan.map((row) => row.detail).join("\n");
    assert.match(details, /USING (?:COVERING )?INDEX orchestration_events_v2_created_threads_idx/);
    assert.notMatch(details, /idx_orch_events_stream_sequence|TEMP B-TREE/);
  }).pipe(Effect.provide(TestLayer)),
);

it.layer(TestLayer)("orchestration V2 foundation persistence", (it) => {
  it.effect("projects oversized tool bodies before both replay and live RPC retention", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const sink = yield* EventSink.EventSinkV2;
        const store = yield* EventStore.EventStoreV2;
        const projections = yield* ProjectionStore.ProjectionStoreV2;
        const now = yield* DateTime.now;
        const thread = makeThread(ThreadId.make("thread:large-stream-body"), now);
        const output = {
          content: [{ type: "text", text: "first line\n" + "x".repeat(9 * 1024 * 1024) }],
        };
        const tool: OrchestrationV2TurnItem = {
          id: TurnItemId.make("tool:large-stream-body"),
          type: "dynamic_tool",
          threadId: thread.id,
          runId: null,
          nodeId: null,
          providerThreadId: null,
          providerTurnId: null,
          nativeItemRef: null,
          parentItemId: null,
          ordinal: 1,
          status: "running",
          title: "Large tool",
          toolName: "mcp__large_tool",
          input: { query: "details" },
          output,
          startedAt: now,
          completedAt: null,
          updatedAt: now,
        };
        const [created] = yield* sink.write({
          events: [
            threadCreatedEvent({ id: "event:large-stream-body:created", thread, now }),
            {
              id: EventId.make("event:large-stream-body:replay"),
              type: "turn-item.updated",
              threadId: thread.id,
              occurredAt: now,
              payload: tool,
            },
          ],
        });
        const pull = yield* Stream.toPull(
          sink.stream({
            threadId: thread.id,
            afterSequence: created!.sequence,
            bounded: true,
          }),
        );
        const replay = yield* pull;
        assert.lengthOf(replay, 1);
        assert.equal(replay[0]!.event.type, "turn-item.updated");
        assert.isBelow(Buffer.byteLength(yield* encodeJson(replay)), 4_000);
        const [completed] = yield* sink.write({
          events: [
            {
              id: EventId.make("event:large-stream-body:live"),
              type: "turn-item.updated",
              threadId: thread.id,
              occurredAt: now,
              payload: { ...tool, status: "completed", completedAt: now },
            },
          ],
        });
        const live = yield* pull;
        assert.deepEqual(
          live.map((stored) => stored.sequence),
          [completed!.sequence],
        );
        assert.isBelow(Buffer.byteLength(yield* encodeJson(live)), 4_000);
        for (const stored of [...replay, ...live]) {
          assert.equal(stored.event.type, "turn-item.updated");
          if (stored.event.type !== "turn-item.updated") return;
          assert.equal(stored.event.payload.type, "dynamic_tool");
          if (stored.event.payload.type !== "dynamic_tool") return;
          assert.notProperty(stored.event.payload, "output");
        }
        const persisted = yield* store.read({ threadId: thread.id }).pipe(Stream.runCollect);
        const fullEvent = persisted.find(
          (stored) => stored.sequence === completed!.sequence,
        )!.event;
        assert.equal(fullEvent.type, "turn-item.updated");
        if (fullEvent.type !== "turn-item.updated") return;
        assert.equal(fullEvent.payload.type, "dynamic_tool");
        if (fullEvent.payload.type !== "dynamic_tool") return;
        assert.deepEqual(fullEvent.payload.output, output);
        const detail = (yield* projections.getThreadProjection(thread.id)).turnItems.find(
          (item) => item.id === tool.id,
        )!;
        assert.equal(detail.type, "dynamic_tool");
        if (detail.type === "dynamic_tool") assert.deepEqual(detail.output, output);
      }),
    ),
  );

  for (const phase of ["high-water", "replay"] as const) {
    it.effect(`bounds live events while the V2 ${phase} query is blocked`, () =>
      Effect.scoped(
        Effect.gen(function* () {
          const sink = yield* EventSink.EventSinkV2;
          const now = yield* DateTime.now;
          const thread = makeThread(ThreadId.make(`thread:blocked-${phase}`), now);
          const [created] = yield* sink.write({
            events: [threadCreatedEvent({ id: `event:blocked-${phase}:created`, thread, now })],
          });
          const readStarted = yield* Deferred.make<void>();
          const readClosed = yield* Deferred.make<void>();
          const blockRead: Statement.Transformer = (statement) => {
            const [query] = statement.compile();
            if (
              query.includes("FROM orchestration_events") &&
              query.includes("MAX(sequence)") === (phase === "high-water")
            ) {
              return Deferred.succeed(readStarted, undefined).pipe(
                Effect.andThen(Effect.never),
                Effect.ensuring(Deferred.succeed(readClosed, undefined)),
                Effect.as(statement),
              );
            }
            return Effect.succeed(statement);
          };
          const reader = yield* sink
            .stream({ threadId: thread.id, afterSequence: created!.sequence, bounded: true })
            .pipe(
              Stream.provideService(Statement.CurrentTransformer, blockRead),
              Stream.runDrain,
              Effect.result,
              Effect.forkScoped,
            );
          yield* Deferred.await(readStarted);
          yield* sink.write({
            events: Array.from({ length: LIVE_STREAM_MAX_ITEMS + 1 }, (_, index) => ({
              id: EventId.make(`event:blocked-${phase}:${index}`),
              type: "thread.metadata-updated" as const,
              threadId: thread.id,
              occurredAt: now,
              payload: { ...thread, title: `Updated ${index}` },
            })),
          });
          yield* Deferred.await(readClosed);
          const result = yield* Fiber.join(reader);
          assert.equal(result._tag, "Failure");
          if (result._tag === "Failure") {
            assert.equal(result.failure._tag, "EventSinkStreamError");
            assert.isTrue(isLiveStreamBufferError(result.failure.cause));
          }
        }),
      ),
    );
  }

  it.effect(
    "keeps internal streams subscribed while replay is blocked beyond the RPC buffer cap",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const sink = yield* EventSink.EventSinkV2;
          const now = yield* DateTime.now;
          const thread = makeThread(ThreadId.make("thread:internal-stream-burst"), now);
          const [created] = yield* sink.write({
            events: [
              threadCreatedEvent({ id: "event:internal-stream-burst:created", thread, now }),
            ],
          });
          const readStarted = yield* Deferred.make<void>();
          const releaseRead = yield* Deferred.make<void>();
          const blockHighWater: Statement.Transformer = (statement) => {
            const [query] = statement.compile();
            return query.includes("MAX(sequence)") && query.includes("FROM orchestration_events")
              ? Deferred.succeed(readStarted, undefined).pipe(
                  Effect.andThen(Deferred.await(releaseRead)),
                  Effect.as(statement),
                )
              : Effect.succeed(statement);
          };
          const eventCount = LIVE_STREAM_MAX_ITEMS + 1;
          const reader = yield* sink
            .stream({ threadId: thread.id, afterSequence: created!.sequence })
            .pipe(
              Stream.provideService(Statement.CurrentTransformer, blockHighWater),
              Stream.take(eventCount),
              Stream.runCollect,
              Effect.forkScoped,
            );
          yield* Deferred.await(readStarted);
          const written = yield* sink.write({
            events: Array.from({ length: eventCount }, (_, index) => ({
              id: EventId.make(`event:internal-stream-burst:${index}`),
              type: "thread.metadata-updated" as const,
              threadId: thread.id,
              occurredAt: now,
              payload: { ...thread, title: `Updated ${index}` },
            })),
          });
          yield* Deferred.succeed(releaseRead, undefined);
          assert.deepEqual(
            (yield* Fiber.join(reader)).map((event) => event.sequence),
            written.map((event) => event.sequence),
          );
        }),
      ),
  );

  it.effect("filters worker replay and live queues without losing matching events", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const sink = yield* EventSink.EventSinkV2;
        const sql = yield* SqlClient.SqlClient;
        const now = yield* DateTime.now;
        const thread = makeThread(ThreadId.make("thread:filtered-worker"), now);
        const other = makeThread(ThreadId.make("thread:filtered-worker-other"), now);
        const run: OrchestrationV2Run = {
          id: RunId.make("run:filtered-worker"),
          threadId: thread.id,
          ordinal: 1,
          providerInstanceId,
          modelSelection,
          providerThreadId: null,
          userMessageId: MessageId.make("message:filtered-worker"),
          rootNodeId: null,
          activeAttemptId: null,
          status: "completed",
          queuePosition: null,
          requestedAt: now,
          startedAt: now,
          completedAt: now,
          checkpointId: null,
          contextHandoffId: null,
        };
        const runEvent = (id: string, payload: OrchestrationV2Run): OrchestrationV2DomainEvent => ({
          id: EventId.make(id),
          type: "run.updated",
          threadId: payload.threadId,
          runId: payload.id,
          occurredAt: now,
          payload,
        });
        const history = yield* sink.write({
          events: [
            threadCreatedEvent({ id: "event:filtered-worker:created", thread, now }),
            threadCreatedEvent({ id: "event:filtered-worker:other", thread: other, now }),
            runEvent("event:filtered-worker:history", run),
            runEvent("event:filtered-worker:other-history", {
              ...run,
              id: RunId.make("run:filtered-worker-other"),
              threadId: other.id,
            }),
          ],
        });
        // Unrelated payloads must be skipped in SQL, before decoding or
        // allocating their bodies, even when a retained row is unreadable.
        const original = yield* sql<{ readonly payload_json: string }>`
          SELECT payload_json FROM orchestration_events
          WHERE sequence = ${history[0]!.sequence}
        `;
        yield* Effect.acquireRelease(
          sql`
            UPDATE orchestration_events SET payload_json = 'unreadable unrelated payload'
            WHERE sequence = ${history[0]!.sequence}
          `,
          () =>
            sql`
              UPDATE orchestration_events SET payload_json = ${original[0]!.payload_json}
              WHERE sequence = ${history[0]!.sequence}
            `.pipe(Effect.orDie),
        );
        const pull = yield* Stream.toPull(
          sink.stream({ threadId: thread.id, eventType: "run.updated" }),
        );
        assert.deepEqual(
          (yield* pull).map((stored) => stored.sequence),
          [history[2]!.sequence],
        );
        // The worker is occupied with the previous batch while the thread
        // publishes output. Its live queue must receive just run updates.
        yield* sink.write({
          events: Array.from({ length: LIVE_STREAM_MAX_ITEMS + 1 }, (_, index) => ({
            id: EventId.make(`event:filtered-worker:output:${index}`),
            type: "thread.metadata-updated" as const,
            threadId: thread.id,
            occurredAt: now,
            payload: { ...thread, title: `Output ${index}` },
          })),
        });
        const live = yield* sink.write({
          events: [
            runEvent("event:filtered-worker:live:1", { ...run, status: "interrupted" }),
            runEvent("event:filtered-worker:live:2", { ...run, status: "failed" }),
          ],
        });
        assert.deepEqual(
          (yield* pull).map((stored) => stored.sequence),
          live.map((stored) => stored.sequence),
        );
      }),
    ),
  );

  it.effect("paginates catch-up beyond the event-store read limit", () =>
    Effect.gen(function* () {
      const eventSink = yield* EventSink.EventSinkV2;
      const now = yield* DateTime.now;
      const threadId = ThreadId.make("thread:foundation-large-catch-up");
      const thread = makeThread(threadId, now);
      const eventCount = 1_005;
      const events: Array<OrchestrationV2DomainEvent> = [
        threadCreatedEvent({ id: "event:foundation-catch-up:0", thread, now }),
        ...Array.from({ length: eventCount - 1 }, (_, index) => ({
          id: EventId.make(`event:foundation-catch-up:${index + 1}`),
          type: "thread.metadata-updated" as const,
          threadId,
          providerInstanceId,
          occurredAt: now,
          payload: {
            ...thread,
            title: `Catch-up update ${index + 1}`,
          },
        })),
      ];

      yield* eventSink.write({ events });
      const replayed = yield* eventSink.stream({ afterSequence: 0 }).pipe(
        Stream.take(eventCount),
        Stream.runCollect,
        Effect.map((events) => Array.from(events)),
      );

      assert.lengthOf(replayed, eventCount);
      assert.deepEqual(
        replayed.map((stored) => stored.sequence),
        Array.from({ length: eventCount }, (_, index) => index + 1),
      );
    }),
  );

  it.effect("does not lose or duplicate events while transitioning from catch-up to live", () =>
    Effect.gen(function* () {
      const eventSink = yield* EventSink.EventSinkV2;
      const now = yield* DateTime.now;
      const threadId = ThreadId.make("thread:foundation-stream-race");
      const thread = makeThread(threadId, now);
      const created = yield* eventSink.write({
        events: [threadCreatedEvent({ id: "event:foundation-stream-race:0", thread, now })],
      });

      let afterSequence = created[0]!.sequence;
      for (let index = 1; index <= 32; index += 1) {
        const nextEvent = {
          id: EventId.make(`event:foundation-stream-race:${index}`),
          type: "thread.metadata-updated" as const,
          threadId,
          providerInstanceId,
          occurredAt: now,
          payload: { ...thread, title: `Race update ${index}` },
        } satisfies OrchestrationV2DomainEvent;
        const reader = yield* eventSink
          .stream({ threadId, afterSequence })
          .pipe(Stream.runHead, Effect.forkChild);
        yield* Effect.yieldNow;
        const written = yield* eventSink.write({ events: [nextEvent] });
        const received = yield* Fiber.join(reader);
        if (Option.isNone(received)) {
          return yield* Effect.die("The event stream ended before delivering the live event.");
        }
        assert.equal(received.value.sequence, written[0]?.sequence);
        assert.equal(received.value.event.id, nextEvent.id);
        afterSequence = received.value.sequence;
      }
    }),
  );

  it.effect("replays shared provider-session payloads across every bound thread", () =>
    Effect.gen(function* () {
      const eventSink = yield* EventSink.EventSinkV2;
      const projectionStore = yield* ProjectionStore.ProjectionStoreV2;
      const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
      const now = yield* DateTime.now;
      const firstThreadId = ThreadId.make("thread:foundation-shared-session:first");
      const secondThreadId = ThreadId.make("thread:foundation-shared-session:second");
      const providerSessionId = ProviderSessionId.make("provider-session:foundation:shared");
      const firstSession = {
        id: providerSessionId,
        driver: providerDriver,
        providerInstanceId,
        status: "ready" as const,
        cwd: "/workspace/first",
        model: modelSelection.model,
        capabilities: fixtureCapabilities,
        createdAt: now,
        updatedAt: now,
        lastError: null,
      };
      const secondSession = { ...firstSession, cwd: "/workspace/second" };

      yield* eventSink.write({
        events: [
          threadCreatedEvent({
            id: "event:foundation-shared-session:first-thread",
            thread: makeThread(firstThreadId, now),
            now,
          }),
          {
            id: EventId.make("event:foundation-shared-session:first-attachment"),
            type: "provider-session.attached",
            threadId: firstThreadId,
            driver: providerDriver,
            providerInstanceId,
            occurredAt: now,
            payload: firstSession,
          },
          threadCreatedEvent({
            id: "event:foundation-shared-session:second-thread",
            thread: makeThread(secondThreadId, now),
            now,
          }),
          {
            id: EventId.make("event:foundation-shared-session:second-attachment"),
            type: "provider-session.attached",
            threadId: secondThreadId,
            driver: providerDriver,
            providerInstanceId,
            occurredAt: now,
            payload: secondSession,
          },
        ],
      });

      assert.equal(
        (yield* projectionStore.getThreadProjection(firstThreadId)).providerSessions[0]?.cwd,
        secondSession.cwd,
      );
      assert.isTrue((yield* maintenance.verify).valid);
      assert.isTrue((yield* maintenance.rebuild).valid);
    }),
  );

  it.effect("verifies and rebuilds projections with cross-thread subagent relations", () =>
    Effect.gen(function* () {
      const eventSink = yield* EventSink.EventSinkV2;
      const projectionStore = yield* ProjectionStore.ProjectionStoreV2;
      const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
      const sql = yield* SqlClient.SqlClient;
      const now = yield* DateTime.now;
      const parentThreadId = ThreadId.make("thread:foundation-cross-thread:parent");
      const childThreadId = ThreadId.make("thread:foundation-cross-thread:child");
      const childProviderThreadId = ProviderThreadId.make(
        "provider-thread:foundation-cross-thread:child",
      );
      const subagentId = NodeId.make("subagent:foundation-cross-thread");
      const spawnTransferId = ContextTransferId.make("transfer:foundation-cross-thread:spawn");
      const resultTransferId = ContextTransferId.make("transfer:foundation-cross-thread:result");
      const parentThread = makeThread(parentThreadId, now);
      const childThread = {
        ...makeThread(childThreadId, now),
        createdBy: "agent" as const,
        creationSource: "provider" as const,
        lineage: {
          parentThreadId,
          relationshipToParent: "subagent" as const,
          rootThreadId: parentThreadId,
        },
      };

      yield* eventSink.write({
        events: [
          threadCreatedEvent({
            id: "event:foundation-cross-thread:parent",
            thread: parentThread,
            now,
          }),
          threadCreatedEvent({
            id: "event:foundation-cross-thread:child",
            thread: childThread,
            now,
          }),
          {
            id: EventId.make("event:foundation-cross-thread:subagent"),
            type: "subagent.updated",
            threadId: parentThreadId,
            nodeId: subagentId,
            providerInstanceId,
            occurredAt: now,
            payload: {
              id: subagentId,
              threadId: parentThreadId,
              runId: null,
              parentNodeId: NodeId.make("node:foundation-cross-thread:parent"),
              origin: "app_owned",
              createdBy: "agent",
              driver: providerDriver,
              providerInstanceId,
              providerThreadId: childProviderThreadId,
              childThreadId,
              nativeTaskRef: null,
              prompt: "Inspect the child flow",
              title: "Cross-thread child",
              model: modelSelection.model,
              status: "completed",
              result: "done",
              startedAt: now,
              completedAt: now,
              updatedAt: now,
            },
          },
          {
            id: EventId.make("event:foundation-cross-thread:spawn-transfer"),
            type: "context-transfer.created",
            threadId: childThreadId,
            providerInstanceId,
            occurredAt: now,
            payload: {
              id: spawnTransferId,
              type: "subagent_spawn",
              sourceThreadId: parentThreadId,
              targetThreadId: childThreadId,
              sourcePoint: { threadId: parentThreadId },
              basePoint: null,
              sourceProviderInstanceId: providerInstanceId,
              targetProviderInstanceId: providerInstanceId,
              targetRunId: null,
              status: "consumed",
              resolution: null,
              createdBy: "agent",
              error: null,
              createdAt: now,
              updatedAt: now,
              consumedAt: now,
            },
          },
          {
            id: EventId.make("event:foundation-cross-thread:provider-thread"),
            type: "provider-thread.updated",
            threadId: parentThreadId,
            driver: providerDriver,
            providerInstanceId,
            occurredAt: now,
            payload: {
              id: childProviderThreadId,
              driver: providerDriver,
              providerInstanceId,
              providerSessionId: null,
              appThreadId: childThreadId,
              ownerNodeId: null,
              nativeThreadRef: null,
              nativeConversationHeadRef: null,
              status: "idle",
              firstRunOrdinal: 1,
              lastRunOrdinal: 1,
              handoffIds: [],
              forkedFrom: null,
              createdAt: now,
              updatedAt: now,
            },
          },
          {
            id: EventId.make("event:foundation-cross-thread:result-transfer"),
            type: "context-transfer.created",
            threadId: parentThreadId,
            providerInstanceId,
            occurredAt: now,
            payload: {
              id: resultTransferId,
              type: "subagent_result",
              sourceThreadId: childThreadId,
              targetThreadId: parentThreadId,
              sourcePoint: { threadId: childThreadId },
              basePoint: null,
              sourceProviderInstanceId: providerInstanceId,
              targetProviderInstanceId: providerInstanceId,
              targetRunId: null,
              status: "consumed",
              resolution: null,
              createdBy: "system",
              error: null,
              createdAt: now,
              updatedAt: now,
              consumedAt: now,
            },
          },
        ],
      });

      const assertCrossThreadProjection = Effect.gen(function* () {
        const parent = yield* projectionStore.getThreadProjection(parentThreadId);
        const child = yield* projectionStore.getThreadProjection(childThreadId);
        const expectedTransferIds = [spawnTransferId, resultTransferId].toSorted();
        assert.deepEqual(
          parent.contextTransfers.map((transfer) => transfer.id).toSorted(),
          expectedTransferIds,
        );
        assert.deepEqual(
          child.contextTransfers.map((transfer) => transfer.id).toSorted(),
          expectedTransferIds,
        );
        assert.deepEqual(
          parent.providerThreads.map((providerThread) => providerThread.id),
          [childProviderThreadId],
        );
        assert.equal(child.thread.activeProviderThreadId, childProviderThreadId);
      });

      yield* assertCrossThreadProjection;
      assert.isTrue((yield* maintenance.verify).valid);
      yield* sql`
        UPDATE orchestration_v2_projection_provider_threads SET payload_json = '{}'
        WHERE provider_thread_id = ${childProviderThreadId}
      `;
      assert.deepEqual(
        new Set((yield* maintenance.verify).unreadableThreadIds),
        new Set([parentThreadId, childThreadId]),
      );
      assert.isTrue((yield* maintenance.rebuild).valid);
      yield* assertCrossThreadProjection;
    }),
  );

  it.effect(
    "rolls back events, projections, receipts, and effects after a projection failure",
    () =>
      Effect.gen(function* () {
        const eventSink = yield* EventSink.EventSinkV2;
        const eventStore = yield* EventStore.EventStoreV2;
        const receipts = yield* CommandReceiptStore.CommandReceiptStoreV2;
        const outbox = yield* EffectOutbox.EffectOutboxV2;
        const sql = yield* SqlClient.SqlClient;
        const now = yield* DateTime.now;
        const commandId = CommandId.make("command:foundation-atomic-failure");
        const threadId = ThreadId.make("thread:foundation-atomic-failure");
        const scopeId = CheckpointScopeId.make("scope:foundation-atomic-failure");
        const checkpoint = (index: number) => ({
          id: CheckpointId.make(`checkpoint:foundation-atomic-failure:${index}`),
          threadId,
          scopeId,
          runId: null,
          nodeId: NodeId.make("node:foundation-atomic-failure"),
          parentCheckpointId: null,
          ordinalWithinScope: 1,
          appRunOrdinal: null,
          ref: CheckpointRef.make(`checkpoint-ref:foundation-atomic-failure:${index}`),
          status: "ready" as const,
          files: [],
          capturedAt: now,
        });
        const events = [1, 2].map(
          (index) =>
            ({
              id: EventId.make(`event:foundation-atomic-failure:${index}`),
              type: "checkpoint.captured",
              threadId,
              occurredAt: now,
              payload: checkpoint(index),
            }) satisfies OrchestrationV2DomainEvent,
        );

        const exit = yield* Effect.exit(
          eventSink.commitCommand({
            commandId,
            threadId,
            commandType: "checkpoint.atomicity-test",
            acceptedAt: now,
            events,
            effects: [
              {
                id: "effect:foundation-atomic-failure",
                commandId,
                threadId,
                request: {
                  type: "provider-turn.start",
                  runId: RunId.make("run:foundation-atomic-failure"),
                },
              },
            ],
          }),
        );
        assert.equal(exit._tag, "Failure");
        assert.isTrue(Option.isNone(yield* receipts.getByCommandId(commandId)));
        assert.deepEqual(yield* outbox.listByCommandId(commandId), []);
        assert.deepEqual(
          yield* eventStore.readByCommandId({ commandId }).pipe(
            Stream.runCollect,
            Effect.map((events) => Array.from(events)),
          ),
          [],
        );
        const checkpointRows = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count
        FROM orchestration_v2_projection_checkpoints
        WHERE thread_id = ${threadId}
      `;
        assert.equal(checkpointRows[0]?.count, 0);
      }),
  );

  it.effect("replays every command event across bounded persistence pages", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const eventStore = yield* EventStore.EventStoreV2;
      const eventSink = yield* EventSink.EventSinkV2;
      const now = yield* DateTime.now;
      const occurredAt = DateTime.formatIso(now);
      const commandId = CommandId.make("command:paged-command-replay");
      const exactPageCommandId = CommandId.make("command:paged-command-replay:exact");
      const emptyCommandId = CommandId.make("command:paged-command-replay:empty");
      const threadId = "thread:paged-command-replay";

      const eventRow = (
        ordinal: number,
        input: {
          readonly commandId?: string | null;
          readonly aggregateKind?: "project" | "thread";
          readonly streamId?: string;
          readonly version?: number;
        } = {},
      ) => ({
        event_id: `event:paged-command-replay:${ordinal}`,
        aggregate_kind: input.aggregateKind ?? "thread",
        stream_id: input.streamId ?? threadId,
        stream_version: ordinal,
        event_type: "provider-session.detached",
        occurred_at: occurredAt,
        command_id: input.commandId ?? null,
        causation_event_id: null,
        correlation_id: null,
        actor_kind: "server",
        payload_json: JSON.stringify({
          providerSessionId: `session:paged-command-replay:${ordinal}`,
          detachedAt: occurredAt,
        }),
        metadata_json: "{}",
        application_event_version: input.version ?? 2,
      });

      const matchingCount = 1_001;
      const rows: Array<ReturnType<typeof eventRow>> = [];
      let ordinal = 0;
      for (let index = 0; index < matchingCount; index += 1) {
        rows.push(eventRow(++ordinal, { commandId }));
        if (index % 2 === 0) {
          rows.push(eventRow(++ordinal, { commandId: "command:unrelated" }));
        }
        if (index % 5 === 0) {
          rows.push(eventRow(++ordinal));
          rows.push(eventRow(++ordinal, { commandId, version: 1 }));
          rows.push(
            eventRow(++ordinal, {
              commandId,
              aggregateKind: "project",
              streamId: `project:paged-command-replay:${index}`,
            }),
          );
        }
      }
      for (let index = 0; index < 500; index += 1) {
        rows.push(eventRow(++ordinal, { commandId: exactPageCommandId }));
      }
      const inserted = yield* Effect.forEach(
        Array.from({ length: Math.ceil(rows.length / 400) }, (_, chunk) =>
          rows.slice(chunk * 400, (chunk + 1) * 400),
        ),
        (chunk) =>
          sql<{
            readonly sequence: number;
            readonly command_id: string | null;
            readonly aggregate_kind: string;
            readonly application_event_version: number;
          }>`
            INSERT INTO orchestration_events ${sql.insert(chunk)}
            RETURNING sequence, command_id, aggregate_kind, application_event_version
          `,
        { concurrency: 1 },
      ).pipe(Effect.map((chunks) => chunks.flat()));
      const expectedSequences = inserted
        .filter(
          (row) =>
            row.command_id === commandId &&
            row.aggregate_kind === "thread" &&
            row.application_event_version === 2,
        )
        .map((row) => row.sequence);
      assert.lengthOf(expectedSequences, matchingCount);

      yield* sql`
        INSERT INTO orchestration_command_receipts (
          command_id, aggregate_kind, aggregate_id, accepted_at, result_sequence, status, command_type
        )
        VALUES (
          ${commandId}, 'thread', ${threadId}, ${occurredAt},
          ${expectedSequences.at(-1)!}, 'accepted', 'thread.create'
        )
      `;

      const pageLimits: Array<number> = [];
      const recordReads: Statement.Transformer = (statement) => {
        const [query, params] = statement.compile();
        if (query.includes("FROM orchestration_events") && query.includes("command_id")) {
          const limit = params.at(-1);
          if (typeof limit === "number") {
            pageLimits.push(limit);
          }
        }
        return Effect.succeed(statement);
      };
      const collectByCommandId = (id: CommandId) =>
        eventStore.readByCommandId({ commandId: id }).pipe(
          Stream.provideService(Statement.CurrentTransformer, recordReads),
          Stream.runCollect,
          Effect.map((events) => Array.from(events)),
        );

      const replayed = yield* collectByCommandId(commandId);
      assert.deepEqual(
        replayed.map((stored) => stored.sequence),
        expectedSequences,
      );
      assert.deepEqual(pageLimits, [500, 500, 500]);

      pageLimits.length = 0;
      const exactPage = yield* collectByCommandId(exactPageCommandId);
      assert.lengthOf(exactPage, 500);
      assert.deepEqual(pageLimits, [500, 500]);

      pageLimits.length = 0;
      const empty = yield* collectByCommandId(emptyCommandId);
      assert.lengthOf(empty, 0);
      assert.deepEqual(pageLimits, [500]);

      pageLimits.length = 0;
      const retried = yield* eventSink
        .commitCommand({
          commandId,
          threadId: ThreadId.make(threadId),
          commandType: "thread.create",
          acceptedAt: now,
          events: [
            threadCreatedEvent({
              id: "event:paged-command-replay:retry",
              thread: makeThread(ThreadId.make(threadId), now),
              now,
            }),
          ],
          effects: [],
        })
        .pipe(Effect.provideService(Statement.CurrentTransformer, recordReads));
      assert.isFalse(retried.committed);
      assert.equal(retried.receipt.resultSequence, expectedSequences.at(-1));
      assert.deepEqual(
        retried.storedEvents.map((stored) => stored.sequence),
        expectedSequences,
      );
      assert.deepEqual(pageLimits, [500, 500, 500]);
    }),
  );

  it.effect("keeps one durable effect across command retries and executes it after recovery", () =>
    Effect.gen(function* () {
      const eventSink = yield* EventSink.EventSinkV2;
      const outbox = yield* EffectOutbox.EffectOutboxV2;
      const now = yield* DateTime.now;
      const commandId = CommandId.make("command:foundation-effect-recovery");
      const threadId = ThreadId.make("thread:foundation-effect-recovery");
      const thread = makeThread(threadId, now);
      const event = threadCreatedEvent({
        id: "event:foundation-effect-recovery",
        thread,
        now,
      });
      const effect = {
        id: "effect:foundation-effect-recovery",
        commandId,
        threadId,
        request: {
          type: "provider-turn.start" as const,
          runId: RunId.make("run:foundation-effect-recovery"),
        },
      };

      const first = yield* eventSink.commitCommand({
        commandId,
        threadId,
        commandType: "foundation.effect-recovery",
        acceptedAt: now,
        events: [event],
        effects: [effect],
      });
      const retry = yield* eventSink.commitCommand({
        commandId,
        threadId,
        commandType: "foundation.effect-recovery",
        acceptedAt: now,
        events: [event],
        effects: [effect],
      });

      assert.isTrue(first.committed);
      assert.isFalse(retry.committed);
      assert.equal(retry.receipt.resultSequence, first.receipt.resultSequence);
      assert.lengthOf(retry.storedEvents, 1);
      assert.lengthOf(yield* outbox.listByCommandId(commandId), 1);

      const executionCount = yield* Ref.make(0);
      const executorLayer = Layer.succeed(
        EffectWorker.OrchestrationEffectExecutorV2,
        EffectWorker.OrchestrationEffectExecutorV2.of({
          execute: () => Ref.update(executionCount, (count) => count + 1),
        }),
      );
      const workerLayer = EffectWorker.layerWithOptions({ workerId: "recovery-worker" }).pipe(
        Layer.provide(
          Layer.merge(Layer.succeed(EffectOutbox.EffectOutboxV2, outbox), executorLayer),
        ),
      );
      yield* Effect.gen(function* () {
        const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
        assert.isTrue(yield* worker.runOnce);
        assert.isFalse(yield* worker.runOnce);
      }).pipe(Effect.provide(workerLayer));

      assert.equal(yield* Ref.get(executionCount), 1);
      const storedEffect = yield* outbox.get(effect.id);
      assert.isTrue(Option.isSome(storedEffect));
      if (Option.isSome(storedEffect)) {
        assert.equal(storedEffect.value.status, "succeeded");
      }
    }),
  );

  it.effect("does not wake claimers for effects from an idempotent command retry", () =>
    Effect.gen(function* () {
      const eventSink = yield* EventSink.EventSinkV2;
      const outbox = yield* EffectOutbox.EffectOutboxV2;
      const now = yield* DateTime.now;
      const commandId = CommandId.make("command:foundation-idempotent-wakeup");
      const threadId = ThreadId.make("thread:foundation-idempotent-wakeup");
      const input = {
        commandId,
        threadId,
        commandType: "foundation.idempotent-wakeup",
        acceptedAt: now,
        events: [
          threadCreatedEvent({
            id: "event:foundation-idempotent-wakeup",
            thread: makeThread(threadId, now),
            now,
          }),
        ],
        effects: [
          {
            id: "effect:foundation-idempotent-wakeup",
            commandId,
            threadId,
            request: { type: "terminal.cleanup" as const },
          },
        ],
      };

      assert.isTrue((yield* eventSink.commitCommand(input)).committed);
      yield* outbox.awaitAvailable;
      assert.isFalse((yield* eventSink.commitCommand(input)).committed);

      const unexpectedWake = yield* outbox.awaitAvailable.pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      assert.isUndefined(unexpectedWake.pollUnsafe());
    }).pipe(Effect.provide(Layer.fresh(TestLayer))),
  );

  it.effect("does not publish a stale provider start after an interrupt wins", () =>
    Effect.gen(function* () {
      const eventSink = yield* EventSink.EventSinkV2;
      const projectionStore = yield* ProjectionStore.ProjectionStoreV2;
      const now = yield* DateTime.now;
      const threadId = ThreadId.make("thread:foundation-stale-provider-start");
      const runId = RunId.make("run:foundation-stale-provider-start");
      const attemptId = RunAttemptId.make("run-attempt:foundation-stale-provider-start");
      const thread = makeThread(threadId, now);
      const startingRun: OrchestrationV2Run = {
        id: runId,
        threadId,
        ordinal: 1,
        providerInstanceId,
        modelSelection,
        providerThreadId: null,
        userMessageId: MessageId.make("message:foundation-stale-provider-start"),
        rootNodeId: null,
        activeAttemptId: attemptId,
        status: "starting",
        queuePosition: null,
        requestedAt: now,
        startedAt: null,
        completedAt: null,
        checkpointId: null,
        contextHandoffId: null,
      };
      yield* eventSink.write({
        events: [
          threadCreatedEvent({
            id: "event:foundation-stale-provider-start:thread",
            thread,
            now,
          }),
          {
            id: EventId.make("event:foundation-stale-provider-start:run"),
            type: "run.created",
            threadId,
            runId,
            providerInstanceId,
            occurredAt: now,
            payload: startingRun,
          },
        ],
      });

      const reachedPrecommitGap = yield* Deferred.make<void>();
      const releaseStaleStart = yield* Deferred.make<void>();
      const providerStartCount = yield* Ref.make(0);
      const staleStartFiber = yield* Effect.gen(function* () {
        yield* Deferred.succeed(reachedPrecommitGap, undefined);
        yield* Deferred.await(releaseStaleStart);
        const result = yield* eventSink.writeIfRunCurrent({
          threadId,
          runId,
          activeAttemptId: attemptId,
          expectedStatus: "starting",
          events: [
            {
              id: EventId.make("event:foundation-stale-provider-start:running"),
              type: "run.updated",
              threadId,
              runId,
              providerInstanceId,
              occurredAt: now,
              payload: { ...startingRun, status: "running", startedAt: now },
            },
          ],
        });
        if (result.committed) {
          yield* Ref.update(providerStartCount, (count) => count + 1);
        }
        return result;
      }).pipe(Effect.forkChild);

      yield* Deferred.await(reachedPrecommitGap);
      const interruptedAt = yield* DateTime.now;
      yield* eventSink.write({
        events: [
          {
            id: EventId.make("event:foundation-stale-provider-start:cancelled"),
            type: "run.updated",
            threadId,
            runId,
            providerInstanceId,
            occurredAt: interruptedAt,
            payload: {
              ...startingRun,
              status: "cancelled",
              completedAt: interruptedAt,
            },
          },
        ],
      });
      yield* Deferred.succeed(releaseStaleStart, undefined);

      const staleResult = yield* Fiber.join(staleStartFiber);
      assert.isFalse(staleResult.committed);
      assert.deepEqual(staleResult.storedEvents, []);
      assert.equal(yield* Ref.get(providerStartCount), 0);
      const projection = yield* projectionStore.getThreadProjection(threadId);
      assert.equal(projection.runs[0]?.status, "cancelled");
    }),
  );

  it.effect("guards post-terminal provider-thread writes by attempt and run ordinal", () =>
    Effect.gen(function* () {
      const eventSink = yield* EventSink.EventSinkV2;
      const projectionStore = yield* ProjectionStore.ProjectionStoreV2;
      const now = yield* DateTime.now;
      const threadId = ThreadId.make("thread:foundation-provider-thread-owner");
      const runId = RunId.make("run:foundation-provider-thread-owner");
      const attemptId = RunAttemptId.make("attempt:foundation-provider-thread-owner");
      const replacementAttemptId = RunAttemptId.make(
        "attempt:foundation-provider-thread-owner:replacement",
      );
      const rootNodeId = NodeId.make("node:foundation-provider-thread-owner");
      const providerThreadId = ProviderThreadId.make(
        "provider-thread:foundation-provider-thread-owner",
      );
      const thread = makeThread(threadId, now);
      const run: OrchestrationV2Run = {
        id: runId,
        threadId,
        ordinal: 1,
        providerInstanceId,
        modelSelection,
        providerThreadId,
        userMessageId: MessageId.make("message:foundation-provider-thread-owner"),
        rootNodeId,
        activeAttemptId: attemptId,
        status: "completed",
        queuePosition: null,
        requestedAt: now,
        startedAt: now,
        completedAt: now,
        checkpointId: null,
        contextHandoffId: null,
      };
      const baseProviderThread = {
        id: providerThreadId,
        driver: providerDriver,
        providerInstanceId,
        providerSessionId: null,
        appThreadId: threadId,
        ownerNodeId: null,
        nativeThreadRef: null,
        nativeConversationHeadRef: null,
        status: "idle" as const,
        firstRunOrdinal: 1,
        lastRunOrdinal: 1,
        handoffIds: [] as const,
        forkedFrom: null,
        pendingBackgroundTasks: [
          { taskId: "bg-owner", description: "sleep 20", kind: "command" as const },
        ],
        createdAt: now,
        updatedAt: now,
      };

      yield* eventSink.write({
        events: [
          threadCreatedEvent({
            id: "event:foundation-provider-thread-owner:thread",
            thread,
            now,
          }),
          {
            id: EventId.make("event:foundation-provider-thread-owner:run"),
            type: "run.created",
            threadId,
            runId,
            nodeId: rootNodeId,
            providerInstanceId,
            occurredAt: now,
            payload: run,
          },
          {
            id: EventId.make("event:foundation-provider-thread-owner:provider-thread"),
            type: "provider-thread.updated",
            threadId,
            driver: providerDriver,
            providerInstanceId,
            occurredAt: now,
            payload: baseProviderThread,
          },
        ],
      });

      const ownedClear = yield* eventSink.writeIfProviderThreadOwner({
        providerThreadId,
        runId,
        activeAttemptId: attemptId,
        expectedLastRunOrdinal: 1,
        events: [
          {
            id: EventId.make("event:foundation-provider-thread-owner:clear"),
            type: "provider-thread.updated",
            threadId,
            driver: providerDriver,
            providerInstanceId,
            occurredAt: now,
            payload: {
              ...baseProviderThread,
              pendingBackgroundTasks: [],
              updatedAt: now,
            },
          },
        ],
      });
      assert.isTrue(ownedClear.committed);
      assert.equal(ownedClear.storedEvents.length, 1);

      const afterReplacement = yield* DateTime.now;
      yield* eventSink.write({
        events: [
          {
            id: EventId.make("event:foundation-provider-thread-owner:replacement-attempt"),
            type: "run.updated",
            threadId,
            runId,
            nodeId: rootNodeId,
            providerInstanceId,
            occurredAt: afterReplacement,
            payload: {
              ...run,
              activeAttemptId: replacementAttemptId,
              status: "running",
            },
          },
        ],
      });

      const supersededAttemptWrite = yield* eventSink.writeIfProviderThreadOwner({
        providerThreadId,
        runId,
        activeAttemptId: attemptId,
        expectedLastRunOrdinal: 1,
        events: [
          {
            id: EventId.make("event:foundation-provider-thread-owner:superseded-attempt"),
            type: "provider-thread.updated",
            threadId,
            driver: providerDriver,
            providerInstanceId,
            occurredAt: afterReplacement,
            payload: {
              ...baseProviderThread,
              status: "active",
              pendingBackgroundTasks: [
                {
                  taskId: "bg-superseded",
                  description: "should not land",
                  kind: "command" as const,
                },
              ],
              updatedAt: afterReplacement,
            },
          },
        ],
      });
      assert.isFalse(supersededAttemptWrite.committed);
      assert.deepEqual(supersededAttemptWrite.storedEvents, []);

      yield* eventSink.write({
        events: [
          {
            id: EventId.make("event:foundation-provider-thread-owner:replacement-completed"),
            type: "run.updated",
            threadId,
            runId,
            nodeId: rootNodeId,
            providerInstanceId,
            occurredAt: afterReplacement,
            payload: {
              ...run,
              activeAttemptId: replacementAttemptId,
            },
          },
          {
            id: EventId.make("event:foundation-provider-thread-owner:newer-run"),
            type: "provider-thread.updated",
            threadId,
            driver: providerDriver,
            providerInstanceId,
            occurredAt: afterReplacement,
            payload: {
              ...baseProviderThread,
              lastRunOrdinal: 2,
              status: "active",
              pendingBackgroundTasks: [],
              updatedAt: afterReplacement,
            },
          },
        ],
      });

      const staleOrdinalWrite = yield* eventSink.writeIfProviderThreadOwner({
        providerThreadId,
        runId,
        activeAttemptId: replacementAttemptId,
        expectedLastRunOrdinal: 1,
        events: [
          {
            id: EventId.make("event:foundation-provider-thread-owner:stale-ordinal"),
            type: "provider-thread.updated",
            threadId,
            driver: providerDriver,
            providerInstanceId,
            occurredAt: afterReplacement,
            payload: baseProviderThread,
          },
        ],
      });
      assert.isFalse(staleOrdinalWrite.committed);
      assert.deepEqual(staleOrdinalWrite.storedEvents, []);

      const projection = yield* projectionStore.getThreadProjection(threadId);
      const providerThread = projection.providerThreads.find(
        (candidate) => candidate.id === providerThreadId,
      );
      assert.isDefined(providerThread);
      assert.equal(providerThread?.lastRunOrdinal, 2);
      assert.equal(providerThread?.status, "active");
      assert.deepEqual(providerThread?.pendingBackgroundTasks ?? [], []);
    }),
  );

  it.effect("interrupts a running process-bound effect when it is cancelled", () =>
    Effect.gen(function* () {
      const outbox = yield* EffectOutbox.EffectOutboxV2;
      const commandId = CommandId.make("command:foundation-cancel-running-effect");
      const threadId = ThreadId.make("thread:foundation-cancel-running-effect");
      const effectId = "effect:foundation-cancel-running-effect";
      const started = yield* Deferred.make<void>();
      const interrupted = yield* Deferred.make<void>();
      yield* outbox.enqueue([
        {
          id: effectId,
          commandId,
          threadId,
          request: {
            type: "provider-turn.start",
            runId: RunId.make("run:foundation-cancel-running-effect"),
          },
        },
      ]);

      const executorLayer = Layer.succeed(
        EffectWorker.OrchestrationEffectExecutorV2,
        EffectWorker.OrchestrationEffectExecutorV2.of({
          execute: () =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Effect.never),
              Effect.onInterrupt(() =>
                Deferred.succeed(interrupted, undefined).pipe(Effect.ignore),
              ),
            ),
        }),
      );
      const workerLayer = EffectWorker.layerWithOptions({
        workerId: "cancellation-worker",
      }).pipe(
        Layer.provide(
          Layer.merge(Layer.succeed(EffectOutbox.EffectOutboxV2, outbox), executorLayer),
        ),
      );

      yield* Effect.gen(function* () {
        const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
        const workerFiber = yield* worker.runOnce.pipe(Effect.forkChild);
        yield* Deferred.await(started);
        const cancelledEffectIds = yield* outbox.cancelUnsettled({
          threadId,
          effectTypes: ["provider-turn.start"],
          reason: "The owning run was interrupted.",
        });
        assert.deepEqual(cancelledEffectIds, [effectId]);
        yield* outbox.signalCancellations(cancelledEffectIds);
        assert.isTrue(yield* Fiber.join(workerFiber));
        yield* Deferred.await(interrupted);
      }).pipe(Effect.provide(workerLayer));

      const cancelled = yield* outbox.get(effectId);
      assert.isTrue(Option.isSome(cancelled));
      if (Option.isSome(cancelled)) assert.equal(cancelled.value.status, "cancelled");
    }),
  );

  it.effect("treats cancellation between execution and settlement as a normal outcome", () =>
    Effect.gen(function* () {
      const effectId = "effect:foundation-cancel-before-settlement";
      const threadId = ThreadId.make("thread:foundation-cancel-before-settlement");
      const commandId = CommandId.make("command:foundation-cancel-before-settlement");
      const now = DateTime.formatIso(yield* DateTime.now);
      const claimedEffect = {
        id: effectId,
        commandId,
        threadId,
        request: { type: "terminal.cleanup" as const },
        status: "running" as const,
        attemptCount: 1,
        availableAt: now,
        leaseOwner: "settlement-race-worker",
        leaseExpiresAt: now,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        lastError: null,
      };
      const outboxLayer = Layer.mock(EffectOutbox.EffectOutboxV2)({
        claimNext: () => Effect.succeed(Option.some(claimedEffect)),
        awaitCancellation: () => Effect.never,
        clearCancellation: () => Effect.void,
        succeed: () => Effect.succeed(false),
        get: () =>
          Effect.succeed(
            Option.some({
              ...claimedEffect,
              status: "cancelled" as const,
              leaseOwner: null,
              leaseExpiresAt: null,
              completedAt: now,
            }),
          ),
      });
      const executorLayer = Layer.succeed(
        EffectWorker.OrchestrationEffectExecutorV2,
        EffectWorker.OrchestrationEffectExecutorV2.of({ execute: () => Effect.void }),
      );
      const workerLayer = EffectWorker.layerWithOptions({
        workerId: "settlement-race-worker",
      }).pipe(Layer.provide(Layer.merge(outboxLayer, executorLayer)));

      assert.isTrue(
        yield* EffectWorker.OrchestrationEffectWorkerV2.pipe(
          Effect.flatMap((worker) => worker.runOnce),
          Effect.provide(workerLayer),
        ),
      );
    }),
  );

  it.effect("does not start an effect that was cancelled during claim registration", () =>
    Effect.gen(function* () {
      const effectId = "effect:foundation-cancelled-during-claim";
      const threadId = ThreadId.make("thread:foundation-cancelled-during-claim");
      const commandId = CommandId.make("command:foundation-cancelled-during-claim");
      const now = DateTime.formatIso(yield* DateTime.now);
      const claimedEffect = {
        id: effectId,
        commandId,
        threadId,
        request: { type: "terminal.cleanup" as const },
        status: "running" as const,
        attemptCount: 1,
        availableAt: now,
        leaseOwner: "claim-cancellation-worker",
        leaseExpiresAt: now,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        lastError: null,
      };
      const executionCount = yield* Ref.make(0);
      const outboxLayer = Layer.mock(EffectOutbox.EffectOutboxV2)({
        claimNext: () => Effect.succeed(Option.some(claimedEffect)),
        get: () =>
          Effect.succeed(
            Option.some({
              ...claimedEffect,
              status: "cancelled" as const,
              leaseOwner: null,
              leaseExpiresAt: null,
              completedAt: now,
            }),
          ),
        clearCancellation: () => Effect.void,
        awaitCancellation: () => Effect.never,
      });
      const executorLayer = Layer.succeed(
        EffectWorker.OrchestrationEffectExecutorV2,
        EffectWorker.OrchestrationEffectExecutorV2.of({
          execute: () => Ref.update(executionCount, (count) => count + 1),
        }),
      );
      const workerLayer = EffectWorker.layerWithOptions({
        workerId: "claim-cancellation-worker",
      }).pipe(Layer.provide(Layer.merge(outboxLayer, executorLayer)));

      assert.isTrue(
        yield* EffectWorker.OrchestrationEffectWorkerV2.pipe(
          Effect.flatMap((worker) => worker.runOnce),
          Effect.provide(workerLayer),
        ),
      );
      assert.equal(yield* Ref.get(executionCount), 0);
    }),
  );

  it.effect("allows only one worker to claim an available effect", () =>
    Effect.gen(function* () {
      const outbox = yield* EffectOutbox.EffectOutboxV2;
      const commandId = CommandId.make("command:foundation-exclusive-claim");
      yield* outbox.enqueue([
        {
          id: "effect:foundation-exclusive-claim",
          commandId,
          threadId: ThreadId.make("thread:foundation-exclusive-claim"),
          request: {
            type: "provider-turn.start",
            runId: RunId.make("run:foundation-exclusive-claim"),
          },
        },
      ]);

      const claims = yield* Effect.all(
        [
          outbox.claimNext({ workerId: "worker-a", leaseDurationMs: 30_000 }),
          outbox.claimNext({ workerId: "worker-b", leaseDurationMs: 30_000 }),
        ],
        { concurrency: "unbounded" },
      );
      assert.equal(claims.filter(Option.isSome).length, 1);
      assert.equal(claims.filter(Option.isNone).length, 1);
      const claimedByA = claims[0];
      const claimedByB = claims[1];
      if (Option.isSome(claimedByA)) {
        yield* outbox.succeed({ effectId: claimedByA.value.id, workerId: "worker-a" });
      }
      if (Option.isSome(claimedByB)) {
        yield* outbox.succeed({ effectId: claimedByB.value.id, workerId: "worker-b" });
      }
    }),
  );

  it.effect("runs title generation beside critical work while serializing each lane", () =>
    Effect.gen(function* () {
      const outbox = yield* EffectOutbox.EffectOutboxV2;
      const commandId = CommandId.make("command:foundation-title-effect-lane");
      const threadId = ThreadId.make("thread:foundation-title-effect-lane");
      const titleEffectId = "effect:foundation-title-effect-lane:a-title";
      const providerEffectId = "effect:foundation-title-effect-lane:b-provider";
      const nextTitleEffectId = "effect:foundation-title-effect-lane:c-title";
      const nextCriticalEffectId = "effect:foundation-title-effect-lane:d-critical";
      yield* outbox.enqueue([
        {
          id: titleEffectId,
          commandId,
          threadId,
          request: {
            type: "thread-title.generate",
            kind: {
              type: "initial",
              messageId: MessageId.make("message:foundation-title-effect-lane"),
            },
          },
        },
        {
          id: providerEffectId,
          commandId,
          threadId,
          request: {
            type: "provider-turn.start",
            runId: RunId.make("run:foundation-title-effect-lane"),
          },
        },
        {
          id: nextTitleEffectId,
          commandId,
          threadId,
          request: { type: "thread-title.generate", kind: { type: "regenerate" } },
        },
        {
          id: nextCriticalEffectId,
          commandId,
          threadId,
          request: { type: "terminal.cleanup" },
        },
      ]);

      const title = yield* outbox.claimNext({
        workerId: "title-lane-worker",
        leaseDurationMs: 30_000,
      });
      assert.isTrue(Option.isSome(title));
      if (Option.isNone(title)) return;
      assert.equal(title.value.id, titleEffectId);

      const provider = yield* outbox.claimNext({
        workerId: "critical-lane-worker",
        leaseDurationMs: 30_000,
      });
      assert.isTrue(Option.isSome(provider));
      if (Option.isNone(provider)) return;
      assert.equal(provider.value.id, providerEffectId);

      assert.isTrue(
        Option.isNone(
          yield* outbox.claimNext({
            workerId: "blocked-lanes-worker",
            leaseDurationMs: 30_000,
          }),
        ),
      );

      yield* outbox.succeed({
        effectId: provider.value.id,
        workerId: "critical-lane-worker",
      });
      const nextCritical = yield* outbox.claimNext({
        workerId: "critical-lane-worker",
        leaseDurationMs: 30_000,
      });
      assert.isTrue(Option.isSome(nextCritical));
      if (Option.isNone(nextCritical)) return;
      assert.equal(nextCritical.value.id, nextCriticalEffectId);
      yield* outbox.succeed({
        effectId: nextCritical.value.id,
        workerId: "critical-lane-worker",
      });

      yield* outbox.succeed({
        effectId: title.value.id,
        workerId: "title-lane-worker",
      });
      const nextTitle = yield* outbox.claimNext({
        workerId: "title-lane-worker",
        leaseDurationMs: 30_000,
      });
      assert.isTrue(Option.isSome(nextTitle));
      if (Option.isSome(nextTitle)) {
        assert.equal(nextTitle.value.id, nextTitleEffectId);
        yield* outbox.succeed({
          effectId: nextTitle.value.id,
          workerId: "title-lane-worker",
        });
      }
    }),
  );

  it.effect("ignores deadlines blocked by a running effect on the same thread", () =>
    Effect.gen(function* () {
      const outbox = yield* EffectOutbox.EffectOutboxV2;
      const now = yield* DateTime.now;
      const future = DateTime.add(now, { seconds: 10 });
      const commandId = CommandId.make("command:foundation-next-claimable");
      const blockedThreadId = ThreadId.make("thread:foundation-next-claimable:blocked");
      yield* outbox.enqueue([
        {
          id: "effect:foundation-next-claimable:a1",
          commandId,
          threadId: blockedThreadId,
          request: { type: "terminal.cleanup" },
        },
        {
          id: "effect:foundation-next-claimable:a2",
          commandId,
          threadId: blockedThreadId,
          request: { type: "terminal.cleanup" },
        },
        {
          id: "effect:foundation-next-claimable:b1",
          commandId,
          threadId: ThreadId.make("thread:foundation-next-claimable:future"),
          request: { type: "terminal.cleanup" },
          availableAt: future,
        },
      ]);

      const claimed = yield* outbox.claimNext({
        workerId: "next-claimable-worker",
        leaseDurationMs: 30_000,
      });
      assert.isTrue(Option.isSome(claimed));
      if (Option.isNone(claimed)) return;
      assert.equal(claimed.value.id, "effect:foundation-next-claimable:a1");

      const whileBlocked = yield* outbox.nextClaimableAt;
      assert.isTrue(Option.isSome(whileBlocked));
      if (Option.isSome(whileBlocked)) {
        assert.equal(DateTime.toEpochMillis(whileBlocked.value), DateTime.toEpochMillis(future));
      }

      yield* outbox.succeed({
        effectId: claimed.value.id,
        workerId: "next-claimable-worker",
      });
      const afterCompletion = yield* outbox.nextClaimableAt;
      assert.isTrue(Option.isSome(afterCompletion));
      if (Option.isSome(afterCompletion)) {
        assert.isAtMost(DateTime.toEpochMillis(afterCompletion.value), DateTime.toEpochMillis(now));
      }

      const unblocked = yield* outbox.claimNext({
        workerId: "next-claimable-worker",
        leaseDurationMs: 30_000,
      });
      assert.isTrue(Option.isSome(unblocked));
      if (Option.isSome(unblocked)) {
        assert.equal(unblocked.value.id, "effect:foundation-next-claimable:a2");
        yield* outbox.succeed({
          effectId: unblocked.value.id,
          workerId: "next-claimable-worker",
        });
      }
      yield* outbox.cancelUnsettled({
        threadId: ThreadId.make("thread:foundation-next-claimable:future"),
        effectTypes: ["terminal.cleanup"],
        reason: "Test cleanup.",
      });
    }),
  );

  it.effect("does not emit a SQL span for an empty safety claim", () =>
    Effect.gen(function* () {
      const outbox = yield* EffectOutbox.EffectOutboxV2;
      const spans: Array<string> = [];
      const tracer = Tracer.make({
        span: (options) => {
          const span = new Tracer.NativeSpan(options);
          const end = span.end.bind(span);
          span.end = (endTime, exit) => {
            end(endTime, exit);
            spans.push(span.name);
          };
          return span;
        },
      });

      const claim = yield* outbox
        .claimNext({ workerId: "idle-safety-worker", leaseDurationMs: 30_000 })
        .pipe(Effect.withTracer(tracer));

      assert.isTrue(Option.isNone(claim));
      assert.notInclude(spans, "sql.execute");
    }).pipe(Effect.provide(Layer.fresh(effectOutboxProvided))),
  );

  it.effect("wakes claimers when cancellation unblocks same-thread work", () =>
    Effect.gen(function* () {
      const outbox = yield* EffectOutbox.EffectOutboxV2;
      const commandId = CommandId.make("command:foundation-cancellation-wakeup");
      const threadId = ThreadId.make("thread:foundation-cancellation-wakeup");
      yield* outbox.enqueue([
        {
          id: "effect:foundation-cancellation-wakeup:a-running",
          commandId,
          threadId,
          request: {
            type: "provider-turn.start",
            runId: RunId.make("run:foundation-cancellation-wakeup"),
          },
        },
        {
          id: "effect:foundation-cancellation-wakeup:b-pending",
          commandId,
          threadId,
          request: { type: "terminal.cleanup" },
        },
      ]);

      const running = yield* outbox.claimNext({
        workerId: "cancellation-wakeup-worker",
        leaseDurationMs: 30_000,
      });
      assert.isTrue(Option.isSome(running));
      if (Option.isNone(running)) return;
      assert.equal(running.value.request.type, "provider-turn.start");

      const cancelledEffectIds = yield* outbox.cancelUnsettled({
        threadId,
        effectTypes: ["provider-turn.start"],
        reason: "Test cancellation wakeup.",
      });
      yield* outbox.signalCancellations(cancelledEffectIds);

      yield* outbox.awaitAvailable;

      const unblocked = yield* outbox.claimNext({
        workerId: "cancellation-wakeup-worker",
        leaseDurationMs: 30_000,
      });
      assert.isTrue(Option.isSome(unblocked));
      if (Option.isSome(unblocked)) {
        assert.equal(unblocked.value.request.type, "terminal.cleanup");
        yield* outbox.succeed({
          effectId: unblocked.value.id,
          workerId: "cancellation-wakeup-worker",
        });
      }
    }).pipe(Effect.provide(Layer.fresh(effectOutboxProvided))),
  );

  it.effect("executes a retry at its durable deadline instead of the liveness interval", () =>
    Effect.gen(function* () {
      const outbox = yield* EffectOutbox.EffectOutboxV2;
      const effectId = "effect:foundation-durable-retry-deadline";
      const commandId = CommandId.make("command:foundation-durable-retry-deadline");
      const threadId = ThreadId.make("thread:foundation-durable-retry-deadline");
      const executions = yield* Ref.make(0);
      const completed = yield* Deferred.make<void>();
      const retryScheduled = yield* Deferred.make<void>();
      const executorLayer = Layer.succeed(
        EffectWorker.OrchestrationEffectExecutorV2,
        EffectWorker.OrchestrationEffectExecutorV2.of({
          execute: () =>
            Effect.gen(function* () {
              const attempt = yield* Ref.updateAndGet(executions, (count) => count + 1);
              if (attempt === 1) {
                return yield* new EffectWorker.OrchestrationEffectExecutionError({
                  effectId,
                  effectType: "terminal.cleanup",
                  cause: "simulated retry",
                });
              }
              yield* Deferred.succeed(completed, undefined);
            }),
        }),
      );
      const workerLayer = EffectWorker.layerWithOptions({
        workerId: "durable-retry-deadline-worker",
      }).pipe(
        Layer.provide(
          Layer.merge(
            Layer.succeed(EffectOutbox.EffectOutboxV2, {
              ...outbox,
              retry: (input) =>
                outbox
                  .retry(input)
                  .pipe(Effect.tap(() => Deferred.succeed(retryScheduled, undefined))),
            }),
            executorLayer,
          ),
        ),
      );

      yield* Effect.gen(function* () {
        yield* EffectWorker.runDaemonWithOptions({
          concurrency: 1,
          livenessPollIntervalMs: 30_000,
        }).pipe(Effect.forkScoped);
        yield* outbox.enqueue([
          {
            id: effectId,
            commandId,
            threadId,
            request: { type: "terminal.cleanup" },
          },
        ]);
        yield* outbox.notifyAvailable();

        yield* Deferred.await(retryScheduled);

        yield* TestClock.adjust("99 millis");
        assert.equal(yield* Ref.get(executions), 1);
        yield* TestClock.adjust("1 millis");
        yield* Deferred.await(completed);
        assert.equal(yield* Ref.get(executions), 2);
      }).pipe(Effect.provide(workerLayer), Effect.scoped);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("runs distinct threads concurrently while serializing effects within a thread", () =>
    Effect.gen(function* () {
      const outbox = yield* EffectOutbox.EffectOutboxV2;
      const commandId = CommandId.make("command:foundation-concurrent-effects");
      const threadA = ThreadId.make("thread:foundation-concurrent-effects:a");
      const threadB = ThreadId.make("thread:foundation-concurrent-effects:b");
      const effectA1 = "effect:foundation-concurrent-effects:a1";
      const effectA2 = "effect:foundation-concurrent-effects:a2";
      const effectB1 = "effect:foundation-concurrent-effects:b1";
      const startedA1 = yield* Deferred.make<void>();
      const startedA2 = yield* Deferred.make<void>();
      const startedB1 = yield* Deferred.make<void>();
      const releaseA1 = yield* Deferred.make<void>();
      const releaseA2 = yield* Deferred.make<void>();
      const releaseB1 = yield* Deferred.make<void>();
      const settled = yield* Deferred.make<void>();
      const succeeded = yield* Ref.make(0);
      const gates = new Map([
        [effectA1, { started: startedA1, release: releaseA1 }],
        [effectA2, { started: startedA2, release: releaseA2 }],
        [effectB1, { started: startedB1, release: releaseB1 }],
      ]);
      const executorLayer = Layer.succeed(
        EffectWorker.OrchestrationEffectExecutorV2,
        EffectWorker.OrchestrationEffectExecutorV2.of({
          execute: (effect) => {
            const gate = gates.get(effect.id);
            if (gate === undefined) return Effect.die(`Missing gate for ${effect.id}`);
            return Deferred.succeed(gate.started, undefined).pipe(
              Effect.andThen(Deferred.await(gate.release)),
            );
          },
        }),
      );
      const workerLayer = EffectWorker.layerWithOptions({
        workerId: "concurrency-worker",
      }).pipe(
        Layer.provide(
          Layer.merge(
            Layer.succeed(EffectOutbox.EffectOutboxV2, {
              ...outbox,
              succeed: (input) =>
                outbox.succeed(input).pipe(
                  Effect.tap((didSettle) =>
                    Effect.gen(function* () {
                      if (
                        didSettle &&
                        (yield* Ref.updateAndGet(succeeded, (count) => count + 1)) === 3
                      )
                        yield* Deferred.succeed(settled, undefined);
                    }),
                  ),
                ),
            }),
            executorLayer,
          ),
        ),
      );

      yield* Effect.gen(function* () {
        yield* EffectWorker.runDaemonWithOptions({ concurrency: 2 }).pipe(Effect.forkScoped);
        yield* outbox.enqueue([
          {
            id: effectA1,
            commandId,
            threadId: threadA,
            request: {
              type: "provider-turn.start",
              runId: RunId.make("run:foundation-concurrent-effects:a1"),
            },
          },
          {
            id: effectA2,
            commandId,
            threadId: threadA,
            request: {
              type: "provider-turn.start",
              runId: RunId.make("run:foundation-concurrent-effects:a2"),
            },
          },
          {
            id: effectB1,
            commandId,
            threadId: threadB,
            request: {
              type: "provider-turn.start",
              runId: RunId.make("run:foundation-concurrent-effects:b1"),
            },
          },
        ]);
        yield* outbox.notifyAvailable(3);

        yield* Effect.all([Deferred.await(startedA1), Deferred.await(startedB1)]);
        assert.isFalse(yield* Deferred.isDone(startedA2));

        yield* Deferred.succeed(releaseA1, undefined);
        yield* Deferred.succeed(releaseB1, undefined);
        yield* Deferred.await(startedA2);
        yield* Deferred.succeed(releaseA2, undefined);
        yield* Deferred.await(settled);
        assert.isTrue(
          (yield* outbox.listByCommandId(commandId)).every(
            (effect) => effect.status === "succeeded",
          ),
        );
      }).pipe(Effect.provide(workerLayer), Effect.scoped);
    }),
  );

  it.effect("does not reclaim a running effect after its process-local lease expires", () =>
    Effect.gen(function* () {
      const outbox = yield* EffectOutbox.EffectOutboxV2;
      const sql = yield* SqlClient.SqlClient;
      const commandId = CommandId.make("command:foundation-no-live-reclaim");
      const threadId = ThreadId.make("thread:foundation-no-live-reclaim");
      const firstEffectId = "effect:foundation-no-live-reclaim:first";
      const secondEffectId = "effect:foundation-no-live-reclaim:second";
      const firstStarted = yield* Deferred.make<void>();
      const releaseFirst = yield* Deferred.make<void>();
      const executions = yield* Ref.make<ReadonlyArray<string>>([]);
      yield* outbox.enqueue([
        {
          id: firstEffectId,
          commandId,
          threadId,
          request: { type: "terminal.cleanup" },
        },
        {
          id: secondEffectId,
          commandId,
          threadId,
          request: { type: "terminal.cleanup" },
        },
      ]);

      const executorLayer = Layer.succeed(
        EffectWorker.OrchestrationEffectExecutorV2,
        EffectWorker.OrchestrationEffectExecutorV2.of({
          execute: (effect) =>
            Ref.update(executions, (current) => [...current, effect.id]).pipe(
              Effect.andThen(
                effect.id === firstEffectId
                  ? Deferred.succeed(firstStarted, undefined).pipe(
                      Effect.andThen(Deferred.await(releaseFirst)),
                    )
                  : Effect.void,
              ),
            ),
        }),
      );
      const workerLayer = EffectWorker.layerWithOptions({
        workerId: "no-live-reclaim-worker",
        leaseDurationMs: 1,
      }).pipe(
        Layer.provide(
          Layer.merge(Layer.succeed(EffectOutbox.EffectOutboxV2, outbox), executorLayer),
        ),
      );

      yield* Effect.gen(function* () {
        const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
        const firstFiber = yield* worker.runOnce.pipe(Effect.forkChild);
        yield* Deferred.await(firstStarted);
        yield* sql`
          UPDATE orchestration_v2_effect_outbox
          SET lease_expires_at = '1970-01-01T00:00:00.000Z'
          WHERE effect_id = ${firstEffectId}
        `;

        assert.isFalse(yield* worker.runOnce);
        assert.deepEqual(yield* Ref.get(executions), [firstEffectId]);

        yield* Deferred.succeed(releaseFirst, undefined);
        assert.isTrue(yield* Fiber.join(firstFiber));
        assert.isTrue(yield* worker.runOnce);
        assert.deepEqual(yield* Ref.get(executions), [firstEffectId, secondEffectId]);
      }).pipe(Effect.provide(workerLayer));
    }),
  );

  it.effect("leaves restart continuation pending until normal worker claims are enabled", () =>
    Effect.gen(function* () {
      const outbox = yield* EffectOutbox.EffectOutboxV2;
      const threadId = ThreadId.make("thread:activation-restart");
      const commandId = CommandId.make("command:activation-restart");
      yield* outbox.enqueue([
        {
          id: "effect:activation-a-restart",
          commandId,
          threadId,
          request: { type: "provider-runtime.continue", sourceRunId: RunId.make("run:activation") },
        },
        {
          id: "effect:activation-b-cleanup",
          commandId,
          threadId,
          request: { type: "terminal.cleanup" },
        },
      ]);
      const cleanup = yield* outbox.claimNext({
        workerId: "recovery",
        leaseDurationMs: 30_000,
        excludeRestartContinuations: true,
      });
      assert.isTrue(Option.isSome(cleanup));
      if (Option.isSome(cleanup)) {
        assert.equal(cleanup.value.request.type, "terminal.cleanup");
        yield* outbox.succeed({ effectId: cleanup.value.id, workerId: "recovery" });
      }
      assert.isTrue(
        Option.isNone(
          yield* outbox.claimNext({
            workerId: "recovery",
            leaseDurationMs: 30_000,
            excludeRestartContinuations: true,
          }),
        ),
      );
      const pending = yield* outbox.get("effect:activation-a-restart");
      assert.isTrue(Option.isSome(pending));
      if (Option.isSome(pending)) assert.equal(pending.value.status, "pending");
      const resumed = yield* outbox.claimNext({ workerId: "activated", leaseDurationMs: 30_000 });
      assert.isTrue(Option.isSome(resumed));
      if (Option.isSome(resumed)) {
        assert.equal(resumed.value.request.type, "provider-runtime.continue");
        yield* outbox.succeed({ effectId: resumed.value.id, workerId: "activated" });
      }
    }),
  );

  for (const replayRequest of [
    { type: "terminal.cleanup" },
    { type: "provider-runtime.continue", sourceRunId: RunId.make("run:restart-replay") },
  ] as const) {
    it.effect(
      `retires live provider effects and requeues ${replayRequest.type} after process loss`,
      () =>
        Effect.gen(function* () {
          const outbox = yield* EffectOutbox.EffectOutboxV2;
          const commandId = CommandId.make(
            `command:foundation-reclaim-running:${replayRequest.type}`,
          );
          yield* outbox.enqueue([
            {
              id: `effect:a-foundation-cancel-provider-turn:${replayRequest.type}`,
              commandId,
              threadId: ThreadId.make(`thread:foundation-reclaim-running:${replayRequest.type}`),
              request: {
                type: "provider-turn.start",
                runId: RunId.make(`run:foundation-reclaim-running:${replayRequest.type}`),
              },
            },
            {
              id: `effect:b-foundation-requeue-cleanup:${replayRequest.type}`,
              commandId,
              threadId: ThreadId.make(`thread:foundation-reclaim-cleanup:${replayRequest.type}`),
              request: replayRequest,
            },
          ]);
          assert.isTrue(
            Option.isSome(
              yield* outbox.claimNext({ workerId: "crashed-worker", leaseDurationMs: 30_000 }),
            ),
          );
          assert.isTrue(
            Option.isSome(
              yield* outbox.claimNext({ workerId: "crashed-worker", leaseDurationMs: 30_000 }),
            ),
          );
          assert.deepEqual(yield* outbox.reconcileAfterProcessLoss, {
            cancelled: 1,
            requeued: 1,
          });
          const cancelled = yield* outbox.get(
            `effect:a-foundation-cancel-provider-turn:${replayRequest.type}`,
          );
          assert.isTrue(Option.isSome(cancelled));
          if (Option.isSome(cancelled)) assert.equal(cancelled.value.status, "cancelled");

          const reclaimed = yield* outbox.claimNext({
            workerId: "recovery-worker",
            leaseDurationMs: 30_000,
          });
          assert.isTrue(Option.isSome(reclaimed));
          if (Option.isSome(reclaimed)) {
            assert.equal(reclaimed.value.request.type, replayRequest.type);
            assert.equal(reclaimed.value.attemptCount, 2);
            yield* outbox.succeed({ effectId: reclaimed.value.id, workerId: "recovery-worker" });
          }
        }),
    );
  }

  it.effect("allocates collision-free positions beyond 100 items and rebuilds equivalently", () =>
    Effect.gen(function* () {
      const eventSink = yield* EventSink.EventSinkV2;
      const projectionStore = yield* ProjectionStore.ProjectionStoreV2;
      const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
      const sql = yield* SqlClient.SqlClient;
      const now = yield* DateTime.now;
      const threadId = ThreadId.make("thread:foundation-many-items");
      const runId = RunId.make("run:foundation-many-items");
      const providerThreadId = ProviderThreadId.make("provider-thread:foundation-many-items");
      const thread = makeThread(threadId, now);
      const providerThreadEvent = {
        id: EventId.make("event:foundation-many-items:provider-thread"),
        type: "provider-thread.updated" as const,
        threadId,
        providerInstanceId,
        occurredAt: now,
        payload: {
          id: providerThreadId,
          driver: providerDriver,
          providerInstanceId,
          providerSessionId: null,
          appThreadId: threadId,
          ownerNodeId: null,
          nativeThreadRef: null,
          nativeConversationHeadRef: null,
          status: "active" as const,
          firstRunOrdinal: 1,
          lastRunOrdinal: 1,
          handoffIds: [],
          forkedFrom: null,
          createdAt: now,
          updatedAt: now,
        },
      } satisfies OrchestrationV2DomainEvent;
      const runEvent = {
        id: EventId.make("event:foundation-many-items:run"),
        type: "run.created" as const,
        threadId,
        runId,
        providerInstanceId,
        occurredAt: now,
        payload: {
          id: runId,
          threadId,
          ordinal: 1,
          providerInstanceId,
          modelSelection,
          providerThreadId: null,
          userMessageId: MessageId.make("message:foundation-many-items"),
          rootNodeId: null,
          activeAttemptId: null,
          status: "completed" as const,
          queuePosition: null,
          requestedAt: now,
          startedAt: now,
          completedAt: now,
          checkpointId: null,
          contextHandoffId: null,
        },
      } satisfies OrchestrationV2DomainEvent;
      const items = Array.from({ length: 151 }, (_, index) => ({
        id: TurnItemId.make(`turn-item:foundation-many-items:${index}`),
        threadId,
        runId,
        nodeId: null,
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        parentItemId: null,
        ordinal: index % 3,
        status: "completed" as const,
        title: null,
        startedAt: now,
        completedAt: now,
        updatedAt: now,
        type: "dynamic_tool" as const,
        toolName: `tool-${index}`,
        input: { index },
        output: { completed: true },
      }));
      const itemEvents = items.map(
        (item, index) =>
          ({
            id: EventId.make(`event:foundation-many-items:item:${index}`),
            type: "turn-item.updated",
            threadId,
            runId,
            providerInstanceId,
            occurredAt: now,
            payload: item,
          }) satisfies OrchestrationV2DomainEvent,
      );

      yield* eventSink.write({
        events: [
          threadCreatedEvent({ id: "event:foundation-many-items:thread", thread, now }),
          providerThreadEvent,
          runEvent,
          ...itemEvents,
        ],
      });
      const beforeUpdate = yield* projectionStore.getThreadProjection(threadId);
      assert.equal(beforeUpdate.thread.activeProviderThreadId, providerThreadId);
      const ordinals = beforeUpdate.turnItems.map((item) => item.ordinal);
      assert.lengthOf(ordinals, 151);
      assert.equal(new Set(ordinals).size, 151);
      assert.isTrue(ordinals.every((ordinal) => ordinal > 1_000_000));
      assert.isTrue(
        ordinals.every((ordinal, index) => index === 0 || ordinal > ordinals[index - 1]!),
      );

      yield* eventSink.write({
        events: [
          {
            id: EventId.make("event:foundation-many-items:update"),
            type: "turn-item.updated",
            threadId,
            runId,
            providerInstanceId,
            occurredAt: now,
            payload: { ...items[0]!, ordinal: 99_999_999, title: "Updated" },
          },
        ],
      });
      const afterUpdate = yield* projectionStore.getThreadProjection(threadId);
      assert.equal(afterUpdate.turnItems[0]?.ordinal, ordinals[0]);
      assert.equal((yield* maintenance.verify).valid, true);

      yield* sql`
        UPDATE orchestration_v2_projection_turn_items
        SET payload_json = '{}'
        WHERE turn_item_id = ${items[75]!.id}
      `;
      const broken = yield* maintenance.verify;
      assert.isFalse(broken.valid);
      assert.deepEqual(broken.unreadableThreadIds, [threadId]);

      const rebuilt = yield* maintenance.rebuild;
      assert.isTrue(rebuilt.valid);
      assert.lengthOf((yield* projectionStore.getThreadProjection(threadId)).turnItems, 151);
    }),
  );
});

it.effect("preserves side ownership and explicit PR choices in detail and shell rebuilds", () =>
  Effect.gen(function* () {
    const sink = yield* EventSink.EventSinkV2;
    const store = yield* ProjectionStore.ProjectionStoreV2;
    const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
    const now = yield* DateTime.now;
    const parentId = ThreadId.make("thread:fork-parent");
    const sideId = ThreadId.make("thread:fork-side");
    const parent = {
      ...makeThread(parentId, now),
      pullRequestAssociation: { mode: "unlinked" as const },
    };
    const side = {
      ...makeThread(sideId, now),
      sideOfThreadId: parentId,
      pullRequestAssociation: {
        mode: "linked" as const,
        provider: "github" as const,
        reference: "https://github.com/lookvyr/test-rig/pull/42",
      },
    };
    yield* sink.write({
      events: [
        threadCreatedEvent({ id: "event:fork-parent", thread: parent, now }),
        threadCreatedEvent({ id: "event:fork-side", thread: side, now }),
      ],
    });
    const assertPreserved = Effect.gen(function* () {
      for (const expected of [parent, side]) {
        const detail = yield* store.getThread(expected.id);
        const shell = yield* store.getThreadShell(expected.id);
        assert.deepEqual(detail.pullRequestAssociation, expected.pullRequestAssociation);
        assert.deepEqual(shell?.pullRequestAssociation, expected.pullRequestAssociation);
      }
      assert.equal((yield* store.getThread(sideId)).sideOfThreadId, parentId);
      assert.equal((yield* store.getThreadShell(sideId))?.sideOfThreadId, parentId);
      const snapshot = yield* store.getShellSnapshot();
      assert.equal(
        snapshot.threads.find((thread) => thread.id === sideId)?.sideOfThreadId,
        parentId,
      );
    });
    yield* assertPreserved;
    assert.isTrue((yield* maintenance.rebuild).valid);
    yield* assertPreserved;
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("recovery reads exclude completed transcript bodies and use the active-run index", () =>
  Effect.gen(function* () {
    const store = yield* ProjectionStore.ProjectionStoreV2;
    const sink = yield* EventSink.EventSinkV2;
    const sql = yield* SqlClient.SqlClient;
    const now = yield* DateTime.now;
    const threadId = ThreadId.make("thread:bounded-recovery");
    const runId = RunId.make("run:bounded-recovery");
    yield* sink.write({
      events: [
        threadCreatedEvent({
          id: "event:bounded-recovery",
          thread: makeThread(threadId, now),
          now,
        }),
      ],
    });
    // Obsolete completed bodies must never be decoded by the recovery read.
    yield* sql`
      WITH RECURSIVE history(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM history WHERE n < 1000)
      INSERT INTO orchestration_v2_projection_turn_items (
        turn_item_id, thread_id, run_id, node_id, provider_thread_id, provider_turn_id,
        parent_item_id, ordinal, type, status, updated_at, payload_json
      ) SELECT 'recovery-history:' || n, ${threadId}, NULL, NULL, NULL, NULL,
        NULL, n, 'assistant_message', 'completed', ${DateTime.formatIso(now)}, '{"obsolete":true}' FROM history
    `;
    assert.notInclude(yield* store.getRecoveryThreadIds("runtime"), threadId);
    yield* sink.write({
      events: [
        {
          id: EventId.make("event:bounded-recovery:run"),
          type: "run.created",
          threadId,
          occurredAt: now,
          payload: {
            id: runId,
            threadId,
            ordinal: 1,
            providerInstanceId,
            modelSelection,
            providerThreadId: null,
            userMessageId: MessageId.make("message:bounded-recovery"),
            rootNodeId: NodeId.make("node:bounded-recovery"),
            activeAttemptId: null,
            status: "running",
            requestedAt: now,
            startedAt: now,
            completedAt: null,
            checkpointId: null,
            contextHandoffId: null,
          },
        },
      ],
    });
    assert.include(yield* store.getRecoveryThreadIds("runtime"), threadId);
    const recovery = yield* store.getRuntimeRecoveryProjection(threadId);
    assert.deepEqual(
      recovery.runs.map((run) => run.id),
      [runId],
    );
    assert.isEmpty(recovery.messages);
    assert.isEmpty(recovery.turnItems);
    assert.equal((yield* Effect.exit(store.getThreadProjection(threadId)))._tag, "Failure");
    const plan = yield* sql<{
      detail: string;
    }>`EXPLAIN QUERY PLAN SELECT thread_id FROM orchestration_v2_projection_runs WHERE status IN ('queued', 'preparing', 'starting', 'running', 'waiting')`;
    assert.match(
      plan.map((row) => row.detail).join("\n"),
      /orchestration_v2_projection_runs_recovery_idx/,
    );
  }).pipe(Effect.provide(TestLayer)),
);
