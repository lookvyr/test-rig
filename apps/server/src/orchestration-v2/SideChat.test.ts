import { assert, describe, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import { makeSideChatContext } from "./ContextHandoffService.ts";
import { pendingSideChatContext } from "./ProviderTurnStartService.ts";
import * as Orchestrator from "./Orchestrator.ts";
import type { ProviderAdapterV2Shape } from "./ProviderAdapter.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import { makeOrchestratorV2ReplayLayerWithRegistry } from "./testkit/ProviderReplayHarness.ts";

const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "test-model" };
const adapter: ProviderAdapterV2Shape = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" }),
  openSession: () => Effect.die("Execution is paused after dispatch for inspection"),
};
const layer = makeOrchestratorV2ReplayLayerWithRegistry(
  { name: "side-chat" },
  ProviderAdapterRegistry.makeLayer([adapter]),
  { runEffectWorker: false },
);

const parentId = ThreadId.make("side-chat-parent");
const sideId = ThreadId.make("side-chat-child");

const createParent = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  yield* orchestrator.dispatch({
    type: "thread.create",
    commandId: CommandId.make("create-parent"),
    threadId: parentId,
    projectId: ProjectId.make("side-chat-project"),
    title: "Main thread",
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    createdBy: "user",
    creationSource: "web",
  });
});

const openSideChat = (sideThreadId: ThreadId, sourceThreadId = parentId) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    return yield* orchestrator.dispatch({
      type: "thread.fork",
      commandId: CommandId.make(`open-${sideThreadId}`),
      sourceThreadId,
      targetThreadId: sideThreadId,
      sourcePoint: { type: "latest_stable" },
      title: "Side chat",
      sideChat: true,
      createdBy: "user",
      creationSource: "web",
    });
  });

const sendToSideChat = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  yield* orchestrator.dispatch({
    type: "message.dispatch",
    commandId: CommandId.make("side-question"),
    threadId: sideId,
    messageId: MessageId.make("side-question"),
    text: "What does this thread know?",
    attachments: [],
    modelSelection,
    dispatchMode: { type: "start_immediately" },
    createdBy: "user",
    creationSource: "web",
  });
});

describe("side chats", () => {
  it.effect("open before the parent finishes a turn and carry its context to the first turn", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      yield* createParent;
      yield* openSideChat(sideId);

      const side = yield* orchestrator.getThreadProjection(sideId);
      assert.deepStrictEqual(side.thread.lineage, {
        parentThreadId: parentId,
        relationshipToParent: "fork",
        rootThreadId: parentId,
        sideChat: true,
      });
      // Side chats show only their own rows.
      assert.isNull(side.thread.forkedFrom);

      yield* sendToSideChat;
      const started = yield* orchestrator.getThreadProjection(sideId);
      assert.equal(started.contextTransfers[0]?.resolution?.strategy, "portable_context");
      const context = started.contextHandoffs.find(
        (handoff) => handoff.transferId === started.contextTransfers[0]?.id,
      );
      assert.include(context?.summaryText ?? "", "You are in a side chat beside the main thread.");
      assert.include(context?.summaryText ?? "", `t3_thread_read on thread ${parentId}`);
      // The "Context from" divider marks copied context, so no handoff row is added.
      assert.isFalse(started.turnItems.some((item) => item.type === "handoff"));
    }).pipe(Effect.provide(layer)),
  );

  it.effect("delete only when unused, and go with their parent", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      yield* createParent;
      yield* openSideChat(sideId);
      const unusedId = ThreadId.make("side-chat-unused");
      yield* openSideChat(unusedId);

      yield* orchestrator.dispatch({
        type: "thread.delete",
        commandId: CommandId.make("close-unused"),
        threadId: unusedId,
        onlyIfUnused: true,
      });
      assert.isNotNull((yield* orchestrator.getThreadProjection(unusedId)).thread.deletedAt);

      yield* sendToSideChat;
      yield* orchestrator.dispatch({
        type: "thread.delete",
        commandId: CommandId.make("close-used"),
        threadId: sideId,
        onlyIfUnused: true,
      });
      assert.isNull((yield* orchestrator.getThreadProjection(sideId)).thread.deletedAt);

      yield* orchestrator.dispatch({
        type: "thread.delete",
        commandId: CommandId.make("delete-parent"),
        threadId: parentId,
      });
      assert.isNotNull((yield* orchestrator.getThreadProjection(sideId)).thread.deletedAt);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("cannot start another side chat", () =>
    Effect.gen(function* () {
      yield* createParent;
      yield* openSideChat(sideId);
      const nested = yield* Effect.result(openSideChat(ThreadId.make("nested"), sideId));
      assert.equal(nested._tag, "Failure");
    }).pipe(Effect.provide(layer)),
  );
});

it("caps the parent digest while keeping the framing and the read pointer", () => {
  const items = Array.from({ length: 200 }, (_, index) => ({
    type: "user_message" as const,
    text: `message ${index} ${"x".repeat(100)}`,
  })) as unknown as Parameters<typeof makeSideChatContext>[0]["parentItems"];
  const context = makeSideChatContext({ parentThreadId: parentId, parentItems: items });
  assert.isAtMost(context.length, 8_000);
  assert.include(context, "Earlier items truncated.");
  assert.include(context, "message 199");
  assert.notInclude(context, "message 0 ");
  assert.isTrue(context.startsWith("You are in a side chat beside the main thread."));
  assert.isTrue(
    context.endsWith(
      `Use t3_thread_read on thread ${parentId} to see the main thread's live state.`,
    ),
  );
});

describe("pendingSideChatContext", () => {
  const firstRun = RunId.make("side-run-1");
  const nextRun = RunId.make("side-run-2");
  const transferId = "transfer-fork" as never;
  const projectionWith = (firstRunStatus: string, firstMessage: string, sideChat = true) =>
    ({
      thread: {
        lineage: {
          parentThreadId: parentId,
          relationshipToParent: "fork",
          rootThreadId: parentId,
          ...(sideChat ? { sideChat: true } : {}),
        },
      },
      contextTransfers: [{ id: transferId, type: "fork" }],
      contextHandoffs: [
        { transferId, strategy: "manual_context", status: "ready", targetRunId: firstRun },
      ],
      runs: [{ id: firstRun, status: firstRunStatus, userMessageId: MessageId.make("first") }],
      messages: [{ id: MessageId.make("first"), text: firstMessage, attachments: [] }],
    }) as unknown as Parameters<typeof pendingSideChatContext>[0];

  it("goes with the first run", () => {
    assert.isDefined(pendingSideChatContext(projectionWith("starting", "hi"), { id: firstRun }));
  });

  it("carries past a first run that sent no prompt or did not finish", () => {
    for (const [status, text] of [
      ["completed", "/compact"],
      ["completed", "/goal ship it"],
      ["failed", "hi"],
      ["interrupted", "hi"],
    ] as const) {
      assert.isDefined(
        pendingSideChatContext(projectionWith(status, text), { id: nextRun }),
        `${status} ${text}`,
      );
    }
  });

  it("stops after a first run that sent a prompt, and ignores ordinary forks", () => {
    assert.isUndefined(pendingSideChatContext(projectionWith("completed", "hi"), { id: nextRun }));
    assert.isUndefined(
      pendingSideChatContext(projectionWith("starting", "hi", false), { id: firstRun }),
    );
  });
});
