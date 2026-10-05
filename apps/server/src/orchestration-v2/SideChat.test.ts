import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  EventId,
  MessageId,
  NodeId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  ProviderThreadId,
  ProviderTurnId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ProviderThread,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { V2SqlitePersistenceMemory } from "../persistence/Layers/V2Sqlite.ts";
import * as CommandReceiptStore from "./CommandReceiptStore.ts";
import * as EventStore from "./EventStore.ts";
import * as EventSink from "./EventSink.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as TurnItemPositionStore from "./TurnItemPositionStore.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as EffectOutbox from "./EffectOutbox.ts";
import * as IdAllocator from "./IdAllocator.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as CommandPolicy from "./CommandPolicy.ts";
import * as ContextHandoffService from "./ContextHandoffService.ts";
import * as ThreadForkService from "./ThreadForkService.ts";
import * as ThreadCommandExecutor from "./ThreadCommandExecutor.ts";
import * as ProviderContinuationRequests from "./ProviderContinuationRequests.ts";
import { CheckpointServiceV2 } from "./CheckpointService.ts";
import { ProviderAdapterRegistryV2 } from "./ProviderAdapterRegistry.ts";
import { ProviderSessionManagerV2 } from "./ProviderSessionManager.ts";
import { ProviderSwitchServiceV2 } from "./ProviderSwitchService.ts";
import { RuntimePolicyV2 } from "./RuntimePolicy.ts";
import { ThreadManagementService } from "./ThreadManagementService.ts";
import { openSideChat } from "./SideChat.ts";
import type { ProviderAdapterV2SessionRuntime } from "./ProviderAdapter.ts";

const database = V2SqlitePersistenceMemory;
const stores = Layer.mergeAll(
  EventStore.layer,
  CommandReceiptStore.layer,
  ProjectionStore.layer,
  ProjectStore.layer,
  TurnItemPositionStore.layer,
  EffectOutbox.layer,
).pipe(Layer.provideMerge(database));
const sink = EventSink.layerFromStores.pipe(Layer.provide(stores));
const orchestratorLayer = Orchestrator.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      stores,
      sink,
      IdAllocator.layer,
      CommandPolicy.layer,
      ThreadForkService.layer,
      ThreadCommandExecutor.layer,
      ProviderContinuationRequests.layer,
      ContextHandoffService.layer.pipe(Layer.provide(IdAllocator.layer)),
      Layer.mock(CheckpointServiceV2)({}),
      Layer.mock(ProviderAdapterRegistryV2)({}),
      Layer.mock(ProviderSessionManagerV2)({}),
      Layer.mock(ProviderSwitchServiceV2)({}),
      Layer.mock(RuntimePolicyV2)({}),
      NodeServices.layer,
    ),
  ),
);
const testLayer = Layer.mergeAll(stores, sink, orchestratorLayer);
const parentId = ThreadId.make("parent");
const childId = ThreadId.make("side");
const instanceId = ProviderInstanceId.make("codex");
const now = DateTime.makeUnsafe("2026-10-03T10:00:00Z");
const source: OrchestrationV2ProviderThread = {
  id: ProviderThreadId.make("source"),
  driver: ProviderDriverKind.make("codex"),
  providerInstanceId: instanceId,
  providerSessionId: ProviderSessionId.make("parent-session"),
  appThreadId: parentId,
  ownerNodeId: null,
  nativeThreadRef: {
    driver: ProviderDriverKind.make("codex"),
    nativeId: "native-parent",
    strength: "strong",
  },
  nativeConversationHeadRef: null,
  status: "idle",
  firstRunOrdinal: null,
  lastRunOrdinal: null,
  handoffIds: [],
  forkedFrom: null,
  createdAt: now,
  updatedAt: now,
};
const seed = Effect.gen(function* () {
  const store = yield* ProjectionStore.ProjectionStoreV2;
  yield* store.apply({
    id: EventId.make("parent-create"),
    type: "thread.created",
    threadId: parentId,
    occurredAt: now,
    payload: {
      id: parentId,
      projectId: ProjectId.make("project"),
      title: "Parent",
      createdBy: "user",
      creationSource: "web",
      providerInstanceId: instanceId,
      modelSelection: { instanceId, model: "test" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: "main",
      worktreePath: null,
      activeProviderThreadId: source.id,
      lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: parentId },
      forkedFrom: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      deletedAt: null,
      lastVisitedAt: null,
      settledAt: null,
      settledOverride: null,
    },
  });
  yield* store.apply({
    id: EventId.make("parent-provider"),
    type: "provider-thread.updated",
    threadId: parentId,
    occurredAt: now,
    payload: source,
  });
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  yield* store.apply({
    id: EventId.make("parent-completed-turn"),
    type: "provider-turn.updated",
    threadId: parentId,
    occurredAt: now,
    payload: {
      id: ProviderTurnId.make("source-turn"),
      providerThreadId: source.id,
      nodeId: NodeId.make("source-node"),
      runAttemptId: null,
      nativeTurnRef: { driver: source.driver, nativeId: "native-turn", strength: "strong" },
      ordinal: 1,
      status: "completed",
      startedAt: now,
      completedAt: now,
    },
  });
  yield* orchestrator.dispatch({
    type: "thread.side.open",
    commandId: CommandId.make("open"),
    threadId: parentId,
    sideThreadId: childId,
    createdBy: "user",
    creationSource: "web",
  });
  return { store, orchestrator };
});

it.effect(
  "opens an empty native side, reuses it, and cancels capture when its parent is deleted",
  () =>
    Effect.gen(function* () {
      const { store, orchestrator } = yield* seed;
      const projection = yield* store.getThreadProjection(childId);
      assert.equal(projection.thread.sideOfThreadId, parentId);
      assert.deepEqual(projection.messages, []);
      assert.deepEqual(projection.runs, []);
      assert.deepEqual(projection.contextTransfers, []);
      assert.equal(projection.providerThreads[0]?.status, "not_loaded");
      assert.equal(
        projection.providerThreads[0]?.forkedFrom?.providerTurnId,
        ProviderTurnId.make("source-turn"),
      );
      const prematureSend = yield* Effect.result(
        orchestrator.dispatch({
          type: "message.dispatch",
          commandId: CommandId.make("send-before-capture"),
          threadId: childId,
          messageId: MessageId.make("premature"),
          text: "Hello",
          attachments: [],
          modelSelection: { instanceId, model: "test" },
          dispatchMode: { type: "start_immediately" },
          createdBy: "user",
          creationSource: "web",
        }),
      );
      assert.equal(prematureSend._tag, "Failure");
      assert.deepEqual((yield* store.getThreadRecords(childId, ["runs"])).runs, []);

      const replay = yield* orchestrator.dispatch({
        type: "thread.side.open",
        commandId: CommandId.make("reopen"),
        threadId: parentId,
        sideThreadId: ThreadId.make("unused"),
        createdBy: "user",
        creationSource: "web",
      });
      assert.equal(replay.storedEvents[0]?.event.threadId, childId);
      yield* orchestrator.dispatch({
        type: "thread.delete",
        commandId: CommandId.make("delete-parent"),
        threadId: parentId,
      });
      assert.isNotNull((yield* store.getThread(childId)).deletedAt);
      const outbox = yield* EffectOutbox.EffectOutboxV2;
      const effects = [
        ...(yield* outbox.listByCommandId(CommandId.make("open"))),
        ...(yield* outbox.listByCommandId(CommandId.make("delete-parent"))),
      ];
      assert.equal(
        effects.find((effect) => effect.request.type === "thread.side.open")?.status,
        "cancelled",
      );
      assert.equal(
        effects.filter((effect) => effect.request.type === "terminal.cleanup").length,
        2,
      );
      yield* orchestrator.dispatch({
        type: "thread.side.open.complete",
        commandId: CommandId.make("late-complete"),
        threadId: parentId,
        sideThreadId: childId,
        providerThread: source,
      });
      assert.isNotNull((yield* store.getThread(childId)).deletedAt);
    }).pipe(Effect.provide(testLayer)),
);

it.effect("retains side chat readiness in a bounded snapshot before its first turn", () =>
  Effect.gen(function* () {
    const { store, orchestrator } = yield* seed;
    const pending = yield* store.getThreadSnapshotWindow(childId, { rowLimit: 75 });
    assert.equal(pending.projection.providerThreads[0]?.status, "not_loaded");

    yield* orchestrator.dispatch({
      type: "thread.side.open.complete",
      commandId: CommandId.make("complete-before-subscribe"),
      threadId: parentId,
      sideThreadId: childId,
      providerThread: {
        ...source,
        id: ProviderThreadId.make("native-side"),
        appThreadId: childId,
        status: "idle",
        nativeThreadRef: { driver: source.driver, nativeId: "native-side", strength: "strong" },
      },
    });
    const ready = (yield* store.getThreadSnapshotWindow(childId, { rowLimit: 75 })).projection;
    assert.deepEqual(ready.runs, []);
    assert.deepEqual(ready.turnItems, []);
    assert.equal(ready.providerThreads.length, 1);
    assert.equal(ready.providerThreads[0]?.id, ready.thread.activeProviderThreadId);
    assert.equal(ready.providerThreads[0]?.nativeThreadRef?.nativeId, "native-side");
    assert.equal(ready.providerThreads[0]?.status, "idle");
  }).pipe(Effect.provide(testLayer)),
);

it.effect(
  "records native opening failure without manufacturing a run and guards discard ownership",
  () =>
    Effect.gen(function* () {
      const { store, orchestrator } = yield* seed;
      yield* orchestrator.dispatch({
        type: "thread.side.open.complete",
        commandId: CommandId.make("failed"),
        threadId: parentId,
        sideThreadId: childId,
        error: "Native fork failed.",
      });
      const projection = yield* store.getThreadProjection(childId);
      assert.equal(projection.providerThreads[0]?.status, "error");
      assert.deepEqual(projection.runs, []);
      assert.equal(projection.turnItems[0]?.type, "error");
      const wrongOwner = yield* Effect.result(
        orchestrator.dispatch({
          type: "thread.delete",
          commandId: CommandId.make("wrong-owner"),
          threadId: childId,
          onlyIfSideOfThreadId: ThreadId.make("another-parent"),
        }),
      );
      assert.equal(wrongOwner._tag, "Failure");
      assert.isNull((yield* store.getThread(childId)).deletedAt);
    }).pipe(Effect.provide(testLayer)),
);

it.effect(
  "keeps a reopened parent session alive while closing only the temporary fork session",
  () =>
    Effect.gen(function* () {
      const { orchestrator } = yield* seed;
      const forkStarted = yield* Deferred.make<void>();
      const finishFork = yield* Deferred.make<void>();
      const closed: Array<ProviderSessionId> = [];
      const forked = {
        ...source,
        appThreadId: childId,
        providerSessionId: null,
        nativeThreadRef: { ...source.nativeThreadRef!, nativeId: "native-side" },
      };
      // Only operations used by native context capture are implemented.
      const parentRuntime = {
        resumeThread: () => Effect.succeed(source),
      } as unknown as ProviderAdapterV2SessionRuntime;
      const childRuntime = {
        forkThread: () =>
          Deferred.succeed(forkStarted, undefined).pipe(
            Effect.andThen(Deferred.await(finishFork)),
            Effect.as(forked),
          ),
      } as unknown as ProviderAdapterV2SessionRuntime;
      const running = yield* openSideChat({
        commandId: CommandId.make("open"),
        parentThreadId: parentId,
        sideThreadId: childId,
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.mock(ThreadManagementService)({
              getThreadRecords: orchestrator.getThreadRecords,
              dispatch: orchestrator.dispatch,
            }),
            Layer.mock(RuntimePolicyV2)({
              resolve: () =>
                Effect.succeed({
                  cwd: null,
                  runtimeMode: "full-access",
                  interactionMode: "default",
                }),
            }),
            Layer.mock(ProviderSessionManagerV2)({
              get: () => Effect.succeed(Option.none()),
              open: (input) =>
                Effect.succeed(input.threadId === parentId ? parentRuntime : childRuntime),
              close: (id) =>
                Effect.sync(() => {
                  closed.push(id);
                }),
            }),
          ),
        ),
        Effect.forkChild,
      );
      yield* Deferred.await(forkStarted);
      // A parent turn may now own the reopened session while the side fork is in flight.
      yield* Deferred.succeed(finishFork, undefined);
      yield* Fiber.join(running);
      assert.deepEqual(closed, [ProviderSessionId.make("side-open:open")]);
      const saved = yield* orchestrator.getThreadRecords(childId, ["providerThreads"]);
      assert.equal(saved.providerThreads[0]?.nativeThreadRef?.nativeId, "native-side");
    }).pipe(Effect.provide(testLayer)),
);

it.effect("keeps explicit PR unlinking and includes archived sides in ownership cleanup", () =>
  Effect.gen(function* () {
    const { store, orchestrator } = yield* seed;
    yield* orchestrator.dispatch({
      type: "thread.metadata.update",
      commandId: CommandId.make("unlink"),
      threadId: parentId,
      pullRequestAssociation: { mode: "unlinked" },
    });
    assert.deepEqual((yield* store.getThread(parentId)).pullRequestAssociation, {
      mode: "unlinked",
    });
    const side = yield* store.getThread(childId);
    yield* store.apply({
      id: EventId.make("archive-side"),
      type: "thread.archived",
      threadId: childId,
      occurredAt: now,
      payload: { ...side, archivedAt: now },
    });
    const reused = yield* orchestrator.dispatch({
      type: "thread.side.open",
      commandId: CommandId.make("reuse-archived"),
      threadId: parentId,
      sideThreadId: ThreadId.make("another-side"),
      createdBy: "user",
      creationSource: "web",
    });
    assert.equal(reused.storedEvents[0]?.event.threadId, childId);
    yield* orchestrator.dispatch({
      type: "thread.delete",
      commandId: CommandId.make("delete-with-archive"),
      threadId: parentId,
    });
    assert.isNotNull((yield* store.getThread(childId)).deletedAt);
  }).pipe(Effect.provide(testLayer)),
);

it.effect("archive cancels held and not-yet-started runs before late release", () =>
  Effect.gen(function* () {
    const { store, orchestrator } = yield* seed;
    for (const status of ["queued", "preparing", "starting"] as const) {
      yield* store.apply({
        id: EventId.make(`run-${status}`),
        type: "run.created",
        threadId: parentId,
        occurredAt: now,
        payload: {
          id: RunId.make(status),
          threadId: parentId,
          ordinal: ["queued", "preparing", "starting"].indexOf(status) + 1,
          providerInstanceId: instanceId,
          modelSelection: { instanceId, model: "test" },
          providerThreadId: null,
          userMessageId: MessageId.make(status),
          rootNodeId: null,
          activeAttemptId: null,
          status,
          queuePosition: null,
          requestedAt: now,
          startedAt: null,
          completedAt: null,
          checkpointId: null,
          contextHandoffId: null,
        },
      });
    }
    for (const [index, status] of (
      ["pending", "running", "waiting", "completed"] as const
    ).entries()) {
      yield* store.apply({
        id: EventId.make(`preparation-${status}`),
        type: "turn-item.updated",
        threadId: parentId,
        occurredAt: now,
        payload: {
          id: TurnItemId.make(`preparation-${status}`),
          threadId: parentId,
          runId: RunId.make(status === "completed" ? "starting" : "preparing"),
          nodeId: null,
          providerThreadId: null,
          providerTurnId: null,
          nativeItemRef: null,
          parentItemId: null,
          ordinal: index + 1,
          status,
          title: "Preparing workspace",
          startedAt: now,
          completedAt: status === "completed" ? now : null,
          updatedAt: now,
          type: "command_execution",
          input: "Preparing workspace",
        },
      });
    }
    const commandId = CommandId.make("archive-preparation");
    yield* orchestrator.dispatch({ type: "thread.archive", commandId, threadId: parentId });
    const projection = yield* store.getThreadRecords(parentId, ["runs", "turnItems"]);
    assert.isNotNull(projection.thread.archivedAt);
    assert.isTrue(
      projection.runs.every((run) => run.status === "cancelled" && run.completedAt !== null),
    );
    assert.sameDeepMembers(
      projection.turnItems.map((item) => [item.id, item.status]),
      [
        ["preparation-pending", "interrupted"],
        ["preparation-running", "interrupted"],
        ["preparation-waiting", "interrupted"],
        ["preparation-completed", "completed"],
      ],
    );
    const effects = yield* (yield* EffectOutbox.EffectOutboxV2).listByCommandId(commandId);
    assert.isTrue(effects.some((effect) => effect.request.type === "terminal.cleanup"));
    const late = yield* Effect.result(
      orchestrator.dispatch({
        type: "prepared-run.release",
        commandId: CommandId.make("late-release"),
        threadId: parentId,
        runId: RunId.make("preparing"),
      }),
    );
    assert.equal(late._tag, "Failure");
  }).pipe(Effect.provide(testLayer)),
);
