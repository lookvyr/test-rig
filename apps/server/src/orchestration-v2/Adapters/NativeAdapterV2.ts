import {
  ApprovalRequestId,
  MessageId,
  NodeId,
  PlanId,
  ProviderThreadId,
  ProviderTurnId,
  RuntimeRequestId,
  ThreadId,
  TurnId,
  TurnItemId,
  classifyTaskAgentKind,
  type ModelSelection,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2ExecutionNode,
  type OrchestrationV2ProviderCapabilities,
  type OrchestrationV2ProviderSession,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2ProviderTurn,
  type OrchestrationV2RuntimeRequest,
  type OrchestrationV2Subagent,
  type OrchestrationV2TurnItem,
  type ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ProviderSession,
} from "@t3tools/contracts";
import type * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import type { ProviderAdapterShape } from "../../provider/Services/ProviderAdapter.ts";
import * as Adapter from "../ProviderAdapter.ts";
import { ProviderContinuationRequests } from "../ProviderContinuationRequests.ts";
import { makeProviderFailure } from "../ProviderFailure.ts";

type NativeAdapter = ProviderAdapterShape<import("../../provider/Errors.ts").ProviderAdapterError>;
type Item = OrchestrationV2TurnItem;
type NativeEvent = ProviderRuntimeEvent;

const Cursor = Schema.Struct({
  threadId: Schema.optional(Schema.String),
  resume: Schema.optional(Schema.String),
  sessionId: Schema.optional(Schema.String),
});
const decodeCursor = Schema.decodeUnknownOption(Cursor);
import * as Option from "effect/Option";

function nativeId(session: ProviderSession): string | undefined {
  const cursor = decodeCursor(session.resumeCursor);
  if (Option.isNone(cursor)) return undefined;
  return cursor.value.resume ?? cursor.value.sessionId ?? cursor.value.threadId;
}

const NativeFileChange = Schema.Struct({
  path: Schema.String,
  kind: Schema.Struct({ type: Schema.String }),
  diff: Schema.optional(Schema.String),
});
const NativeItemData = Schema.Struct({
  changes: Schema.optional(Schema.Array(NativeFileChange)),
  text: Schema.optional(Schema.String),
  command: Schema.optional(Schema.String),
  aggregatedOutput: Schema.optional(Schema.NullOr(Schema.String)),
  exitCode: Schema.optional(Schema.NullOr(Schema.Number)),
});
const decodeItemData = Schema.decodeUnknownOption(
  Schema.Struct({
    ...NativeItemData.fields,
    item: Schema.optional(NativeItemData),
    toolName: Schema.optional(Schema.String),
    input: Schema.optional(Schema.Unknown),
    output: Schema.optional(Schema.String),
    result: Schema.optional(Schema.Unknown),
  }),
);
const decodeCommand = Schema.decodeUnknownOption(
  Schema.Struct({ command: Schema.optional(Schema.String) }),
);

const decodeFileInput = Schema.decodeUnknownOption(
  Schema.Struct({
    file_path: Schema.optional(Schema.String),
    path: Schema.optional(Schema.String),
    old_string: Schema.optional(Schema.String),
    new_string: Schema.optional(Schema.String),
    content: Schema.optional(Schema.String),
  }),
);

interface RunState {
  input: Adapter.ProviderAdapterV2TurnInput;
  turn: OrchestrationV2ProviderTurn;
  nativeTurnId: TurnId | undefined;
  sending: Deferred.Deferred<void>;
  finished: boolean;
  ordinal: number;
  items: Map<string, Item>;
}

interface ThreadState {
  key: ThreadId;
  thread: OrchestrationV2ProviderThread;
  model: ModelSelection;
  policy: Adapter.ProviderAdapterV2RuntimePolicy;
  session: OrchestrationV2ProviderSession;
  events: Queue.Queue<Adapter.ProviderAdapterV2Event, Cause.Done>;
  run: RunState | undefined;
  requests: Map<
    RuntimeRequestId,
    { nativeId: RuntimeRequestId; request: OrchestrationV2RuntimeRequest }
  >;
  tasks: Map<string, OrchestrationV2Subagent>;
  taskRuns: Map<string, RunState>;
  wakes: Map<TurnId, Array<NativeEvent>>;
  eventMutex: Semaphore.Semaphore;
}

/**
 * A V2 adapter owns a separate native engine. It translates that engine's single
 * event stream; it must never be constructed around an engine serving V1.
 */
export const makeNativeAdapterV2 = Effect.fn("makeNativeAdapterV2")(function* (input: {
  readonly instanceId: ProviderInstanceId;
  readonly native: NativeAdapter;
  readonly capabilities: OrchestrationV2ProviderCapabilities;
}) {
  const { native, instanceId, capabilities } = input;
  const driver = native.provider;
  const continuations = yield* ProviderContinuationRequests;
  const threads = new Map<ThreadId, ThreadState>();
  const protocolError = (detail: string) =>
    new Adapter.ProviderAdapterProtocolError({ driver, detail });
  const scopedId = (state: ThreadState, kind: string, id: string) =>
    ["v2", instanceId, state.thread.id, kind, id].map(encodeURIComponent).join(":");
  const emit = (state: ThreadState, event: Adapter.ProviderAdapterV2Event) =>
    Queue.offer(state.events, event).pipe(Effect.asVoid);
  const emitThread = (state: ThreadState) =>
    emit(state, { type: "provider_thread.updated", driver, providerThread: state.thread });
  const emitItem = (state: ThreadState, item: Item) =>
    emit(state, { type: "turn_item.updated", driver, turnItem: item });
  const node = (
    state: ThreadState,
    run: RunState,
    id: NodeId,
    kind: OrchestrationV2ExecutionNode["kind"],
    status: OrchestrationV2ExecutionNode["status"],
    at: DateTime.Utc,
  ): OrchestrationV2ExecutionNode => ({
    id,
    threadId: run.input.threadId,
    runId: run.input.runId,
    parentNodeId: run.input.rootNodeId,
    rootNodeId: run.input.rootNodeId,
    kind,
    status,
    countsForRun: false,
    providerThreadId: state.thread.id,
    providerTurnId: run.turn.id,
    nativeItemRef: null,
    runtimeRequestId: null,
    checkpointScopeId: null,
    startedAt: at,
    completedAt: ["completed", "failed", "cancelled", "interrupted"].includes(status) ? at : null,
  });
  const itemBase = (state: ThreadState, run: RunState, key: string, at: DateTime.Utc) => {
    const existing = run.items.get(key);
    return {
      id: TurnItemId.make(scopedId(state, "item", `${run.turn.id}:${key}`)),
      threadId: run.input.threadId,
      runId: run.input.runId,
      nodeId: run.input.rootNodeId,
      providerThreadId: state.thread.id,
      providerTurnId: run.turn.id,
      nativeItemRef: { driver, nativeId: key, strength: "strong" as const },
      parentItemId: null,
      ordinal: existing?.ordinal ?? ++run.ordinal,
      status: "running" as const,
      title: null,
      startedAt: existing?.startedAt ?? at,
      completedAt: null,
      updatedAt: at,
    };
  };
  const refreshCursor = Effect.fn("NativeAdapterV2.refreshCursor")(function* (state: ThreadState) {
    const session = (yield* native.listSessions()).find(
      (candidate) => candidate.threadId === state.key,
    );
    if (!session) return;
    const id = nativeId(session);
    state.thread = {
      ...state.thread,
      ...(id ? { nativeThreadRef: { driver, nativeId: id, strength: "strong" as const } } : {}),
      nativeMetadata: {
        ...state.thread.nativeMetadata,
        itemIdentityVersion: 2,
        resumeCursor: session.resumeCursor,
      },
      updatedAt: yield* DateTime.now,
    };
    yield* emitThread(state);
  });
  const saveItem = Effect.fn("NativeAdapterV2.saveItem")(function* (
    state: ThreadState,
    run: RunState,
    key: string,
    item: Item,
  ) {
    run.items.set(key, item);
    yield* emitItem(state, item);
    if (item.type === "todo_list" || item.type === "proposed_plan") {
      const base = {
        id: item.planId,
        threadId: item.threadId,
        runId: item.runId,
        nodeId: item.nodeId ?? run.input.rootNodeId,
        status: item.status === "completed" ? ("completed" as const) : ("active" as const),
      };
      yield* emit(state, {
        type: "plan.updated",
        driver,
        plan:
          item.type === "todo_list"
            ? {
                ...base,
                kind: "todo_list",
                steps: item.steps,
                ...(item.explanation ? { explanation: item.explanation } : {}),
              }
            : { ...base, kind: "proposed_plan", markdown: item.markdown },
      });
    }
    if (item.type === "assistant_message") {
      const message: OrchestrationV2ConversationMessage = {
        id: item.messageId,
        threadId: item.threadId,
        runId: item.runId,
        nodeId: item.nodeId,
        role: "assistant",
        text: item.text,
        attachments: item.attachments ?? [],
        streaming: item.streaming,
        createdBy: "agent",
        creationSource: "provider",
        createdAt: item.startedAt ?? item.updatedAt,
        updatedAt: item.updatedAt,
      };
      yield* emit(state, { type: "message.updated", driver, message });
    }
  });
  const finish = Effect.fn("NativeAdapterV2.finish")(function* (
    state: ThreadState,
    run: RunState,
    status: "completed" | "failed" | "cancelled" | "interrupted",
    at: DateTime.Utc,
    detail?: string,
  ) {
    if (run.finished) return;
    run.finished = true;
    run.turn = { ...run.turn, status, completedAt: at };
    for (const [key, item] of run.items) {
      if (item.status !== "running" && item.status !== "waiting" && item.status !== "pending")
        continue;
      if (item.type === "subagent") continue;
      yield* saveItem(state, run, key, {
        ...item,
        status,
        completedAt: at,
        updatedAt: at,
        ...("streaming" in item ? { streaming: false } : {}),
      });
    }
    for (const entry of state.requests.values()) {
      if (entry.request.providerTurnId !== run.turn.id || entry.request.status !== "pending")
        continue;
      entry.request = { ...entry.request, status: "cancelled", resolvedAt: at };
      yield* emit(state, {
        type: "runtime_request.updated",
        driver,
        threadId: run.input.threadId,
        runtimeRequest: entry.request,
      });
      yield* emit(state, {
        type: "node.updated",
        driver,
        node: {
          ...node(
            state,
            run,
            entry.request.nodeId,
            entry.request.kind === "user_input" ? "user_input_request" : "approval_request",
            entry.request.status === "resolved" ? "completed" : "cancelled",
            at,
          ),
          runtimeRequestId: entry.request.id,
        },
      });
    }
    state.thread = {
      ...state.thread,
      status: "idle",
      nativeConversationHeadRef: run.turn.nativeTurnRef,
      updatedAt: at,
    };
    yield* refreshCursor(state);
    yield* emit(state, {
      type: "provider_turn.updated",
      driver,
      threadId: run.input.threadId,
      providerTurn: run.turn,
    });
    yield* emit(state, {
      type: "node.updated",
      driver,
      node: {
        ...node(state, run, run.input.rootNodeId, "root_turn", status, at),
        parentNodeId: null,
        countsForRun: true,
      },
    });
    if (status === "failed") {
      yield* emit(state, {
        type: "turn.terminal",
        driver,
        providerThreadId: state.thread.id,
        providerTurnId: run.turn.id,
        runOrdinal: run.input.runOrdinal,
        failureItemOrdinal: ++run.ordinal,
        status,
        failure: makeProviderFailure({
          class: "provider_error",
          message: detail ?? "Provider turn failed.",
        }),
        threadDisposition: "reusable",
      });
    } else {
      yield* emit(state, {
        type: "turn.terminal",
        driver,
        providerThreadId: state.thread.id,
        providerTurnId: run.turn.id,
        runOrdinal: run.input.runOrdinal,
        status,
        failure: null,
        threadDisposition: "reusable",
      });
    }
  });

  const translateEvent = Effect.fn("NativeAdapterV2.translateEvent")(function* (
    event: NativeEvent,
  ) {
    const state = threads.get(event.threadId);
    if (!state) return;
    const at = DateTime.makeUnsafe(event.createdAt);
    let run = state.run;
    if (
      event.type === "task.started" ||
      event.type === "task.progress" ||
      event.type === "task.updated" ||
      event.type === "task.completed"
    )
      run = state.taskRuns.get(event.payload.taskId) ?? run;
    if (run) yield* Deferred.await(run.sending);
    if (event.turnId && event.turnId !== run?.nativeTurnId) {
      let buffered = state.wakes.get(event.turnId);
      if (!buffered && event.type === "turn.started") {
        buffered = [];
        state.wakes.set(event.turnId, buffered);
        yield* continuations.offer({
          threadId: state.key,
          providerThreadId: state.thread.id,
          driver,
          nativeTurnId: event.turnId,
        });
      }
      if (buffered) {
        buffered.push(event);
        return;
      }
    }
    if (event.type === "session.exited") {
      if (run && !run.finished)
        yield* finish(state, run, "failed", at, event.payload.reason ?? "Provider session exited.");
      state.session = { ...state.session, status: "stopped", updatedAt: at };
      yield* emit(state, {
        type: "provider_session.updated",
        driver,
        providerSession: state.session,
      });
      return;
    }
    if (event.type === "thread.started") {
      yield* refreshCursor(state);
      return;
    }
    if (!run) return;
    // Native children have their own task events. Even a malformed child turn
    // notification must not end, or append text to, the parent's run.
    if (
      event.turnId !== undefined &&
      event.turnId !== run.nativeTurnId &&
      !event.type.startsWith("task.")
    )
      return;
    if (event.type === "turn.completed" || event.type === "turn.aborted") {
      if (event.turnId !== run.nativeTurnId) return;
      yield* finish(
        state,
        run,
        event.type === "turn.aborted" ? "interrupted" : event.payload.state,
        at,
        event.type === "turn.aborted" ? event.payload.reason : event.payload.errorMessage,
      );
      return;
    }
    if (event.type === "thread.token-usage.updated") {
      state.thread = { ...state.thread, contextUsage: event.payload.usage, updatedAt: at };
      yield* emitThread(state);
      return;
    }
    if (event.type === "request.resolved" || event.type === "user-input.resolved") {
      for (const entry of state.requests.values()) {
        if (entry.nativeId !== event.requestId || entry.request.status !== "pending") continue;
        entry.request = {
          ...entry.request,
          status:
            event.type === "user-input.resolved" && event.payload.reason
              ? event.payload.reason === "timeout"
                ? "expired"
                : "cancelled"
              : "resolved",
          resolvedAt: at,
        };
        yield* emit(state, {
          type: "runtime_request.updated",
          driver,
          threadId: run.input.threadId,
          runtimeRequest: entry.request,
        });
        yield* emit(state, {
          type: "node.updated",
          driver,
          node: {
            ...node(
              state,
              run,
              entry.request.nodeId,
              entry.request.kind === "user_input" ? "user_input_request" : "approval_request",
              entry.request.status === "resolved" ? "completed" : "cancelled",
              at,
            ),
            runtimeRequestId: entry.request.id,
          },
        });
        const key = `request:${entry.nativeId}`;
        const item = run.items.get(key);
        if (item)
          yield* saveItem(state, run, key, {
            ...item,
            status: entry.request.status === "resolved" ? "completed" : "cancelled",
            completedAt: at,
            updatedAt: at,
          });
      }
      return;
    }
    if (
      event.type === "task.started" ||
      event.type === "task.progress" ||
      event.type === "task.updated" ||
      event.type === "task.completed"
    ) {
      const task = event.payload;
      const previous = state.tasks.get(task.taskId);
      const id = NodeId.make(scopedId(state, "task", task.taskId));
      const taskStatus =
        event.type === "task.started"
          ? "running"
          : event.type === "task.completed"
            ? event.payload.status === "stopped"
              ? "cancelled"
              : event.payload.status
            : (event.payload.status ?? previous?.status ?? "running");
      const title =
        task.title ??
        ("description" in task ? task.description : undefined) ??
        previous?.title ??
        null;
      const taskNode = node(state, run, id, "subagent", taskStatus, at);
      const subagent: OrchestrationV2Subagent = {
        id,
        threadId: run.input.threadId,
        runId: previous?.runId ?? run.input.runId,
        parentNodeId: task.parentAgentId
          ? NodeId.make(scopedId(state, "task", task.parentAgentId))
          : (previous?.parentNodeId ?? run.input.rootNodeId),
        origin: "provider_native",
        createdBy: "agent",
        driver,
        providerInstanceId: instanceId,
        providerThreadId: null,
        childThreadId: null,
        nativeTaskRef: { driver, nativeId: task.taskId, strength: "strong" },
        prompt: previous?.prompt ?? title ?? "",
        title,
        model: task.model ?? previous?.model ?? null,
        status: taskStatus,
        result: "summary" in task ? (task.summary ?? null) : (previous?.result ?? null),
        startedAt: previous?.startedAt ?? at,
        completedAt: taskNode.completedAt,
        updatedAt: at,
        ...("description" in task && task.description ? { progress: task.description } : {}),
      };
      state.tasks.set(task.taskId, subagent);
      if (event.type === "task.completed") state.taskRuns.delete(task.taskId);
      else state.taskRuns.set(task.taskId, run);
      yield* emit(state, {
        type: "node.updated",
        driver,
        node: { ...taskNode, runId: subagent.runId, parentNodeId: subagent.parentNodeId },
      });
      if (classifyTaskAgentKind(task) === "agent") {
        yield* emit(state, { type: "subagent.updated", driver, subagent });
        const key = `task:${task.taskId}`;
        yield* saveItem(state, run, key, {
          ...itemBase(state, run, key, at),
          type: "subagent",
          nodeId: id,
          status: taskStatus,
          title,
          subagentId: id,
          origin: "provider_native",
          driver,
          providerInstanceId: instanceId,
          childThreadId: null,
          prompt: subagent.prompt,
          result: subagent.result,
          completedAt: subagent.completedAt,
        });
      }
      state.thread = {
        ...state.thread,
        pendingBackgroundTasks: [...state.tasks.entries()]
          .filter(([, t]) => ["pending", "running", "waiting"].includes(t.status))
          .map(([taskId, t]) => ({
            taskId,
            kind: "background_task" as const,
            ...(t.title ? { description: t.title } : {}),
          })),
        updatedAt: at,
      };
      yield* emitThread(state);
      return;
    }
    if (run.finished) return;
    if (event.type === "request.opened" || event.type === "user-input.requested") {
      if (!event.requestId) return;
      const requestId = RuntimeRequestId.make(scopedId(state, "request", event.requestId));
      const key = `request:${event.requestId}`;
      const isQuestion = event.type === "user-input.requested";
      const request: OrchestrationV2RuntimeRequest = {
        id: requestId,
        nodeId: NodeId.make(scopedId(state, "request-node", event.requestId)),
        providerTurnId: run.turn.id,
        nativeRequestRef: {
          driver,
          nativeId: event.providerRefs?.providerRequestId ?? event.requestId,
          strength: "strong",
        },
        kind: isQuestion
          ? "user_input"
          : event.payload.requestType === "file_read_approval"
            ? "file-read"
            : event.payload.requestType === "file_change_approval" ||
                event.payload.requestType === "apply_patch_approval"
              ? "file-change"
              : "command",
        status: "pending",
        responseCapability:
          isQuestion && event.payload.delivery === "async"
            ? { type: "message" }
            : { type: "live", providerSessionId: state.session.id },
        createdAt: at,
        resolvedAt: null,
        ...(isQuestion
          ? {
              isBlocking: event.payload.isBlocking,
              autoResolutionMs: event.payload.autoResolutionMs,
            }
          : {}),
      };
      state.requests.set(requestId, { nativeId: event.requestId, request });
      yield* emit(state, {
        type: "node.updated",
        driver,
        node: {
          ...node(
            state,
            run,
            request.nodeId,
            isQuestion ? "user_input_request" : "approval_request",
            "waiting",
            at,
          ),
          runtimeRequestId: requestId,
        },
      });
      yield* emit(state, {
        type: "runtime_request.updated",
        driver,
        threadId: run.input.threadId,
        runtimeRequest: request,
      });
      if (isQuestion) {
        yield* saveItem(state, run, key, {
          ...itemBase(state, run, key, at),
          type: "user_input_request",
          status: "waiting",
          requestId,
          questions: event.payload.questions.map((question) => ({
            ...question,
            allowCustomAnswer: question.isOther,
          })),
          ...(event.payload.delivery === "async" ? { responseMode: "message" as const } : {}),
          isBlocking: event.payload.isBlocking,
          autoResolutionMs: event.payload.autoResolutionMs,
        });
      } else {
        yield* saveItem(state, run, key, {
          ...itemBase(state, run, key, at),
          type: "approval_request",
          status: "waiting",
          requestId,
          requestKind:
            request.kind === "user_input" ||
            request.kind === "dynamic_tool_call" ||
            request.kind === "auth_refresh"
              ? "command"
              : request.kind,
          ...(event.payload.detail ? { prompt: event.payload.detail } : {}),
        });
      }
      return;
    }
    if (event.type === "turn.plan.updated") {
      const key = "plan";
      const planId = PlanId.make(scopedId(state, "todo", run.turn.id));
      yield* saveItem(state, run, key, {
        ...itemBase(state, run, key, at),
        type: "todo_list",
        planId,
        steps: event.payload.plan.map((step, i) => ({
          id: String(i),
          text: step.step,
          status: step.status === "inProgress" ? "running" : step.status,
        })),
        ...(event.payload.explanation ? { explanation: event.payload.explanation } : {}),
      });
      return;
    }
    if (event.type === "turn.proposed.delta" || event.type === "turn.proposed.completed") {
      const key = "proposed-plan";
      const previous = run.items.get(key);
      const markdown =
        event.type === "turn.proposed.completed"
          ? event.payload.planMarkdown
          : (previous?.type === "proposed_plan" ? previous.markdown : "") + event.payload.delta;
      yield* saveItem(state, run, key, {
        ...itemBase(state, run, key, at),
        type: "proposed_plan",
        planId: PlanId.make(scopedId(state, "proposed", run.turn.id)),
        markdown,
        streaming: event.type !== "turn.proposed.completed",
        ...(event.type === "turn.proposed.completed"
          ? { status: "completed", completedAt: at }
          : {}),
      });
      return;
    }
    if (event.type === "content.delta") {
      const key = event.itemId ?? `${event.payload.streamKind}:${run.turn.id}`;
      const previous = run.items.get(key);
      const base = itemBase(state, run, key, at);
      if (event.payload.streamKind === "assistant_text") {
        yield* saveItem(state, run, key, {
          ...base,
          type: "assistant_message",
          messageId: MessageId.make(scopedId(state, "message", `${run.turn.id}:${key}`)),
          text: (previous?.type === "assistant_message" ? previous.text : "") + event.payload.delta,
          streaming: true,
        });
      } else if (
        event.payload.streamKind === "reasoning_text" ||
        event.payload.streamKind === "reasoning_summary_text"
      ) {
        yield* saveItem(state, run, key, {
          ...base,
          type: "reasoning",
          text: (previous?.type === "reasoning" ? previous.text : "") + event.payload.delta,
          streaming: true,
        });
      } else if (previous?.type === "command_execution") {
        yield* saveItem(state, run, key, {
          ...previous,
          output: (previous.output ?? "") + event.payload.delta,
          updatedAt: at,
        });
      }
      return;
    }
    if (
      event.type === "item.started" ||
      event.type === "item.updated" ||
      event.type === "item.completed"
    ) {
      const key = event.itemId ?? event.eventId;
      const previous = run.items.get(key);
      const status: Item["status"] =
        event.payload.status === "failed"
          ? "failed"
          : event.payload.status === "declined"
            ? "cancelled"
            : event.type === "item.completed"
              ? "completed"
              : "running";
      const base = {
        ...itemBase(state, run, key, at),
        status,
        completedAt: status === "running" ? null : at,
        title: event.payload.title ?? previous?.title ?? null,
        ...(event.payload.agentId
          ? {
              agentId: event.payload.agentId,
              nodeId: NodeId.make(scopedId(state, "task", event.payload.agentId)),
            }
          : {}),
        ...(event.payload.parentToolUseId
          ? { parentToolUseId: event.payload.parentToolUseId }
          : {}),
      };
      const decoded = decodeItemData(event.payload.data);
      const data = Option.getOrUndefined(decoded);
      const nativeItem = data?.item ?? data;
      if (
        event.payload.itemType === "assistant_message" ||
        event.payload.itemType === "reasoning"
      ) {
        const text =
          nativeItem?.text ??
          (event.type === "item.completed" ? event.payload.detail : undefined) ??
          (previous && "text" in previous ? previous.text : "");
        const item: Item =
          event.payload.itemType === "assistant_message"
            ? {
                ...base,
                type: "assistant_message",
                messageId: MessageId.make(scopedId(state, "message", `${run.turn.id}:${key}`)),
                text,
                streaming: status === "running",
              }
            : { ...base, type: "reasoning", text, streaming: status === "running" };
        yield* saveItem(state, run, key, item);
      } else if (event.payload.itemType === "file_change") {
        const file = Option.getOrUndefined(decodeFileInput(data?.input));
        const changes = nativeItem?.changes;
        yield* saveItem(state, run, key, {
          ...base,
          type: "file_change",
          fileName:
            file?.file_path ??
            file?.path ??
            changes?.[0]?.path ??
            event.payload.title ??
            "File change",
          ...(changes
            ? {
                changes: changes.map((change) => ({
                  path: change.path,
                  operation: change.kind.type,
                })),
                diffStr: changes.map((change) => change.diff ?? "").join("\n"),
              }
            : {}),
          ...(file?.old_string !== undefined ? { oldStr: file.old_string } : {}),
          ...(file?.new_string !== undefined || file?.content !== undefined
            ? { newStr: file.new_string ?? file.content }
            : {}),
        });
      } else if (event.payload.itemType === "command_execution") {
        const command = Option.getOrUndefined(decodeCommand(data?.input));
        yield* saveItem(state, run, key, {
          ...base,
          type: "command_execution",
          input:
            nativeItem?.command ??
            command?.command ??
            (previous?.type === "command_execution"
              ? previous.input
              : (event.payload.detail ?? "")),
          output:
            nativeItem?.aggregatedOutput ??
            data?.output ??
            (previous?.type === "command_execution" ? previous.output : undefined),
          ...(nativeItem?.exitCode != null ? { exitCode: nativeItem?.exitCode } : {}),
        });
      } else if (event.payload.itemType !== "user_message") {
        yield* saveItem(state, run, key, {
          ...base,
          type: "dynamic_tool",
          toolName: data?.toolName ?? event.payload.title ?? event.payload.itemType,
          input:
            data?.input ??
            event.payload.data ??
            (previous?.type === "dynamic_tool" ? previous.input : null),
          output:
            data?.result ??
            data?.output ??
            event.payload.detail ??
            (previous?.type === "dynamic_tool" ? previous.output : undefined),
        });
      }
    }
  });

  const processEvent = (event: NativeEvent) => {
    const state = threads.get(event.threadId);
    return state ? state.eventMutex.withPermit(translateEvent(event)) : Effect.void;
  };
  yield* native.streamEvents.pipe(Stream.runForEach(processEvent), Effect.forkScoped);
  yield* Effect.addFinalizer(() => native.stopAll().pipe(Effect.ignore));

  const requireThread = (thread: OrchestrationV2ProviderThread) => {
    const state = thread.appThreadId ? threads.get(thread.appThreadId) : undefined;
    return state && state.thread.id === thread.id && thread.providerInstanceId === instanceId
      ? Effect.succeed(state)
      : Effect.fail(protocolError("The provider thread is not loaded in this instance."));
  };
  const startNative = Effect.fn("NativeAdapterV2.startNative")(function* (
    state: ThreadState,
    resumeCursor?: unknown,
  ) {
    const session = yield* native.startSession({
      threadId: state.key,
      provider: driver,
      providerInstanceId: instanceId,
      ...(state.policy.cwd ? { cwd: state.policy.cwd } : {}),
      modelSelection: state.model,
      runtimeMode: state.policy.runtimeMode,
      ...(resumeCursor === undefined ? {} : { resumeCursor, requireResume: true }),
    });
    const id = nativeId(session);
    state.thread = {
      ...state.thread,
      nativeThreadRef: id ? { driver, nativeId: id, strength: "strong" } : null,
      nativeMetadata: { itemIdentityVersion: 2, resumeCursor: session.resumeCursor },
      status: "idle",
      updatedAt: yield* DateTime.now,
    };
    yield* emitThread(state);
    return state.thread;
  });

  return {
    instanceId,
    driver,
    getCapabilities: () => Effect.succeed(capabilities),
    planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
    openSession: (open) =>
      Effect.gen(function* () {
        if (open.modelSelection.instanceId !== instanceId)
          return yield* protocolError("Model selection belongs to another provider instance.");
        const now = yield* DateTime.now;
        const events = yield* Queue.unbounded<Adapter.ProviderAdapterV2Event, Cause.Done>();
        const session: OrchestrationV2ProviderSession = {
          id: open.providerSessionId,
          driver,
          providerInstanceId: instanceId,
          status: "ready",
          cwd: open.runtimePolicy.cwd ?? process.cwd(),
          model: open.modelSelection.model,
          capabilities,
          createdAt: now,
          updatedAt: now,
          lastError: null,
        };
        let owned: ThreadState | undefined;
        const ensure = Effect.fn("NativeAdapterV2.ensureThread")(function* (
          ensureInput: Adapter.ProviderAdapterV2EnsureThreadInput,
        ) {
          const current = threads.get(ensureInput.threadId);
          if (
            ensureInput.threadId !== open.threadId ||
            (owned && owned.key !== ensureInput.threadId)
          )
            return yield* protocolError("A native session owns exactly one app thread.");
          if (current) {
            if (current !== owned || current.events !== events)
              return yield* protocolError(
                "This app thread already has an active provider session.",
              );
            if (
              ensureInput.existingProviderThread &&
              current.thread.id !== ensureInput.existingProviderThread.id
            )
              return yield* protocolError("A different native conversation is already loaded.");
            return current.thread;
          }
          const existing = ensureInput.existingProviderThread;
          if (existing && existing.providerInstanceId !== instanceId)
            return yield* protocolError("Cannot resume another provider instance's conversation.");
          const resumeCursor = existing?.nativeMetadata?.resumeCursor;
          if (existing && resumeCursor === undefined)
            return yield* protocolError(
              "Saved provider continuation state is missing; a fresh conversation must use a context handoff.",
            );
          const thread: OrchestrationV2ProviderThread = existing
            ? { ...existing, providerSessionId: session.id }
            : {
                id: ProviderThreadId.make(
                  ["provider-thread", instanceId, ensureInput.threadId, session.id]
                    .map(encodeURIComponent)
                    .join(":"),
                ),
                driver,
                providerInstanceId: instanceId,
                providerSessionId: session.id,
                appThreadId: ensureInput.threadId,
                ownerNodeId: null,
                nativeThreadRef: null,
                nativeConversationHeadRef: null,
                status: "not_loaded",
                firstRunOrdinal: null,
                lastRunOrdinal: null,
                handoffIds: [],
                forkedFrom: null,
                createdAt: now,
                updatedAt: now,
              };
          const state: ThreadState = {
            key: ensureInput.threadId,
            thread,
            model: ensureInput.modelSelection,
            policy: ensureInput.runtimePolicy,
            session,
            events,
            run: undefined,
            requests: new Map(),
            tasks: new Map(),
            taskRuns: new Map(),
            wakes: new Map(),
            eventMutex: yield* Semaphore.make(1),
          };
          threads.set(state.key, state);
          owned = state;
          return yield* startNative(state, resumeCursor).pipe(
            Effect.onError(() => Effect.sync(() => threads.delete(state.key))),
          );
        });
        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            if (!owned || owned.events !== events) return;
            threads.delete(owned.key);
            yield* native.stopSession(owned.key).pipe(Effect.ignore);
            yield* Queue.end(events);
          }),
        );
        const runtime: Adapter.ProviderAdapterV2SessionRuntime = {
          instanceId,
          driver,
          providerSessionId: session.id,
          providerSession: session,
          events: Stream.fromQueue(events),
          hasPendingBackgroundWork: Effect.sync(
            () =>
              (owned?.thread.pendingBackgroundTasks?.length ?? 0) > 0 ||
              (owned?.wakes.size ?? 0) > 0,
          ),
          hasPendingBackgroundWorkForThread: (thread) =>
            Effect.sync(
              () =>
                (threads.get(thread.appThreadId!)?.thread.pendingBackgroundTasks?.length ?? 0) >
                  0 || (threads.get(thread.appThreadId!)?.wakes.size ?? 0) > 0,
            ),
          ensureThread: (request) =>
            ensure(request).pipe(
              Effect.mapError(
                (cause) =>
                  new Adapter.ProviderAdapterEnsureThreadError({
                    driver,
                    threadId: request.threadId,
                    cause,
                  }),
              ),
            ),
          resumeThread: (request) =>
            ensure({
              threadId: request.threadId ?? request.providerThread.appThreadId ?? open.threadId,
              existingProviderThread: request.providerThread,
              modelSelection: request.modelSelection ?? open.modelSelection,
              runtimePolicy: request.runtimePolicy ?? open.runtimePolicy,
            }).pipe(
              Effect.mapError(
                (cause) =>
                  new Adapter.ProviderAdapterResumeThreadError({
                    driver,
                    providerSessionId: session.id,
                    providerThreadId: request.providerThread.id,
                    cause,
                  }),
              ),
            ),
          injectHistory: () => Effect.succeed(false),
          startTurn: (request) =>
            Effect.gen(function* () {
              const state = yield* requireThread(request.providerThread);
              if (request.modelSelection.instanceId !== instanceId)
                return yield* protocolError(
                  "Model selection belongs to another provider instance.",
                );
              if (state.run && !state.run.finished)
                return yield* protocolError("The provider thread already has a running turn.");
              const providerWake =
                request.message.createdBy === "agent" &&
                request.message.creationSource === "provider";
              const wake = state.wakes.entries().next().value;
              if (wake && !providerWake)
                return yield* protocolError(
                  "Ingest the pending provider continuation before sending another message.",
                );
              if (providerWake && !wake)
                return yield* protocolError("No provider continuation is pending.");
              if (!providerWake && state.policy.runtimeMode !== request.runtimePolicy.runtimeMode) {
                state.policy = request.runtimePolicy;
                state.model = request.modelSelection;
                yield* startNative(state, state.thread.nativeMetadata?.resumeCursor);
              }
              state.model = request.modelSelection;
              state.policy = request.runtimePolicy;
              const at = yield* DateTime.now;
              const sending = yield* Deferred.make<void>();
              const run: RunState = {
                input: request,
                nativeTurnId: undefined,
                sending,
                finished: false,
                ordinal: 0,
                items: new Map(),
                turn: {
                  id: ProviderTurnId.make(
                    [state.thread.id, request.attemptId, request.providerTurnOrdinal]
                      .map(String)
                      .map(encodeURIComponent)
                      .join(":"),
                  ),
                  providerThreadId: state.thread.id,
                  nodeId: request.rootNodeId,
                  runAttemptId: request.attemptId,
                  nativeTurnRef: null,
                  ordinal: request.providerTurnOrdinal,
                  status: "running",
                  startedAt: at,
                  completedAt: null,
                },
              };
              if (wake) {
                yield* state.eventMutex.withPermit(
                  Effect.gen(function* () {
                    state.run = run;
                    state.wakes.delete(wake[0]);
                    run.nativeTurnId = wake[0];
                    run.turn = {
                      ...run.turn,
                      nativeTurnRef: {
                        driver,
                        nativeId: wake[0],
                        strength: capabilities.identity.nativeTurnIds,
                      },
                    };
                    yield* Deferred.succeed(sending, undefined);
                    yield* emit(state, {
                      type: "provider_turn.updated",
                      driver,
                      threadId: request.threadId,
                      providerTurn: run.turn,
                    });
                    for (const event of wake[1]) yield* translateEvent(event);
                  }),
                );
                return;
              }
              state.run = run;
              yield* Effect.gen(function* () {
                const sent = yield* native
                  .sendTurn({
                    threadId: state.key,
                    input: request.message.text,
                    attachments: request.message.attachments,
                    modelSelection: request.modelSelection,
                    interactionMode: request.runtimePolicy.interactionMode,
                    sideChat: request.appThread.sideOfThreadId != null,
                  })
                  .pipe(Effect.exit);
                if (Exit.isSuccess(sent)) {
                  run.nativeTurnId = sent.value.turnId;
                  run.turn = {
                    ...run.turn,
                    nativeTurnRef: {
                      driver,
                      nativeId: sent.value.turnId,
                      strength: capabilities.identity.nativeTurnIds,
                    },
                  };
                  state.thread = {
                    ...state.thread,
                    status: "active",
                    firstRunOrdinal: state.thread.firstRunOrdinal ?? request.runOrdinal,
                    lastRunOrdinal: request.runOrdinal,
                    updatedAt: at,
                  };
                  yield* emit(state, {
                    type: "provider_turn.updated",
                    driver,
                    threadId: request.threadId,
                    providerTurn: run.turn,
                  });
                  yield* refreshCursor(state);
                } else run.finished = true;
                if (Exit.isFailure(sent)) return yield* Effect.failCause(sent.cause);
              }).pipe(Effect.ensuring(Deferred.succeed(sending, undefined)));
            }).pipe(
              Effect.mapError(
                (cause) =>
                  new Adapter.ProviderAdapterTurnStartError({
                    driver,
                    threadId: request.threadId,
                    providerThreadId: request.providerThread.id,
                    runId: request.runId,
                    cause,
                  }),
              ),
            ),
          steerTurn: (request) =>
            Effect.gen(function* () {
              const state = yield* requireThread(request.providerThread);
              if (!state.run || state.run.finished || state.run.turn.id !== request.providerTurnId)
                return yield* protocolError("The target turn is no longer running.");
              yield* native.sendTurn({
                threadId: state.key,
                input: request.message.text,
                attachments: request.message.attachments,
                modelSelection: state.model,
                interactionMode: state.policy.interactionMode,
              });
            }).pipe(
              Effect.mapError(
                (cause) =>
                  new Adapter.ProviderAdapterSteerRunError({
                    driver,
                    providerThreadId: request.providerThread.id,
                    providerTurnId: request.providerTurnId,
                    cause,
                  }),
              ),
            ),
          interruptTurn: (request) =>
            Effect.gen(function* () {
              const state = yield* requireThread(request.providerThread);
              if (!state.run || state.run.finished || state.run.turn.id !== request.providerTurnId)
                return;
              yield* native.interruptTurn(state.key, state.run.nativeTurnId);
            }).pipe(
              Effect.mapError(
                (cause) =>
                  new Adapter.ProviderAdapterInterruptError({
                    driver,
                    providerThreadId: request.providerThread.id,
                    providerTurnId: request.providerTurnId,
                    cause,
                  }),
              ),
            ),
          respondToRuntimeRequest: (request) =>
            Effect.gen(function* () {
              if (!owned) return yield* protocolError("No provider thread is loaded.");
              const pending = owned.requests.get(request.requestId);
              if (!pending || pending.request.status !== "pending")
                return yield* protocolError("The provider request is no longer pending.");
              if (pending.request.responseCapability.type !== "live")
                return yield* protocolError("This question must be answered with a new message.");
              if (pending.request.kind === "user_input") {
                if (!request.answers) return yield* protocolError("This request requires answers.");
                yield* native.respondToUserInput(
                  owned.key,
                  ApprovalRequestId.make(pending.nativeId),
                  request.answers,
                );
              } else {
                if (!request.decision)
                  return yield* protocolError("This request requires an approval decision.");
                yield* native.respondToRequest(
                  owned.key,
                  ApprovalRequestId.make(pending.nativeId),
                  request.decision,
                );
              }
            }).pipe(
              Effect.mapError(
                (cause) =>
                  new Adapter.ProviderAdapterRuntimeRequestResponseError({
                    driver,
                    requestId: request.requestId,
                    cause,
                  }),
              ),
            ),
          readThreadSnapshot: (request) =>
            Effect.fail(
              new Adapter.ProviderAdapterReadThreadSnapshotError({
                driver,
                providerThreadId: request.providerThread.id,
                cause: protocolError(
                  "Normalized provider history is not available; use the durable app transcript.",
                ),
              }),
            ),
          rollbackThread: (request) =>
            Effect.gen(function* () {
              const state = yield* requireThread(request.providerThread);
              if (state.run && !state.run.finished)
                return yield* protocolError(
                  "Stop the active turn before rewinding the conversation.",
                );
              const targetOrdinal =
                request.target.type === "thread_start" ? 0 : request.target.providerTurn.ordinal;
              const count = request.providerThreadTurns.filter(
                (turn) => turn.providerThreadId === state.thread.id && turn.ordinal > targetOrdinal,
              ).length;
              const snapshot = yield* native.rollbackThread(state.key, count);
              yield* refreshCursor(state);
              return {
                providerThread: state.thread,
                providerTurns: request.providerThreadTurns.filter(
                  (turn) => turn.ordinal <= targetOrdinal,
                ),
                messages: [],
                runtimeRequests: [],
                providerPayload: snapshot,
              };
            }).pipe(
              Effect.mapError(
                (cause) =>
                  new Adapter.ProviderAdapterRollbackThreadError({
                    driver,
                    providerThreadId: request.providerThread.id,
                    checkpointId: request.target.checkpointId,
                    cause,
                  }),
              ),
            ),
          forkThread: (request) =>
            Effect.gen(function* () {
              const source = yield* requireThread(request.sourceProviderThread);
              if (request.providerTurnId !== undefined)
                return yield* protocolError(
                  "Forking an arbitrary historical turn is not supported by this adapter.",
                );
              const model = request.modelSelection ?? source.model;
              if (model.instanceId !== instanceId)
                return yield* protocolError(
                  "Native forks must stay in the same provider instance.",
                );
              const policy = request.runtimePolicy ?? source.policy;
              yield* refreshCursor(source);
              const child = yield* native.startSession({
                threadId: request.targetThreadId,
                provider: driver,
                providerInstanceId: instanceId,
                ...(policy.cwd ? { cwd: policy.cwd } : {}),
                modelSelection: model,
                runtimeMode: policy.runtimeMode,
                forkFromThreadId: source.key,
                forkFromLatestCompletedTurn: true,
                forkResumeCursor: source.thread.nativeMetadata?.resumeCursor,
              });
              const id = nativeId(child);
              if (!id)
                return yield* protocolError("The provider fork did not return continuation state.");
              const at = yield* DateTime.now;
              const thread: OrchestrationV2ProviderThread = {
                ...source.thread,
                id: ProviderThreadId.make(
                  ["provider-thread", instanceId, id].map(encodeURIComponent).join(":"),
                ),
                appThreadId: request.targetThreadId,
                providerSessionId: null,
                ownerNodeId: request.ownerNodeId ?? null,
                nativeThreadRef: { driver, nativeId: id, strength: "strong" },
                nativeMetadata: { itemIdentityVersion: 2, resumeCursor: child.resumeCursor },
                nativeConversationHeadRef: null,
                firstRunOrdinal: null,
                lastRunOrdinal: null,
                pendingBackgroundTasks: [],
                status: "idle",
                forkedFrom: { providerThreadId: source.thread.id },
                createdAt: at,
                updatedAt: at,
              };
              // The target runtime will resume this saved cursor in its own scope.
              yield* native.stopSession(request.targetThreadId);
              return thread;
            }).pipe(
              Effect.mapError(
                (cause) =>
                  new Adapter.ProviderAdapterForkThreadError({
                    driver,
                    providerThreadId: request.sourceProviderThread.id,
                    cause,
                  }),
              ),
            ),
        };
        return runtime;
      }).pipe(
        Effect.mapError(
          (cause) =>
            new Adapter.ProviderAdapterOpenSessionError({
              driver,
              providerSessionId: open.providerSessionId,
              cause,
            }),
        ),
      ),
  } satisfies Adapter.ProviderAdapterV2Shape;
});
