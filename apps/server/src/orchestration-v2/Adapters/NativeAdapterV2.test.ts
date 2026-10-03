import { it, assert } from "@effect/vitest";
import {
  EventId,
  MessageId,
  NodeId,
  OrchestrationV2AppThread,
  OrchestrationV2TurnItemJson,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  ProviderRuntimeEvent,
  RuntimeItemId,
  RuntimeRequestId,
  RuntimeTaskId,
  RunAttemptId,
  RunId,
  ThreadId,
  TurnId,
  type ProviderSendTurnInput,
  type ProviderSession,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type {
  ProviderAdapterShape,
  ProviderAdapterStartInput,
} from "../../provider/Services/ProviderAdapter.ts";
import type { ProviderAdapterError } from "../../provider/Errors.ts";
import * as Continuations from "../ProviderContinuationRequests.ts";
import type { ProviderAdapterV2Event, ProviderAdapterV2TurnInput } from "../ProviderAdapter.ts";
import { makeNativeAdapterV2 } from "./NativeAdapterV2.ts";
import { nativeCapabilities } from "./nativeCapabilities.ts";

const decodeAppThread = Schema.decodeUnknownEffect(OrchestrationV2AppThread);
const decodeNativeEvent = Schema.decodeUnknownSync(ProviderRuntimeEvent);
const decodeItem = Schema.decodeUnknownEffect(OrchestrationV2TurnItemJson);
const encodeItem = Schema.encodeEffect(OrchestrationV2TurnItemJson);

const makeFixture = Effect.gen(function* () {
  const inputEvents = yield* Queue.unbounded<ProviderRuntimeEvent>();
  const outputEvents = yield* Queue.unbounded<ProviderAdapterV2Event>();
  const collected: Array<ProviderAdapterV2Event> = [];
  const starts: Array<ProviderAdapterStartInput> = [];
  const sends: Array<ProviderSendTurnInput> = [];
  const responses: Array<unknown> = [];
  const sessions = new Map<ThreadId, ProviderSession>();
  const instanceId = ProviderInstanceId.make("personal");
  const driver = ProviderDriverKind.make("codex");
  const threadId = ThreadId.make("app-thread");
  const now = "2026-10-03T10:00:00.000Z";
  const modelSelection = { instanceId, model: "test-model" };
  const runtimePolicy = {
    runtimeMode: "approval-required" as const,
    interactionMode: "default" as const,
    cwd: "/tmp",
  };
  const native: ProviderAdapterShape<ProviderAdapterError> = {
    provider: driver,
    capabilities: { sessionModelSwitch: "in-session" },
    streamEvents: Stream.fromQueue(inputEvents),
    startSession: (input) =>
      Effect.sync(() => {
        starts.push(input);
        const session: ProviderSession = {
          provider: driver,
          threadId: input.threadId,
          runtimeMode: input.runtimeMode,
          status: "ready",
          createdAt: now,
          updatedAt: now,
          resumeCursor: { threadId: `native-${input.threadId}` },
        };
        sessions.set(input.threadId, session);
        return session;
      }),
    sendTurn: (input) =>
      Effect.sync(() => {
        sends.push(input);
        return { threadId: input.threadId, turnId: TurnId.make(`turn-${sends.length}`) };
      }),
    interruptTurn: (id) =>
      Effect.sync(() => {
        responses.push({ interrupt: id });
      }),
    respondToRequest: (id, request, decision) =>
      Effect.sync(() => {
        responses.push({ id, request, decision });
      }),
    respondToUserInput: (id, request, answers) =>
      Effect.sync(() => {
        responses.push({ id, request, answers });
      }),
    stopSession: (id) =>
      Effect.sync(() => {
        sessions.delete(id);
      }),
    stopAll: () => Effect.sync(() => sessions.clear()),
    listSessions: () => Effect.sync(() => [...sessions.values()]),
    hasSession: (id) => Effect.sync(() => sessions.has(id)),
    readThread: (id) => Effect.succeed({ threadId: id, turns: [] }),
    rollbackThread: (id) => Effect.succeed({ threadId: id, turns: [] }),
  };
  const adapter = yield* makeNativeAdapterV2({
    instanceId,
    native,
    capabilities: nativeCapabilities("codex"),
  });
  const runtime = yield* adapter.openSession({
    threadId,
    providerSessionId: ProviderSessionId.make("session1"),
    modelSelection,
    runtimePolicy,
  });
  yield* runtime.events.pipe(
    Stream.runForEach((event) => {
      collected.push(event);
      return Queue.offer(outputEvents, event);
    }),
    Effect.forkScoped,
  );
  const providerThread = yield* runtime.ensureThread({ threadId, modelSelection, runtimePolicy });
  const appThread = yield* decodeAppThread({
    createdBy: "user",
    creationSource: "web",
    id: threadId,
    projectId: "project",
    title: "Test",
    providerInstanceId: instanceId,
    modelSelection,
    runtimeMode: "approval-required",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
    forkedFrom: null,
    createdAt: DateTime.makeUnsafe(now),
    updatedAt: DateTime.makeUnsafe(now),
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  });
  const turn = (ordinal: number, providerWake = false): ProviderAdapterV2TurnInput => ({
    appThread,
    threadId,
    providerThread,
    runId: RunId.make(`run${ordinal}`),
    runOrdinal: ordinal,
    providerTurnOrdinal: ordinal,
    attemptId: RunAttemptId.make(`attempt${ordinal}`),
    rootNodeId: NodeId.make(`root${ordinal}`),
    modelSelection,
    runtimePolicy,
    message: {
      messageId: MessageId.make(`user${ordinal}`),
      text: "test",
      attachments: [],
      createdBy: providerWake ? "agent" : "user",
      creationSource: providerWake ? "provider" : "web",
    },
  });
  let serial = 0;
  const send = (
    event: Omit<ProviderRuntimeEvent, "eventId" | "provider" | "threadId" | "createdAt">,
  ) =>
    Queue.offer(
      inputEvents,
      decodeNativeEvent({
        ...event,
        eventId: EventId.make(`event${++serial}`),
        provider: driver,
        threadId,
        createdAt: now,
      }),
    );
  const next = (
    predicate: (event: ProviderAdapterV2Event) => boolean,
  ): Effect.Effect<ProviderAdapterV2Event> =>
    Effect.gen(function* () {
      while (true) {
        const event = yield* Queue.take(outputEvents);
        if (predicate(event)) return event;
      }
    });
  return {
    adapter,
    runtime,
    providerThread,
    starts,
    sends,
    responses,
    collected,
    send,
    next,
    turn,
    instanceId,
    threadId,
    modelSelection,
    runtimePolicy,
  };
});

it.layer(Continuations.layer)("NativeAdapterV2", (it) => {
  it.effect("only a matching root terminal completes a run and keeps exact tool output", () =>
    Effect.gen(function* () {
      const f = yield* makeFixture;
      yield* f.runtime.startTurn(f.turn(1));
      yield* f.send({
        type: "turn.completed",
        turnId: TurnId.make("child-turn"),
        payload: { state: "completed" },
      });
      yield* f.send({
        type: "item.completed",
        turnId: TurnId.make("turn-1"),
        itemId: RuntimeItemId.make("command"),
        payload: {
          itemType: "command_execution",
          status: "completed",
          title: "Run",
          data: { item: { command: "printf exact", aggregatedOutput: "exact\n", exitCode: 0 } },
        },
      });
      const command = yield* f.next((e) => e.type === "turn_item.updated");
      assert.strictEqual(command.type, "turn_item.updated");
      if (command.type === "turn_item.updated" && command.turnItem.type === "command_execution") {
        assert.strictEqual(command.turnItem.output, "exact\n");
        assert.strictEqual(command.turnItem.input, "printf exact");
      } else assert.fail("Expected command item");
      assert.isFalse(f.collected.some((e) => e.type === "turn.terminal"));
      yield* f.send({
        type: "turn.completed",
        turnId: TurnId.make("turn-1"),
        payload: { state: "completed" },
      });
      yield* f.next((e) => e.type === "turn.terminal");
    }),
  );
  it.effect("preserves secret, nonblocking question metadata and cancellation", () =>
    Effect.gen(function* () {
      const f = yield* makeFixture;
      yield* f.runtime.startTurn(f.turn(1));
      yield* f.send({
        type: "user-input.requested",
        turnId: TurnId.make("turn-1"),
        requestId: RuntimeRequestId.make("native-question"),
        payload: {
          questions: [
            { id: "token", header: "Token", question: "Token?", options: [], isSecret: true },
          ],
          isBlocking: false,
          autoResolutionMs: 2500,
        },
      });
      const question = yield* f.next((e) => e.type === "turn_item.updated");
      if (question.type !== "turn_item.updated" || question.turnItem.type !== "user_input_request")
        return assert.fail("Expected question");
      const persisted = yield* decodeItem(yield* encodeItem(question.turnItem));
      assert.deepStrictEqual(persisted, question.turnItem);
      assert.isTrue(question.turnItem.questions[0]?.isSecret);
      assert.isFalse(question.turnItem.isBlocking);
      assert.strictEqual(question.turnItem.autoResolutionMs, 2500);
      yield* f.runtime.respondToRuntimeRequest({
        requestId: question.turnItem.requestId,
        answers: { token: "fixture" },
      });
      assert.deepStrictEqual(f.responses[0], {
        id: f.threadId,
        request: "native-question",
        answers: { token: "fixture" },
      });
      yield* f.send({
        type: "user-input.resolved",
        turnId: TurnId.make("turn-1"),
        requestId: RuntimeRequestId.make("native-question"),
        payload: { answers: {}, reason: "cancelled" },
      });
      const resolved = yield* f.next(
        (e) => e.type === "runtime_request.updated" && e.runtimeRequest.status === "cancelled",
      );
      assert.strictEqual(resolved.type, "runtime_request.updated");
      yield* f.next((e) => e.type === "node.updated" && e.node.status === "cancelled");
    }),
  );
  it.effect("preserves native file diffs", () =>
    Effect.gen(function* () {
      const f = yield* makeFixture;
      yield* f.runtime.startTurn(f.turn(1));
      yield* f.send({
        type: "item.completed",
        turnId: TurnId.make("turn-1"),
        itemId: RuntimeItemId.make("edit"),
        payload: {
          itemType: "file_change",
          status: "completed",
          data: {
            item: { changes: [{ path: "a.ts", kind: { type: "update" }, diff: "-old\n+new" }] },
          },
        },
      });
      const event = yield* f.next((e) => e.type === "turn_item.updated");
      if (event.type !== "turn_item.updated" || event.turnItem.type !== "file_change")
        return assert.fail("Expected file change");
      assert.strictEqual(event.turnItem.fileName, "a.ts");
      assert.strictEqual(event.turnItem.diffStr, "-old\n+new");
      assert.deepStrictEqual(event.turnItem.changes, [{ path: "a.ts", operation: "update" }]);
    }),
  );
  it.effect("emits distinct todo and proposed plan artifacts", () =>
    Effect.gen(function* () {
      const f = yield* makeFixture;
      yield* f.runtime.startTurn(f.turn(1));
      yield* f.send({
        type: "turn.plan.updated",
        turnId: TurnId.make("turn-1"),
        payload: { plan: [{ step: "Check", status: "inProgress" }] },
      });
      const todo = yield* f.next((e) => e.type === "plan.updated");
      yield* f.send({
        type: "turn.proposed.completed",
        turnId: TurnId.make("turn-1"),
        payload: { planMarkdown: "# Plan" },
      });
      const proposed = yield* f.next((e) => e.type === "plan.updated");
      if (todo.type !== "plan.updated" || proposed.type !== "plan.updated")
        return assert.fail("Expected plans");
      assert.notStrictEqual(todo.plan.id, proposed.plan.id);
      assert.strictEqual(proposed.plan.kind, "proposed_plan");
    }),
  );
  it.effect("ingests multiple provider wakes without sending prompts and refuses a user race", () =>
    Effect.gen(function* () {
      const f = yield* makeFixture;
      const continuations = yield* Continuations.ProviderContinuationRequests;
      for (const id of ["wake1", "wake2"]) {
        yield* f.send({ type: "turn.started", turnId: TurnId.make(id), payload: {} });
        yield* f.send({
          type: "turn.completed",
          turnId: TurnId.make(id),
          payload: { state: "completed" },
        });
        assert.strictEqual((yield* continuations.take).nativeTurnId, id);
      }
      assert.isTrue(yield* f.runtime.hasPendingBackgroundWork!);
      assert.isTrue(Exit.isFailure(yield* Effect.exit(f.runtime.startTurn(f.turn(1)))));
      yield* f.runtime.startTurn(f.turn(1, true));
      yield* f.next((e) => e.type === "turn.terminal");
      yield* f.runtime.startTurn(f.turn(2, true));
      yield* f.next((e) => e.type === "turn.terminal" && e.runOrdinal === 2);
      assert.strictEqual(f.sends.length, 0);
      assert.isFalse(yield* f.runtime.hasPendingBackgroundWork!);
    }),
  );
  it.effect("keeps a background child attached to its original run across a new user turn", () =>
    Effect.gen(function* () {
      const f = yield* makeFixture;
      yield* f.runtime.startTurn(f.turn(1));
      yield* f.send({
        type: "task.started",
        turnId: TurnId.make("turn-1"),
        payload: { taskId: RuntimeTaskId.make("child"), taskType: "subagent", title: "Child" },
      });
      yield* f.next((e) => e.type === "subagent.updated");
      yield* f.send({
        type: "turn.completed",
        turnId: TurnId.make("turn-1"),
        payload: { state: "completed" },
      });
      yield* f.next((e) => e.type === "turn.terminal");
      yield* f.runtime.startTurn(f.turn(2));
      yield* f.send({
        type: "task.completed",
        turnId: TurnId.make("turn-1"),
        payload: {
          taskId: RuntimeTaskId.make("child"),
          taskType: "subagent",
          status: "completed",
          summary: "done",
        },
      });
      const child = yield* f.next(
        (e) => e.type === "subagent.updated" && e.subagent.status === "completed",
      );
      if (child.type === "subagent.updated") assert.strictEqual(child.subagent.runId, "run1");
      assert.strictEqual(f.collected.filter((e) => e.type === "turn.terminal").length, 1);
    }),
  );
  it.effect("preserves model and policy transitions and rejects competing session ownership", () =>
    Effect.gen(function* () {
      const f = yield* makeFixture;
      const other = yield* f.adapter.openSession({
        threadId: f.threadId,
        providerSessionId: ProviderSessionId.make("competitor"),
        modelSelection: f.modelSelection,
        runtimePolicy: f.runtimePolicy,
      });
      assert.isTrue(
        Exit.isFailure(
          yield* Effect.exit(
            other.ensureThread({
              threadId: f.threadId,
              modelSelection: f.modelSelection,
              runtimePolicy: f.runtimePolicy,
            }),
          ),
        ),
      );
      const turn = f.turn(1);
      yield* f.runtime.startTurn({
        ...turn,
        modelSelection: { ...turn.modelSelection, model: "other-model" },
        runtimePolicy: {
          ...turn.runtimePolicy,
          runtimeMode: "full-access",
          interactionMode: "plan",
        },
      });
      assert.strictEqual(f.starts.at(-1)?.runtimeMode, "full-access");
      assert.strictEqual(f.sends[0]?.interactionMode, "plan");
      assert.strictEqual(f.sends[0]?.modelSelection?.model, "other-model");
    }),
  );
});
