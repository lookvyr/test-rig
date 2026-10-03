import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, assert } from "@effect/vitest";
import type { FormInfo1, V2Event } from "@opencode/client";
import {
  ApprovalRequestId,
  OpenCodeSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ServerConfig } from "../../config.ts";
import { makeOpenCode2Adapter, supportedOpenCode2Form } from "./OpenCode2Adapter.ts";
import { makeOpenCode2Fixture } from "./OpenCode2TestFixture.ts";
import { requireOpenCode2Version } from "./OpenCode2Runtime.ts";

const layer = ServerConfig.layerTest(process.cwd(), { prefix: "opencode2-adapter-test-" }).pipe(
  Layer.provideMerge(NodeServices.layer),
);
const settings = Schema.decodeSync(OpenCodeSettings)({ enabled: true });
const instanceId = ProviderInstanceId.make("opencode-test");
const threadId = ThreadId.make("thread");
const modelSelection = { instanceId, model: "opencode/big-pickle" };
const start = {
  threadId,
  modelSelection,
  provider: ProviderDriverKind.make("opencode"),
  runtimeMode: "full-access" as const,
  cwd: "/tmp",
};
const make = Effect.gen(function* () {
  const fixture = yield* makeOpenCode2Fixture;
  const adapter = yield* makeOpenCode2Adapter(settings, instanceId, fixture.runtime);
  const events = yield* Queue.unbounded<ProviderRuntimeEvent>();
  const collected: Array<ProviderRuntimeEvent> = [];
  yield* adapter.streamEvents.pipe(
    Stream.runForEach((event) => {
      collected.push(event);
      return Queue.offer(events, event);
    }),
    Effect.forkScoped,
  );
  yield* adapter.startSession(start);
  const next = (type: ProviderRuntimeEvent["type"]): Effect.Effect<ProviderRuntimeEvent> =>
    Effect.gen(function* () {
      while (true) {
        const event = yield* Queue.take(events);
        if (event.type === type) return event;
      }
    });
  return { ...fixture, adapter, next, collected };
});
const form: FormInfo1 = {
  id: "form1",
  title: "Choose",
  sessionID: "ses_1",
  fields: [
    { key: "choice", type: "string", title: "Choose", options: [{ label: "One", value: "one" }] },
  ],
};
const eventBase = {
  id: "evt",
  created: 1,
  durable: { aggregateID: "ses_1", seq: 1, version: 1 as const },
};

it.layer(layer)("OpenCode 2 adapter", (it) => {
  it.effect("maps root output and terminal events without ending on a child terminal", () =>
    Effect.gen(function* () {
      const f = yield* make;
      const sent = yield* f.adapter.sendTurn({ threadId, input: "hello" });
      f.emit({
        ...eventBase,
        type: "session.created",
        data: {
          sessionID: "child",
          parentID: "ses_1",
          projectID: "global",
          slug: "child",
          version: "2.0.18",
          location: { directory: "/tmp" },
          permissions: [],
        },
      });
      yield* f.next("task.started");
      f.emit(f.terminal("child"));
      yield* f.next("task.completed");
      assert.isFalse(f.collected.some((event) => event.type === "turn.completed"));
      f.emit(f.text("ses_1", "answer"));
      yield* f.next("item.completed");
      f.emit(f.terminal("ses_1"));
      const terminal = yield* f.next("turn.completed");
      assert.strictEqual(terminal.turnId, sent.turnId);
    }),
  );
  it.effect("switches plan back to build and keeps plan edits scoped", () =>
    Effect.gen(function* () {
      const f = yield* make;
      yield* f.adapter.sendTurn({ threadId, input: "plan", interactionMode: "plan" });
      const planRules = f.requests.findLast((r) => r.method === "PATCH")?.body;
      assert.deepInclude(planRules, {
        permissions: [
          { action: "*", resource: "*", effect: "allow" },
          { action: "edit", resource: "*", effect: "deny" },
          { action: "edit", resource: "/tmp/plans/*", effect: "allow" },
        ],
      });
      f.emit(f.terminal("ses_1"));
      yield* f.next("turn.completed");
      yield* f.adapter.sendTurn({ threadId, input: "build", interactionMode: "default" });
      assert.deepStrictEqual(
        f.requests
          .filter((r) => r.method === "POST" && r.path.endsWith("/agent"))
          .map((r) => r.body),
        [{ agent: "plan" }, { agent: "build" }],
      );
    }),
  );
  it.effect("uses session-scoped approval grants and distinguishes decline from cancellation", () =>
    Effect.gen(function* () {
      const f = yield* make;
      yield* f.adapter.sendTurn({ threadId, input: "hello" });
      const ask: V2Event = {
        ...eventBase,
        type: "permission.asked",
        data: {
          id: "permission1",
          sessionID: "ses_1",
          action: "shell",
          resources: ["git status"],
          save: ["git *"],
          metadata: {},
        },
      };
      f.emit(ask);
      yield* f.next("request.opened");
      yield* f.adapter.respondToRequest(
        threadId,
        ApprovalRequestId.make("permission1"),
        "acceptForSession",
      );
      assert.deepStrictEqual(f.requests.at(-1)?.body, { decision: "once" });
      assert.deepInclude(f.sessions.get("ses_1"), {
        permissions: [
          { action: "*", resource: "*", effect: "allow" },
          { action: "shell", resource: "git *", effect: "allow" },
        ],
      });
      yield* f.adapter.respondToRequest(threadId, ApprovalRequestId.make("permission1"), "decline");
      assert.deepStrictEqual(f.requests.at(-1)?.body, {
        decision: "reject",
        message: "The user declined this action. Continue without it.",
      });
    }),
  );
  it.effect("maps choice values and refuses unsupported forms without fabricating answers", () =>
    Effect.gen(function* () {
      const f = yield* make;
      yield* f.adapter.sendTurn({ threadId, input: "hello" });
      f.emit({ ...eventBase, type: "form.created", data: { form } });
      const question = yield* f.next("user-input.requested");
      if (question.type === "user-input.requested")
        assert.isFalse(question.payload.questions[0]?.isOther);
      yield* f.adapter.respondToUserInput(threadId, ApprovalRequestId.make(form.id), {
        choice: "One",
      });
      assert.deepStrictEqual(f.requests.at(-1)?.body, { answer: { choice: "one" } });
      assert.isTrue(
        Exit.isFailure(
          yield* Effect.exit(
            f.adapter.respondToUserInput(threadId, ApprovalRequestId.make(form.id), {
              choice: "invented",
            }),
          ),
        ),
      );
      assert.isFalse(
        supportedOpenCode2Form({ ...form, fields: [{ key: "number", type: "number" }] }),
      );
    }),
  );
  it.effect("interrupts owned background children along with the parent", () =>
    Effect.gen(function* () {
      const f = yield* make;
      yield* f.adapter.sendTurn({ threadId, input: "hello" });
      f.emit({
        ...eventBase,
        type: "session.created",
        data: {
          sessionID: "child",
          parentID: "ses_1",
          projectID: "global",
          slug: "child",
          version: "2.0.18",
          location: { directory: "/tmp" },
          permissions: [],
        },
      });
      yield* f.next("task.started");
      yield* f.adapter.interruptTurn(threadId);
      assert.deepStrictEqual(
        f.requests.filter((r) => r.path.endsWith("/interrupt")).map((r) => r.path),
        ["/api/session/child/interrupt", "/api/session/ses_1/interrupt"],
      );
      yield* f.adapter.stopSession(threadId);
      assert.strictEqual(f.leases(), 0);
    }),
  );
  it.effect(
    "forks busy native commands only at a saved boundary and ignores automatic compaction in rollback",
    () =>
      Effect.gen(function* () {
        const f = yield* make;
        const history = f.messages.get("ses_1")!;
        history.push({ id: "first", type: "user", text: "first", time: { created: 1 } });
        yield* f.adapter.sendTurn({ threadId, input: "/review" });
        assert.isTrue(
          Exit.isFailure(
            yield* Effect.exit(
              f.adapter.startSession({
                ...start,
                threadId: ThreadId.make("too-early"),
                forkFromThreadId: threadId,
              }),
            ),
          ),
        );
        history.push({ id: "native-command", type: "user", text: "review", time: { created: 2 } });
        yield* f.adapter.startSession({
          ...start,
          threadId: ThreadId.make("side"),
          forkFromThreadId: threadId,
        });
        assert.deepStrictEqual(f.requests.find((r) => r.path.endsWith("/fork"))?.body, {
          before: "native-command",
        });
        yield* f.adapter.stopSession(ThreadId.make("side"));
        f.emit(f.terminal("ses_1"));
        yield* f.next("turn.completed");
        history.push({
          id: "auto-compact",
          type: "compaction",
          status: "completed",
          reason: "auto",
          summary: "summary",
          recent: "",
          time: { created: 3 },
        });
        const snapshot = yield* f.adapter.readThread(threadId);
        assert.deepStrictEqual(
          snapshot.turns.map((turn) => turn.id),
          ["first", "native-command"],
        );
        yield* f.adapter.rollbackThread(threadId, 1);
        assert.deepStrictEqual(f.requests.find((r) => r.path.endsWith("/revert/stage"))?.body, {
          messageID: "native-command",
          files: false,
        });
      }),
  );
  it.effect("resumes a stopped native session strictly and reads cursor pages without order", () =>
    Effect.gen(function* () {
      const f = yield* make;
      const cursor = (yield* f.adapter.listSessions())[0]!.resumeCursor;
      yield* f.adapter.stopSession(threadId);
      yield* f.adapter.startSession({ ...start, resumeCursor: cursor, requireResume: true });
      assert.strictEqual(f.sessions.size, 1);
      const queries: Array<string> = [];
      f.behavior.onRequest = (url) => {
        if (!url.pathname.endsWith("/message")) return;
        queries.push(url.search);
        if (url.searchParams.has("cursor")) {
          assert.isFalse(url.searchParams.has("order"));
          return Response.json({
            data: [{ id: "second", type: "user", text: "two", time: { created: 2 } }],
            cursor: { next: null, prev: null },
          });
        }
        return Response.json({
          data: [{ id: "first", type: "user", text: "one", time: { created: 1 } }],
          cursor: { next: "page2", prev: null },
        });
      };
      const history = yield* f.adapter.readThread(threadId);
      assert.deepStrictEqual(
        history.turns.map((turn) => turn.id),
        ["first", "second"],
      );
      assert.strictEqual(queries.length, 2);
      yield* f.adapter.stopSession(threadId);
      f.sessions.clear();
      assert.isTrue(
        Exit.isFailure(
          yield* Effect.exit(
            f.adapter.startSession({ ...start, resumeCursor: cursor, requireResume: true }),
          ),
        ),
      );
      assert.strictEqual(f.sessions.size, 0);
    }),
  );
  it.effect("rejects OpenCode 1 cursors and models belonging to another instance", () =>
    Effect.gen(function* () {
      const f = yield* make;
      assert.isTrue(
        Exit.isFailure(
          yield* Effect.exit(
            f.adapter.startSession({
              ...start,
              threadId: ThreadId.make("legacy"),
              resumeCursor: { sessionId: "legacy" },
              requireResume: true,
            }),
          ),
        ),
      );
      assert.isTrue(
        Exit.isFailure(
          yield* Effect.exit(
            f.adapter.sendTurn({
              threadId,
              input: "bad",
              modelSelection: { ...modelSelection, instanceId: ProviderInstanceId.make("other") },
            }),
          ),
        ),
      );
      assert.strictEqual(f.leases(), 1);
      assert.strictEqual(requireOpenCode2Version("1.14.19"), undefined);
      assert.strictEqual(requireOpenCode2Version("opencode v2.0.18"), "2.0.18");
      assert.strictEqual(requireOpenCode2Version("3.0.0"), undefined);
    }),
  );
});
