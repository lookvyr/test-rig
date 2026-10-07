import * as SecretRequests from "../secrets/SecretRequests.ts";
import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  ComposerContextId,
  CheckpointScopeId,
  EnvironmentId,
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
import * as Stream from "effect/Stream";
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
import * as ThreadManagement from "./ThreadManagementService.ts";
import * as ServerConfig from "../config.ts";
import * as OrchestratorMcp from "../mcp/OrchestratorMcpService.ts";
import type { McpInvocationScope } from "../mcp/McpInvocationContext.ts";
import * as ProviderRegistry from "../provider/Services/ProviderRegistry.ts";
import * as ScheduledTasks from "../scheduledTasks/ScheduledTaskService.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
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
      Layer.mock(CheckpointServiceV2)({
        prepareRootRunScope: (input) =>
          Effect.succeed({
            id: CheckpointScopeId.make(`scope:${input.runId}`),
            threadId: input.threadId,
            nodeId: input.rootNodeId,
            runId: input.runId,
            parentScopeId: null,
            providerThreadId: input.providerThreadId,
            kind: "root_run",
            ordinalWithinParent: 0,
            advancesAppRunCount: true,
            cwd: input.cwd,
            createdAt: input.createdAt,
          }),
        ensureScope: (scope) => Effect.succeed(scope),
      }),
      Layer.mock(ProviderAdapterRegistryV2)({
        get: () =>
          Effect.succeed({
            instanceId: ProviderInstanceId.make("codex"),
            driver: ProviderDriverKind.make("codex"),
            getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
            planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
            openSession: () => Effect.die("Provider execution is disabled in this test"),
          }),
      }),
      Layer.mock(ProviderSessionManagerV2)({
        get: (providerSessionId) =>
          Effect.succeedSome({
            instanceId: ProviderInstanceId.make("codex"),
            driver: ProviderDriverKind.make("codex"),
            providerSessionId,
            providerSession: {
              id: providerSessionId,
              driver: ProviderDriverKind.make("codex"),
              providerInstanceId: ProviderInstanceId.make("codex"),
              status: "running",
              cwd: "/tmp/side-coordination",
              model: "test",
              capabilities: CodexProviderCapabilitiesV2,
              createdAt: now,
              updatedAt: now,
              lastError: null,
            },
            events: Stream.empty,
            ensureThread: () => Effect.die("unused"),
            resumeThread: () => Effect.die("unused"),
            startTurn: () => Effect.die("unused"),
            steerTurn: () => Effect.die("unused"),
            interruptTurn: () => Effect.die("unused"),
            respondToRuntimeRequest: () => Effect.die("unused"),
            readThreadSnapshot: () => Effect.die("unused"),
            rollbackThread: () => Effect.die("unused"),
            forkThread: () => Effect.die("unused"),
          }),
      }),
      Layer.mock(ProviderSwitchServiceV2)({}),
      Layer.mock(RuntimePolicyV2)({
        resolve: ({ thread }) =>
          Effect.succeed({
            runtimeMode: thread.runtimeMode,
            interactionMode: thread.interactionMode,
            cwd: "/tmp/side-coordination",
          }),
      }),
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

const coordinationLayer = ThreadManagement.layer.pipe(
  Layer.provideMerge(testLayer),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "side-coordination-" })),
  Layer.provide(NodeServices.layer),
);

const coordinationScope: McpInvocationScope = {
  environmentId: EnvironmentId.make("side-coordination"),
  threadId: childId,
  providerSessionId: "side-credential",
  providerInstanceId: instanceId,
  capabilities: new Set(["orchestration"]),
  issuedAt: 1,
};

const mcpCoordinationLayer = OrchestratorMcp.layer
  .pipe(Layer.provide(Layer.mock(SecretRequests.SecretRequests)({})))
  .pipe(
    Layer.provideMerge(coordinationLayer),
    Layer.provide(
      Layer.mergeAll(
        NodeServices.layer,
        Layer.mock(ProviderRegistry.ProviderRegistry)({ getProviders: Effect.succeed([]) }),
        Layer.mock(ProviderAdapterRegistryV2)({}),
        Layer.mock(ScheduledTasks.ScheduledTaskService)({}),
      ),
    ),
  );

const readySide = Effect.gen(function* () {
  const seeded = yield* seed;
  yield* seeded.orchestrator.dispatch({
    type: "thread.side.open.complete",
    commandId: CommandId.make("coordination:ready"),
    threadId: parentId,
    sideThreadId: childId,
    providerThread: {
      ...source,
      id: ProviderThreadId.make("coordination:side-provider"),
      appThreadId: childId,
      nativeThreadRef: { driver: source.driver, nativeId: "native-side", strength: "strong" },
    },
  });
  yield* seeded.orchestrator.dispatch({
    type: "message.dispatch",
    commandId: CommandId.make("coordination:side-request"),
    threadId: childId,
    messageId: MessageId.make("coordination:side-request"),
    text: "Send the findings to the parent.",
    attachments: [],
    dispatchMode: { type: "start_immediately" },
    createdBy: "user",
    creationSource: "web",
  });
  return seeded;
});

it.effect.each(["idle-parent", "busy-parent", "peer"] as const)(
  "side sends survive discard with %s",
  (scenario) =>
    Effect.gen(function* () {
      const { store, orchestrator } = yield* readySide;
      const mcp = yield* OrchestratorMcp.OrchestratorMcpService;
      const busy = scenario === "busy-parent";
      const targetId = scenario === "peer" ? ThreadId.make("peer") : parentId;
      if (scenario === "peer") {
        const parent = yield* store.getThread(parentId);
        yield* store.apply({
          id: EventId.make("peer-create"),
          type: "thread.created",
          threadId: targetId,
          occurredAt: now,
          payload: {
            ...parent,
            id: targetId,
            activeProviderThreadId: null,
            lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: targetId },
          },
        });
      }
      if (busy) {
        yield* orchestrator.dispatch({
          type: "message.dispatch",
          commandId: CommandId.make("parent:busy"),
          threadId: parentId,
          messageId: MessageId.make("parent:busy"),
          text: "Existing work",
          attachments: [],
          dispatchMode: { type: "start_immediately" },
          createdBy: "user",
          creationSource: "web",
        });
      }
      const input = {
        threadId: targetId,
        message: "Requested findings",
        clientRequestId: "findings",
      };
      const accepted = yield* mcp.sendToThread(coordinationScope, input);
      assert.equal(accepted.delivery, busy ? "queued" : "started");
      assert.deepEqual(yield* mcp.sendToThread(coordinationScope, input), accepted);
      const before = yield* store.getThreadRecords(targetId, ["messages", "runs"]);
      const sent = before.messages.filter((message) => message.id === accepted.messageId);
      assert.equal(sent.length, 1);
      assert.equal(sent[0]?.senderThreadId, childId);
      assert.equal(sent[0]?.createdBy, "agent");
      assert.equal(sent[0]?.creationSource, "mcp");
      assert.equal((yield* store.getThread(childId)).sideOfThreadId, parentId);
      yield* orchestrator.dispatch({
        type: "thread.delete",
        commandId: CommandId.make("discard:after-acceptance"),
        threadId: childId,
        onlyIfSideOfThreadId: parentId,
      });
      const after = yield* store.getThreadRecords(targetId, ["messages", "runs"]);
      assert.deepEqual(after.messages, before.messages);
      assert.deepEqual(after.runs, before.runs);
      const stale = yield* mcp
        .sendToThread(coordinationScope, {
          ...input,
          clientRequestId: "after-discard",
        })
        .pipe(Effect.flip);
      assert.equal(stale.code, "thread_not_found");
      assert.equal(
        (yield* store.getThreadRecords(targetId, ["messages"])).messages.length,
        before.messages.length,
      );
    }).pipe(Effect.provide(mcpCoordinationLayer)),
);

it.effect.each(["auto", "steer", "restart"] as const)(
  "accepts %s into active work and replays it after completion",
  (mode) =>
    Effect.gen(function* () {
      const { store } = yield* readySide;
      const management = yield* ThreadManagement.ThreadManagementService;
      const run = (yield* store.getThreadRecords(childId, ["runs"])).runs[0]!;
      yield* store.apply({
        id: EventId.make("running"),
        type: "run.updated",
        threadId: childId,
        occurredAt: now,
        payload: { ...run, status: "running", startedAt: now },
      });
      yield* store.apply({
        id: EventId.make("running-turn"),
        type: "provider-turn.updated",
        threadId: childId,
        occurredAt: now,
        payload: {
          id: ProviderTurnId.make("running-turn"),
          providerThreadId: run.providerThreadId!,
          nodeId: run.rootNodeId!,
          runAttemptId: run.activeAttemptId,
          nativeTurnRef: { driver: source.driver, nativeId: "running-turn", strength: "strong" },
          ordinal: 1,
          status: "running",
          startedAt: now,
          completedAt: null,
        },
      });
      const input = {
        projectId: ProjectId.make("project"),
        threadId: childId,
        commandId: CommandId.make(`accepted:${mode}`),
        messageId: MessageId.make(`accepted:${mode}`),
        text: "Findings",
        attachments: [],
        mode,
        createdBy: "agent",
        creationSource: "mcp",
      } as const;
      const accepted = yield* management.sendToThread(input);
      assert.equal(accepted.run.id, run.id);
      assert.equal(accepted.delivery, mode === "restart" ? "restarted" : "steered");
      yield* store.apply({
        id: EventId.make("completed"),
        type: "run.updated",
        threadId: childId,
        occurredAt: now,
        payload: { ...accepted.run, status: "completed", completedAt: now },
      });
      const sink = yield* EventSink.EventSinkV2;
      const sequence = yield* sink.latestSequence();
      const result = yield* management.sendToThread(input);
      assert.equal(result.run.status, "completed");
      assert.equal(result.delivery, accepted.delivery);
      assert.equal(result.dispatch.sequence, accepted.dispatch.sequence);
      assert.equal(yield* sink.latestSequence(), sequence);
      assert.lengthOf(
        (yield* store.getThreadRecords(childId, ["messages"])).messages.filter(
          (message) => message.id === input.messageId,
        ),
        1,
      );
      if (mode !== "auto") {
        const fresh = yield* management
          .sendToThread({
            ...input,
            commandId: CommandId.make("fresh"),
            messageId: MessageId.make("fresh"),
          })
          .pipe(Effect.flip);
        assert.equal(fresh._tag, "ThreadManagementNoSteerableRunError");
      }
      const conflict = yield* management
        .sendToThread({ ...input, threadId: parentId })
        .pipe(Effect.flip);
      assert.equal(conflict._tag, "OrchestratorCommandIdConflictError");
    }).pipe(Effect.provide(coordinationLayer)),
);

it.effect.each([
  ["no-capability", "capability_denied"],
  ["other-provider", "parent_not_active"],
  ["inactive-caller", "parent_not_active"],
  ["archived-caller", "parent_not_active"],
  ["runtime-ceiling", "runtime_mode_escalation_denied"],
  ["interaction-ceiling", "interaction_mode_escalation_denied"],
  ["other-project", "thread_not_found"],
  ["native-child", "orchestration_error"],
] as const)("rejects sends across the %s boundary", ([scenario, expectedCode]) =>
  Effect.gen(function* () {
    const { store } = yield* readySide;
    const mcp = yield* OrchestratorMcp.OrchestratorMcpService;
    const caller = yield* store.getThread(childId);
    const target = yield* store.getThread(parentId);
    if (scenario === "inactive-caller") {
      const run = (yield* store.getThreadRecords(childId, ["runs"])).runs[0]!;
      yield* store.apply({
        id: EventId.make("inactive"),
        type: "run.updated",
        threadId: childId,
        occurredAt: now,
        payload: { ...run, status: "completed", completedAt: now },
      });
    }
    yield* store.apply({
      id: EventId.make("caller-boundary"),
      type: "thread.metadata-updated",
      threadId: childId,
      occurredAt: now,
      payload: {
        ...caller,
        archivedAt: scenario === "archived-caller" ? now : null,
        runtimeMode: scenario === "runtime-ceiling" ? "approval-required" : caller.runtimeMode,
        interactionMode: scenario === "interaction-ceiling" ? "plan" : caller.interactionMode,
      },
    });
    yield* store.apply({
      id: EventId.make("target-boundary"),
      type: "thread.metadata-updated",
      threadId: parentId,
      occurredAt: now,
      payload: {
        ...target,
        projectId:
          scenario === "other-project" ? ProjectId.make("other-project") : target.projectId,
        ...(scenario === "native-child"
          ? {
              creationSource: "provider",
              createdBy: "agent",
              lineage: {
                parentThreadId: childId,
                rootThreadId: childId,
                relationshipToParent: "subagent",
              },
            }
          : {}),
      },
    });
    if (scenario === "other-project") {
      const message = (yield* store.getThreadRecords(childId, ["messages"])).messages[0]!;
      yield* store.apply({
        id: EventId.make("user-reference"),
        type: "message.updated",
        threadId: childId,
        occurredAt: now,
        payload: {
          ...message,
          context: {
            version: 1,
            records: [
              {
                kind: "thread",
                version: 1,
                contextId: ComposerContextId.make("ref-parent"),
                label: "Parent",
                environmentId: coordinationScope.environmentId,
                threadId: parentId,
                title: "Parent",
              },
            ],
          },
        },
      });
      const readable = yield* mcp.readThread(coordinationScope, { threadId: parentId });
      assert.equal(readable.thread.threadId, parentId);
    }
    const error = yield* mcp
      .sendToThread(
        {
          ...coordinationScope,
          capabilities: new Set(scenario === "no-capability" ? [] : ["orchestration"]),
          providerInstanceId:
            scenario === "other-provider" ? ProviderInstanceId.make("claudeAgent") : instanceId,
        },
        { threadId: parentId, message: "Must not send", clientRequestId: scenario },
      )
      .pipe(Effect.flip);
    assert.equal(error.code, expectedCode);
    if (scenario !== "native-child") {
      const interrupt = yield* mcp
        .interruptThread(
          {
            ...coordinationScope,
            capabilities: new Set(scenario === "no-capability" ? [] : ["orchestration"]),
            providerInstanceId:
              scenario === "other-provider" ? ProviderInstanceId.make("claudeAgent") : instanceId,
          },
          { threadId: parentId },
        )
        .pipe(Effect.flip);
      assert.equal(interrupt.code, expectedCode);
    }
    assert.deepEqual((yield* store.getThreadRecords(parentId, ["messages"])).messages, []);
  }).pipe(Effect.provide(mcpCoordinationLayer)),
);

it.effect.each(["archived", "deleted", "missing"] as const)(
  "reports an attached %s chat through scoped history reading",
  (state) =>
    Effect.gen(function* () {
      const { store } = yield* readySide;
      const mcp = yield* OrchestratorMcp.OrchestratorMcpService;
      const targetId = state === "missing" ? ThreadId.make("missing-reference") : parentId;
      const target = yield* store.getThread(parentId);
      yield* store.apply({
        id: EventId.make("reference-lifecycle"),
        type: "thread.metadata-updated",
        threadId: parentId,
        occurredAt: now,
        payload: {
          ...target,
          projectId: ProjectId.make("other-project"),
          archivedAt: state === "archived" ? now : null,
          deletedAt: state === "deleted" ? now : null,
        },
      });
      const message = (yield* store.getThreadRecords(childId, ["messages"])).messages[0]!;
      yield* store.apply({
        id: EventId.make("reference-message"),
        type: "message.updated",
        threadId: childId,
        occurredAt: now,
        payload: {
          ...message,
          context: {
            version: 1,
            records: [
              {
                kind: "thread",
                version: 1,
                contextId: ComposerContextId.make("lifecycle-reference"),
                label: "Referenced chat",
                environmentId: coordinationScope.environmentId,
                threadId: targetId,
                title: "Referenced chat",
              },
            ],
          },
        },
      });
      if (state === "archived") {
        const result = yield* mcp.readThread(coordinationScope, { threadId: targetId });
        assert.equal(result.thread.threadId, targetId);
        assert.isTrue(result.thread.archived);
      } else {
        const error = yield* mcp
          .readThread(coordinationScope, { threadId: targetId })
          .pipe(Effect.flip);
        assert.equal(error.code, state === "deleted" ? "thread_not_found" : "orchestration_error");
        assert.include(error.message, targetId);
        if (state === "missing") assert.include(error.message, "Unable to load thread");
      }
    }).pipe(Effect.provide(mcpCoordinationLayer)),
);

it.effect("recovers a partially accepted batch without duplicating its first continuation", () =>
  Effect.gen(function* () {
    yield* readySide;
    const management = yield* ThreadManagement.ThreadManagementService;
    let failSecond = true;
    let firstThreadId: ThreadId | undefined;
    const dependencies = Layer.mergeAll(
      NodeServices.layer,
      Layer.succeed(ThreadManagement.ThreadManagementService, {
        ...management,
        dispatch: (command) => {
          if (command.type === "thread.create" && command.title === "Second" && failSecond) {
            failSecond = false;
            return Effect.fail(
              new Orchestrator.OrchestratorDispatchError({
                commandId: command.commandId,
                commandType: command.type,
                cause: "Transient transport failure before the second create",
              }),
            );
          }
          if (command.type === "thread.create" && command.title === "First")
            firstThreadId = command.threadId;
          return management.dispatch(command);
        },
      }),
      Layer.mock(ProviderRegistry.ProviderRegistry)({
        getProviders: Effect.succeed([
          {
            instanceId,
            driver: source.driver,
            enabled: true,
            installed: true,
            version: "test",
            status: "ready",
            auth: { status: "authenticated" },
            checkedAt: "2026-10-03T10:00:00Z",
            models: [{ slug: "test", name: "test", isCustom: false, capabilities: null }],
            slashCommands: [],
            skills: [],
          },
        ]),
      }),
      Layer.mock(ProviderAdapterRegistryV2)({ list: () => Effect.succeed([instanceId]) }),
      Layer.mock(ScheduledTasks.ScheduledTaskService)({}),
    );
    yield* Effect.gen(function* () {
      const mcp = yield* OrchestratorMcp.OrchestratorMcpService;
      const input = {
        clientRequestId: "partial-batch",
        threads: [
          { title: "First", prompt: "First task" },
          { title: "Second", prompt: "Second task" },
        ],
      };
      const failure = yield* mcp.createThreads(coordinationScope, input).pipe(Effect.flip);
      assert.equal(failure.code, "orchestration_error");
      assert.isDefined(firstThreadId);
      const before = yield* management.getThreadRecords(firstThreadId!, ["messages", "runs"]);
      assert.equal(before.messages.length, 1);
      assert.equal(before.runs.length, 1);
      const result = yield* mcp.createThreads(coordinationScope, input);
      assert.equal(result.threads.length, 2);
      assert.equal(result.threads[0]?.threadId, firstThreadId);
      const after = yield* management.getThreadRecords(firstThreadId!, ["messages", "runs"]);
      assert.deepEqual(after.messages, before.messages);
      assert.deepEqual(after.runs, before.runs);
      assert.deepEqual(yield* mcp.createThreads(coordinationScope, input), result);
    }).pipe(
      Effect.provide(
        OrchestratorMcp.layer
          .pipe(Layer.provide(Layer.mock(SecretRequests.SecretRequests)({})))
          .pipe(Layer.provide(dependencies)),
      ),
    );
  }).pipe(Effect.provide(coordinationLayer)),
);
