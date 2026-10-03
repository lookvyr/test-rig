import * as NodeURL from "node:url";
import type {
  FormInfo1,
  ModelRef,
  PermissionRuleset,
  SessionMessageInfo,
  V2Event,
} from "@opencode/client";
import {
  EventId,
  ProviderDriverKind,
  RuntimeItemId,
  RuntimeRequestId,
  RuntimeTaskId,
  TurnId,
  type ModelSelection,
  type OpenCodeSettings,
  type ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type RuntimeMode,
  type ThreadId,
  type UserInputQuestion,
} from "@t3tools/contracts";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ServerConfig } from "../../config.ts";
import { resolveAttachmentPath } from "../../attachmentStore.ts";
import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../Errors.ts";
import type { ProviderAdapterShape, ProviderThreadSnapshot } from "../Services/ProviderAdapter.ts";
import { parseOpenCodeModelSlug } from "../opencodeRuntime.ts";
import {
  type OpenCode2Connection,
  type OpenCode2Runtime,
  runOpenCode2,
} from "./OpenCode2Runtime.ts";

const DRIVER = ProviderDriverKind.make("opencode");
const decodeResume = Schema.decodeUnknownOption(
  Schema.Struct({ schemaVersion: Schema.Literal(2), sessionId: Schema.String }),
);
const TURN_PREFIX = "msg_test_rig_turn_";

export function openCode2Permissions(mode: RuntimeMode): PermissionRuleset {
  return mode === "full-access"
    ? [{ action: "*", resource: "*", effect: "allow" }]
    : [
        { action: "shell", resource: "*", effect: "ask" },
        { action: "edit", resource: "*", effect: mode === "auto-accept-edits" ? "allow" : "ask" },
        { action: "external_directory", resource: "*", effect: "ask" },
      ];
}

/** The question UI can represent unconditional string and choice questions. */
export function supportedOpenCode2Form(form: FormInfo1): boolean {
  return form.fields.every(
    (field) =>
      !("hidden" in field && field.hidden) &&
      !("when" in field && field.when?.length) &&
      (field.type === "string" || field.type === "multiselect"),
  );
}

export function openCode2Model(selection: ModelSelection): ModelRef | undefined {
  const parsed = parseOpenCodeModelSlug(selection.model);
  if (!parsed) return undefined;
  const variant = getModelSelectionStringOptionValue(selection, "variant");
  return { providerID: parsed.providerID, id: parsed.modelID, ...(variant ? { variant } : {}) };
}

export function openCode2Questions(form: FormInfo1): ReadonlyArray<UserInputQuestion> {
  return form.fields
    .filter((field) => field.type !== "external" && !field.hidden)
    .map((field) => ({
      id: field.key,
      header: field.title || field.key,
      question: field.description || field.title || form.title || field.key,
      options:
        "options" in field
          ? (field.options ?? []).map((option) => ({
              label: option.label,
              description: option.description ?? option.value,
            }))
          : [],
      isOther: !("options" in field) || !field.options?.length || field.custom === true,
      multiSelect: field.type === "multiselect",
    }));
}

interface SessionState {
  session: ProviderSession;
  nativeId: string;
  connection: OpenCode2Connection;
  scope: Scope.Closeable;
  model: ModelSelection;
  activeTurnId?: TurnId | undefined;
  activeHistoryBoundary?: string | null | undefined;
  grants: Map<string, PermissionRuleset>;
  rules: PermissionRuleset;
  plan: boolean;
  texts: Map<string, string>;
  tools: Map<string, { name: string; input: unknown }>;
  requests: Map<
    RuntimeRequestId,
    {
      sessionId: string;
      permissionId?: string;
      action?: string;
      resources?: ReadonlyArray<string> | undefined;
      form?: FormInfo1;
    }
  >;
}

/** OpenCode 2 is the only executable OpenCode runtime. Legacy cursors are never resumed. */
export const makeOpenCode2Adapter = Effect.fn("makeOpenCode2Adapter")(function* (
  settings: OpenCodeSettings,
  instanceId: ProviderInstanceId,
  runtime: OpenCode2Runtime,
) {
  const config = yield* ServerConfig;
  const crypto = yield* Crypto.Crypto;
  const sessions = new Map<ThreadId, SessionState>();
  const events = yield* Queue.unbounded<ProviderRuntimeEvent>();
  const children = new Map<string, { parent: SessionState; parentId: string }>();
  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const uuid = crypto.randomUUIDv4.pipe(Effect.orDie);
  const error = (threadId: ThreadId, method: string, cause: unknown) =>
    new ProviderAdapterRequestError({
      provider: DRIVER,
      method,
      detail: `OpenCode 2 ${method} failed.`,
      cause,
    });
  const validation = (operation: string, issue: string) =>
    new ProviderAdapterValidationError({ provider: DRIVER, operation, issue });
  const offer = (event: ProviderRuntimeEvent) => Queue.offer(events, event).pipe(Effect.asVoid);
  const base = Effect.fn("OpenCode2Adapter.event")(function* (
    state: SessionState,
    event?: V2Event,
  ) {
    return {
      eventId: EventId.make(event?.id ?? (yield* uuid)),
      provider: DRIVER,
      providerInstanceId: instanceId,
      threadId: state.session.threadId,
      createdAt: yield* nowIso,
      ...(state.activeTurnId ? { turnId: state.activeTurnId } : {}),
      ...(event
        ? { raw: { source: "opencode.sdk.event" as const, method: event.type, payload: event } }
        : {}),
    };
  });
  const requireSession = (threadId: ThreadId) => {
    const state = sessions.get(threadId);
    return state
      ? Effect.succeed(state)
      : Effect.fail(new ProviderAdapterSessionNotFoundError({ provider: DRIVER, threadId }));
  };
  const setActive = Effect.fn("OpenCode2Adapter.setActive")(function* (
    state: SessionState,
    turnId: TurnId,
  ) {
    state.activeTurnId = turnId;
    state.session = {
      ...state.session,
      status: "running",
      activeTurnId: turnId,
      updatedAt: yield* nowIso,
    };
    yield* offer({ ...(yield* base(state)), type: "turn.started", payload: {} });
  });
  const finish = Effect.fn("OpenCode2Adapter.finish")(function* (
    state: SessionState,
    status: "completed" | "interrupted" | "failed",
    detail?: string,
  ) {
    if (!state.activeTurnId) return;
    yield* offer({
      ...(yield* base(state)),
      type: "turn.completed",
      payload: { state: status, ...(detail ? { errorMessage: detail } : {}) },
    });
    state.activeTurnId = undefined;
    state.activeHistoryBoundary = undefined;
    state.session = {
      ...state.session,
      activeTurnId: undefined,
      status: status === "failed" ? "error" : "ready",
      updatedAt: yield* nowIso,
    };
  });
  const handle = Effect.fn("OpenCode2Adapter.handle")(function* (
    root: SessionState,
    event: V2Event,
  ) {
    if (
      event.type === "session.created" &&
      event.data.parentID &&
      (event.data.parentID === root.nativeId || children.get(event.data.parentID)?.parent === root)
    ) {
      children.set(event.data.sessionID, { parent: root, parentId: event.data.parentID });
      yield* offer({
        ...(yield* base(root, event)),
        type: "task.started",
        payload: {
          taskId: RuntimeTaskId.make(event.data.sessionID),
          taskType: "subagent",
          title: event.data.title || "OpenCode agent",
          ...(event.data.parentID !== root.nativeId ? { parentAgentId: event.data.parentID } : {}),
        },
      });
      return;
    }
    const nativeSessionId =
      event.type === "form.created"
        ? event.data.form.sessionID
        : "sessionID" in event.data
          ? event.data.sessionID
          : undefined;
    if (typeof nativeSessionId !== "string") return;
    const child = children.get(nativeSessionId);
    if (nativeSessionId !== root.nativeId && child?.parent !== root) return;
    if (event.type === "permission.asked") {
      const id = RuntimeRequestId.make(event.data.id);
      root.requests.set(id, {
        sessionId: nativeSessionId,
        permissionId: event.data.id,
        action: event.data.action,
        resources: event.data.save,
      });
      yield* offer({
        ...(yield* base(root, event)),
        type: "request.opened",
        requestId: id,
        providerRefs: { providerRequestId: event.data.id },
        payload: {
          requestType:
            event.data.action === "read"
              ? "file_read_approval"
              : ["edit", "write", "apply_patch"].includes(event.data.action)
                ? "file_change_approval"
                : "command_execution_approval",
          detail: event.data.message || `${event.data.action}: ${event.data.resources.join(", ")}`,
          args: event.data,
        },
      });
      return;
    }
    if (event.type === "form.created") {
      const form = event.data.form;
      if (!supportedOpenCode2Form(form)) {
        yield* runOpenCode2("form.cancel", (signal) =>
          root.connection.client.session.form.cancel(
            { sessionID: nativeSessionId, formID: form.id },
            { signal },
          ),
        );
        yield* offer({
          ...(yield* base(root, event)),
          type: "runtime.error",
          payload: {
            message:
              "OpenCode requested a form with fields Test Rig cannot display. The question was cancelled.",
            class: "provider_error",
          },
        });
        return;
      }
      const id = RuntimeRequestId.make(form.id);
      root.requests.set(id, { sessionId: nativeSessionId, form });
      yield* offer({
        ...(yield* base(root, event)),
        type: "user-input.requested",
        requestId: id,
        providerRefs: { providerRequestId: form.id },
        payload: { questions: openCode2Questions(form), isBlocking: true },
      });
      return;
    }
    if (
      event.type === "permission.replied" ||
      event.type === "form.replied" ||
      event.type === "form.cancelled"
    ) {
      const id = RuntimeRequestId.make(
        event.type === "permission.replied" ? event.data.requestID : event.data.id,
      );
      root.requests.delete(id);
      if (event.type === "permission.replied")
        yield* offer({
          ...(yield* base(root, event)),
          type: "request.resolved",
          requestId: id,
          payload: { requestType: "unknown", decision: event.data.reply },
        });
      else
        yield* offer({
          ...(yield* base(root, event)),
          type: "user-input.resolved",
          requestId: id,
          payload: {
            answers: event.type === "form.replied" ? event.data.answer : {},
            ...(event.type === "form.cancelled" ? { reason: "cancelled" as const } : {}),
          },
        });
      return;
    }
    if (child) {
      if (
        event.type === "session.execution.succeeded" ||
        event.type === "session.execution.failed" ||
        event.type === "session.execution.interrupted"
      ) {
        yield* offer({
          ...(yield* base(root, event)),
          type: "task.completed",
          payload: {
            taskId: RuntimeTaskId.make(nativeSessionId),
            taskType: "subagent",
            status:
              event.type === "session.execution.succeeded"
                ? "completed"
                : event.type === "session.execution.failed"
                  ? "failed"
                  : "stopped",
          },
        });
      }
      return;
    }
    if (event.type === "session.execution.started") {
      if (!root.activeTurnId) yield* setActive(root, TurnId.make(`opencode-wake:${event.id}`));
      return;
    }
    if (
      event.type === "session.execution.succeeded" ||
      event.type === "session.execution.failed" ||
      event.type === "session.execution.interrupted"
    ) {
      yield* finish(
        root,
        event.type === "session.execution.succeeded"
          ? "completed"
          : event.type === "session.execution.failed"
            ? "failed"
            : "interrupted",
        event.type === "session.execution.failed" ? event.data.error.message : undefined,
      );
      return;
    }
    if (!root.activeTurnId) return;
    if (
      event.type === "session.text.delta" ||
      event.type === "session.reasoning.delta" ||
      event.type === "session.text.ended" ||
      event.type === "session.reasoning.ended"
    ) {
      const key = `${event.data.assistantMessageID}:${event.data.ordinal}`;
      const reasoning = event.type.startsWith("session.reasoning");
      if ("delta" in event.data) {
        root.texts.set(key, (root.texts.get(key) ?? "") + event.data.delta);
        yield* offer({
          ...(yield* base(root, event)),
          type: "content.delta",
          itemId: RuntimeItemId.make(key),
          payload: {
            streamKind: reasoning ? "reasoning_text" : "assistant_text",
            delta: event.data.delta,
          },
        });
      } else {
        // Full text also covers providers that emit only a terminal text item.
        yield* offer({
          ...(yield* base(root, event)),
          type: "item.completed",
          itemId: RuntimeItemId.make(key),
          payload: {
            itemType: reasoning ? "reasoning" : "assistant_message",
            status: "completed",
            detail: event.data.text,
            data: { text: event.data.text },
          },
        });
        root.texts.delete(key);
      }
      return;
    }
    if (event.type === "session.tool.input.started") {
      root.tools.set(event.data.id, { name: event.data.name, input: {} });
    }
    if (
      event.type === "session.tool.input.started" ||
      event.type === "session.tool.called" ||
      event.type === "session.tool.success" ||
      event.type === "session.tool.failed"
    ) {
      const tool = root.tools.get(event.data.id) ?? { name: "tool", input: {} };
      if (event.type === "session.tool.called") tool.input = event.data.input;
      const done = event.type === "session.tool.success" || event.type === "session.tool.failed";
      const output =
        "content" in event.data
          ? (event.data.content ?? [])
              .flatMap((content) => (content.type === "text" ? [content.text] : []))
              .join("\n")
          : undefined;
      const itemId = RuntimeItemId.make(event.data.id);
      yield* offer({
        ...(yield* base(root, event)),
        type: done ? "item.completed" : "item.started",
        itemId,
        payload: {
          itemType:
            tool.name === "shell" || tool.name === "bash"
              ? "command_execution"
              : "dynamic_tool_call",
          status:
            event.type === "session.tool.failed" ? "failed" : done ? "completed" : "inProgress",
          title: tool.name,
          ...(output ? { detail: output } : {}),
          data: { toolName: tool.name, input: tool.input, output },
        },
      });
      if (done) root.tools.delete(event.data.id);
    }
  });

  const readMessages = Effect.fn("OpenCode2Adapter.readMessages")(function* (state: SessionState) {
    const messages: Array<SessionMessageInfo> = [];
    let cursor: string | undefined;
    do {
      const page = yield* runOpenCode2("message.list", (signal) =>
        state.connection.client.message.list(
          {
            sessionID: state.nativeId,
            limit: 100,
            ...(cursor ? { cursor } : { order: "asc" as const }),
          },
          { signal },
        ),
      );
      messages.push(...page.data);
      cursor = page.cursor.next ?? undefined;
    } while (cursor);
    return messages;
  });
  const snapshot = Effect.fn("OpenCode2Adapter.snapshot")(function* (
    state: SessionState,
  ): Effect.fn.Return<
    ProviderThreadSnapshot,
    import("../opencodeRuntime.ts").OpenCodeRuntimeError
  > {
    const messages = yield* readMessages(state);
    const turns: Array<{ id: TurnId; items: Array<unknown> }> = [];
    for (const message of messages) {
      if (
        (message.type === "user" && !message.id.startsWith("msg_test_rig_steer_")) ||
        (message.type === "compaction" && message.id.startsWith(TURN_PREFIX))
      )
        turns.push({ id: TurnId.make(message.id), items: [message] });
      else turns.at(-1)?.items.push(message);
    }
    return { threadId: state.session.threadId, turns };
  });
  const stop = Effect.fn("OpenCode2Adapter.stop")(function* (threadId: ThreadId) {
    const state = sessions.get(threadId);
    if (!state) return;
    sessions.delete(threadId);
    for (const [id, child] of children)
      if (child.parent === state)
        yield* runOpenCode2("interrupt child", (signal) =>
          state.connection.client.session.interrupt({ sessionID: id }, { signal }),
        ).pipe(Effect.timeout("5 seconds"), Effect.ignore);
    if (state.activeTurnId)
      yield* runOpenCode2("interrupt", (signal) =>
        state.connection.client.session.interrupt({ sessionID: state.nativeId }, { signal }),
      ).pipe(Effect.timeout("5 seconds"), Effect.ignore);
    yield* Scope.close(state.scope, Exit.void);
    for (const [id, child] of children) if (child.parent === state) children.delete(id);
  });
  yield* Effect.addFinalizer(() => Effect.forEach([...sessions.keys()], stop, { discard: true }));

  return {
    provider: DRIVER,
    capabilities: { sessionModelSwitch: "in-session" },
    streamEvents: Stream.fromQueue(events),
    startSession: (input) =>
      Effect.gen(function* () {
        if (!settings.enabled) return yield* validation("startSession", "OpenCode is disabled.");
        if (input.modelSelection?.instanceId !== instanceId)
          return yield* validation(
            "startSession",
            "Choose a model belonging to this OpenCode instance.",
          );
        const model = openCode2Model(input.modelSelection);
        if (!model)
          return yield* validation(
            "startSession",
            "OpenCode models use provider/model identifiers.",
          );
        const scope = yield* Scope.make();
        let transferred = false;
        const started = yield* Effect.gen(function* () {
          const connection = yield* runtime.acquire;
          const stream = yield* connection.subscribe;
          const client = connection.client;
          let nativeId: string;
          if (input.forkFromThreadId) {
            const source = yield* requireSession(input.forkFromThreadId);
            const history = yield* readMessages(source);
            if (!history.length)
              return yield* validation("fork", "The source has no saved conversation to fork.");
            if (source.activeTurnId && source.activeHistoryBoundary === undefined)
              return yield* validation(
                "fork",
                "This native background turn has no completed fork boundary yet.",
              );
            const index =
              source.activeHistoryBoundary === null
                ? -1
                : history.findIndex((message) => message.id === source.activeHistoryBoundary);
            if (source.activeTurnId && source.activeHistoryBoundary !== null && index < 0)
              return yield* validation(
                "fork",
                "The completed fork boundary is no longer available after compaction.",
              );
            const before = source.activeTurnId ? history[index + 1]?.id : undefined;
            if (source.activeTurnId && !before)
              return yield* validation(
                "fork",
                "OpenCode has not saved the current turn boundary yet. Retry once its response starts.",
              );
            nativeId = (yield* runOpenCode2("session.fork", (signal) =>
              client.session.fork(
                {
                  sessionID: source.nativeId,
                  ...(before ? { before } : {}),
                },
                { signal },
              ),
            )).id;
          } else if (input.resumeCursor !== undefined || input.requireResume) {
            const cursor = decodeResume(input.resumeCursor);
            if (Option.isNone(cursor))
              return yield* validation(
                "resume",
                "This is not an OpenCode 2 continuation. Start a new session using the saved transcript.",
              );
            nativeId = cursor.value.sessionId;
            yield* runOpenCode2("session.get", (signal) =>
              client.session.get({ sessionID: nativeId }, { signal }),
            );
          } else {
            nativeId = (yield* runOpenCode2("session.create", (signal) =>
              client.session.create(
                {
                  title: "Test Rig",
                  location: { directory: input.cwd ?? config.cwd },
                  model,
                  permissions: openCode2Permissions(input.runtimeMode),
                },
                { signal },
              ),
            )).id;
          }
          yield* runOpenCode2("session.update", (signal) =>
            client.session.update(
              { sessionID: nativeId, permissions: openCode2Permissions(input.runtimeMode) },
              { signal },
            ),
          );
          yield* stop(input.threadId);
          const now = yield* nowIso;
          const session: ProviderSession = {
            provider: DRIVER,
            providerInstanceId: instanceId,
            threadId: input.threadId,
            runtimeMode: input.runtimeMode,
            cwd: input.cwd ?? config.cwd,
            model: input.modelSelection!.model,
            status: "ready",
            resumeCursor: { schemaVersion: 2, sessionId: nativeId },
            createdAt: now,
            updatedAt: now,
          };
          const active = yield* runOpenCode2("session.active", (signal) =>
            client.session.active({ signal }),
          );
          if (active[nativeId])
            return yield* validation(
              "resume",
              "This OpenCode session is still running. Stop it in OpenCode before resuming here.",
            );
          const state: SessionState = {
            session,
            nativeId,
            connection,
            scope,
            model: input.modelSelection!,
            texts: new Map(),
            tools: new Map(),
            requests: new Map(),
            grants: new Map(),
            rules: openCode2Permissions(input.runtimeMode),
            plan: false,
          };
          sessions.set(input.threadId, state);
          yield* stream.pipe(
            Stream.runForEach((event) => handle(state, event)),
            Effect.exit,
            Effect.flatMap(() =>
              Effect.gen(function* () {
                if (sessions.get(input.threadId) !== state) return;
                yield* finish(
                  state,
                  "failed",
                  "The OpenCode 2 event stream disconnected. Resume the conversation to reconnect.",
                );
                state.session = {
                  ...state.session,
                  status: "error",
                  lastError: "OpenCode 2 event stream disconnected.",
                };
                yield* offer({
                  ...(yield* base(state)),
                  type: "session.exited",
                  payload: {
                    reason: "OpenCode 2 event stream disconnected.",
                    recoverable: true,
                    exitKind: "error",
                  },
                });
              }),
            ),
            Effect.forkScoped,
          );
          yield* offer({
            ...(yield* base(state)),
            type: "thread.started",
            payload: { providerThreadId: nativeId },
          });
          transferred = true;
          return session;
        }).pipe(
          Effect.provideService(Scope.Scope, scope),
          Effect.onExit(() => (transferred ? Effect.void : Scope.close(scope, Exit.void))),
          Effect.exit,
        );
        if (Exit.isFailure(started)) {
          return yield* Effect.failCause(started.cause);
        }
        return started.value;
      }).pipe(Effect.mapError((cause) => error(input.threadId, "startSession", cause))),
    sendTurn: (input) =>
      Effect.gen(function* () {
        const state = yield* requireSession(input.threadId);
        const selection = input.modelSelection ?? state.model;
        if (selection.instanceId !== instanceId)
          return yield* validation(
            "sendTurn",
            "Model selection belongs to another provider instance.",
          );
        const model = openCode2Model(selection);
        if (!model)
          return yield* validation("sendTurn", "OpenCode models use provider/model identifiers.");
        const client = state.connection.client;
        const sessionID = state.nativeId;
        yield* runOpenCode2("session.switchModel", (signal) =>
          client.session.switchModel({ sessionID, model }, { signal }),
        );
        const agent =
          input.interactionMode === "plan"
            ? "plan"
            : (getModelSelectionStringOptionValue(selection, "agent") ?? "build");
        if (agent)
          yield* runOpenCode2("session.switchAgent", (signal) =>
            client.session.switchAgent({ sessionID, agent }, { signal }),
          );
        const plan = input.interactionMode === "plan";
        const listed = yield* runOpenCode2("agent.list", (signal) =>
          client.agent.list(
            { location: { directory: state.session.cwd ?? config.cwd } },
            { signal },
          ),
        );
        const paths =
          listed.data
            .find((entry) => entry.id === agent)
            ?.permissions.filter(
              (rule) =>
                rule.effect === "allow" &&
                rule.resource !== "*" &&
                (rule.action === "edit" || rule.action === "external_directory"),
            ) ?? [];
        state.rules = [
          ...openCode2Permissions(state.session.runtimeMode),
          ...(state.grants.get(sessionID) ?? []),
          ...(plan ? [{ action: "edit", resource: "*", effect: "deny" as const }] : []),
          ...paths,
        ];
        yield* runOpenCode2("session.update", (signal) =>
          client.session.update({ sessionID, permissions: state.rules }, { signal }),
        );
        state.plan = plan;
        state.model = selection;
        const steering = state.activeTurnId !== undefined;
        const turnId =
          state.activeTurnId ?? TurnId.make(`${TURN_PREFIX}${sessionID}:${yield* uuid}`);
        if (!steering) {
          const latest = yield* runOpenCode2("message.list", (signal) =>
            client.message.list({ sessionID, order: "desc", limit: 1 }, { signal }),
          );
          state.activeHistoryBoundary = latest.data[0]?.id ?? null;
          yield* setActive(state, turnId);
        }
        const files = (input.attachments ?? [])
          .map((attachment) => {
            const path = resolveAttachmentPath({
              attachmentsDir: config.attachmentsDir,
              attachment,
            });
            return path
              ? { uri: NodeURL.pathToFileURL(path).href, name: attachment.name }
              : undefined;
          })
          .filter((file) => file !== undefined);
        const text = input.input ?? "";
        const command = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim());
        const send = Effect.gen(function* () {
          if (!steering && text.trim() === "/compact") {
            yield* runOpenCode2("session.compact", (signal) =>
              client.session.compact({ sessionID, id: turnId }, { signal }),
            );
          } else if (
            !steering &&
            command &&
            (yield* runOpenCode2("command.list", (signal) =>
              client.command.list(
                { location: { directory: state.session.cwd ?? config.cwd } },
                { signal },
              ),
            )).data.some((entry) => entry.name === command[1])
          ) {
            yield* runOpenCode2("session.command", (signal) =>
              client.session.command(
                { sessionID, name: command[1]!, text: command[2] ?? "", files },
                { signal },
              ),
            );
          } else {
            const mentioned = [...text.matchAll(/\$([\w./-]+)/g)].map((match) => match[1]!);
            const skills = mentioned.length
              ? (yield* runOpenCode2("skill.list", (signal) =>
                  client.skill.list(
                    { location: { directory: state.session.cwd ?? config.cwd } },
                    { signal },
                  ),
                )).data
                  .filter((skill) => mentioned.includes(skill.id))
                  .map((skill) => ({ id: skill.id }))
              : [];
            const promptId = steering ? `msg_test_rig_steer_${yield* uuid}` : turnId;
            yield* runOpenCode2("session.prompt", (signal) =>
              client.session.prompt(
                {
                  sessionID,
                  id: promptId,
                  text,
                  files,
                  skills,
                  ...(steering ? { delivery: "steer" } : {}),
                },
                { signal },
              ),
            );
          }
        });
        yield* send.pipe(
          Effect.onError(() => finish(state, "failed", "OpenCode 2 could not start the prompt.")),
        );
        return { threadId: input.threadId, turnId, resumeCursor: state.session.resumeCursor };
      }).pipe(Effect.mapError((cause) => error(input.threadId, "sendTurn", cause))),
    interruptTurn: (threadId) =>
      Effect.gen(function* () {
        const state = yield* requireSession(threadId);
        for (const [id, child] of children)
          if (child.parent === state)
            yield* runOpenCode2("interrupt child", (signal) =>
              state.connection.client.session.interrupt({ sessionID: id }, { signal }),
            );
        yield* runOpenCode2("interrupt", (signal) =>
          state.connection.client.session.interrupt({ sessionID: state.nativeId }, { signal }),
        );
      }).pipe(Effect.mapError((cause) => error(threadId, "interrupt", cause))),
    respondToRequest: (threadId, requestId, decision) =>
      Effect.gen(function* () {
        const state = yield* requireSession(threadId);
        const request = state.requests.get(RuntimeRequestId.make(requestId));
        if (!request?.permissionId)
          return yield* validation("permission.reply", "This approval is no longer pending.");
        if (decision === "acceptForSession" && request.action) {
          const grants = [
            ...(state.grants.get(request.sessionId) ?? []),
            ...(request.resources ?? []).map((resource) => ({
              action: request.action!,
              resource,
              effect: "allow" as const,
            })),
          ];
          state.grants.set(request.sessionId, grants);
          const native = yield* runOpenCode2("session.get", (signal) =>
            state.connection.client.session.get({ sessionID: request.sessionId }, { signal }),
          );
          yield* runOpenCode2("session.update", (signal) =>
            state.connection.client.session.update(
              {
                sessionID: request.sessionId,
                permissions: [
                  ...(native.permissions ?? []),
                  ...grants,
                  ...(state.plan
                    ? [{ action: "edit", resource: "*", effect: "deny" as const }]
                    : []),
                ],
              },
              { signal },
            ),
          );
        }
        yield* runOpenCode2("permission.reply", (signal) =>
          state.connection.client.permission.reply(
            {
              sessionID: request.sessionId,
              requestID: request.permissionId!,
              decision:
                decision === "accept" || decision === "acceptForSession" ? "once" : "reject",
              ...(decision === "decline"
                ? { message: "The user declined this action. Continue without it." }
                : {}),
            },
            { signal },
          ),
        );
      }).pipe(Effect.mapError((cause) => error(threadId, "permission.reply", cause))),
    respondToUserInput: (threadId, requestId, answers) =>
      Effect.gen(function* () {
        const state = yield* requireSession(threadId);
        const request = state.requests.get(RuntimeRequestId.make(requestId));
        if (!request?.form)
          return yield* validation("form.reply", "This question is no longer pending.");
        const answer: Record<string, string | number | boolean | Array<string>> = {};
        for (const field of request.form.fields) {
          if (field.type !== "string" && field.type !== "multiselect")
            return yield* validation("form.reply", "Unsupported form field.");
          const raw = answers[field.key];
          if (raw === undefined) {
            if (field.default !== undefined) answer[field.key] = field.default;
            else if (field.required)
              return yield* validation(
                "form.reply",
                `Answer required for ${field.title ?? field.key}.`,
              );
            continue;
          }
          const values =
            typeof raw === "string"
              ? [raw]
              : Array.isArray(raw) && raw.every((value) => typeof value === "string")
                ? raw
                : undefined;
          if (!values)
            return yield* validation(
              "form.reply",
              "Answers must contain text or selected choices.",
            );
          const mapped = values.map(
            (value) => field.options?.find((option) => option.label === value)?.value ?? value,
          );
          if (
            field.options?.length &&
            field.custom !== true &&
            mapped.some((value) => !field.options!.some((option) => option.value === value))
          )
            return yield* validation("form.reply", "Choose one of the listed options.");
          answer[field.key] = field.type === "multiselect" ? mapped : (mapped[0] ?? "");
        }
        yield* runOpenCode2("form.reply", (signal) =>
          state.connection.client.session.form.reply(
            { sessionID: request.sessionId, formID: request.form!.id, answer },
            { signal },
          ),
        );
      }).pipe(Effect.mapError((cause) => error(threadId, "form.reply", cause))),
    stopSession: stop,
    stopAll: () => Effect.forEach([...sessions.keys()], stop, { discard: true }),
    listSessions: () => Effect.sync(() => [...sessions.values()].map((state) => state.session)),
    hasSession: (threadId) => Effect.sync(() => sessions.has(threadId)),
    readThread: (threadId) =>
      requireSession(threadId).pipe(
        Effect.flatMap(snapshot),
        Effect.mapError((cause) => error(threadId, "readThread", cause)),
      ),
    rollbackThread: (threadId, numTurns) =>
      Effect.gen(function* () {
        const state = yield* requireSession(threadId);
        if (state.activeTurnId)
          return yield* validation("rollback", "Stop the active turn before rewinding.");
        const before = yield* snapshot(state);
        if (numTurns === 0) return before;
        const target = before.turns[before.turns.length - numTurns];
        if (!target)
          return yield* validation("rollback", "The requested turn boundary is not available.");
        yield* runOpenCode2("revert.stage", (signal) =>
          state.connection.client.session.revert.stage(
            { sessionID: state.nativeId, messageID: target.id, files: false },
            { signal },
          ),
        );
        yield* runOpenCode2("revert.commit", (signal) =>
          state.connection.client.session.revert.commit({ sessionID: state.nativeId }, { signal }),
        );
        return yield* snapshot(state);
      }).pipe(Effect.mapError((cause) => error(threadId, "rollback", cause))),
  } satisfies ProviderAdapterShape<ProviderAdapterError>;
});
