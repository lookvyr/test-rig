import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";

import * as CodexClient from "./client.ts";
import type { CodexAppServerProtocolLogEvent } from "./protocol.ts";
import { makeInMemoryStdio } from "./_internal/stdio.ts";

const makeNotificationHarness = Effect.fn("makeNotificationHarness")(function* () {
  const { stdio, input } = yield* makeInMemoryStdio();
  const received = yield* Ref.make<
    Array<CodexClient.CodexAppServerNotificationPayload<"turn/completed">>
  >([]);
  const logs = yield* Ref.make<Array<CodexAppServerProtocolLogEvent>>([]);
  const processed = yield* Queue.unbounded<void>();
  const client = yield* CodexClient.make(stdio, {
    logIncoming: true,
    logger: (event) => Ref.update(logs, (current) => [...current, event]),
  });
  yield* client.handleServerNotification("turn/completed", (payload) =>
    Ref.update(received, (current) => [...current, payload]),
  );
  yield* client.handleUnknownServerNotification((method) =>
    method === "test/barrier" ? Queue.offer(processed, undefined).pipe(Effect.asVoid) : Effect.void,
  );
  const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
  const send = Effect.fn("sendNotification")(function* (
    params: unknown,
    method = "turn/completed",
  ) {
    const notification = yield* encodeJson({ method, params });
    const barrier = yield* encodeJson({ method: "test/barrier" });
    yield* Queue.offer(input, new TextEncoder().encode(`${notification}\n${barrier}\n`));
    yield* Queue.take(processed);
  });
  return { received, logs, send };
});

const mockPeerPath = Effect.map(Effect.service(Path.Path), (path) =>
  path.join(import.meta.dirname, "../test/fixtures/codex-app-server-mock-peer.ts"),
);
const mockPeerArgs = (path: string) => [path];

it.layer(NodeServices.layer)("effect-codex-app-server client", (it) => {
  const makeHandle = (env?: Record<string, string>) =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const path = yield* Path.Path;
      const peerCwd = path.join(import.meta.dirname, "..");
      const command = ChildProcess.make(process.execPath, mockPeerArgs(yield* mockPeerPath), {
        cwd: peerCwd,
        ...(env ? { env: { ...process.env, ...env } } : {}),
      });
      return yield* spawner.spawn(command);
    });

  it.effect.each(["completed", "failed", "interrupted"] as const)(
    "delivers %s lifecycle state despite an unfamiliar completion item",
    (status) =>
      Effect.gen(function* () {
        const harness = yield* makeNotificationHarness();
        const payload = {
          threadId: "thread-1",
          turn: {
            id: "turn-1",
            status,
            completedAt: 1782622442,
            error: status === "failed" ? { message: "Provider failed." } : null,
            items: [
              { type: "futureToolItem", id: "future-item", content: { version: 2 } },
              { type: "agentMessage", id: "answer", text: "Done", phase: "final_answer" },
            ],
          },
        };
        yield* harness.send(payload);
        assert.deepEqual(yield* Ref.get(harness.received), [payload]);
        assert.deepEqual(
          (yield* Ref.get(harness.logs)).filter((event) => event.stage === "decode_failed"),
          [],
        );
      }),
  );

  it.effect("rejects invalid lifecycle fields, logs diagnostics and continues reading", () =>
    Effect.gen(function* () {
      const harness = yield* makeNotificationHarness();
      const turn = { id: "turn-1", status: "completed" as const, items: [] };
      for (const payload of [
        { threadId: 1, turn },
        { threadId: "thread-1", turn: { ...turn, id: null } },
        { threadId: "thread-1", turn: { ...turn, status: "future-status" } },
        { threadId: "thread-1", turn: { ...turn, error: { message: 42 } } },
      ]) {
        yield* harness.send(payload);
      }
      assert.deepEqual(yield* Ref.get(harness.received), []);
      const failures = (yield* Ref.get(harness.logs)).filter(
        (event) => event.stage === "decode_failed",
      );
      assert.equal(failures.length, 4);
      for (const failure of failures) {
        assert.equal(failure.direction, "incoming");
        assert.include(failure.payload, {
          method: "turn/completed",
          operation: "decode-notification-payload",
        });
        assert.notProperty(failure.payload, "params");
        assert.notProperty(failure.payload, "cause");
      }
      const valid = { threadId: "thread-1", turn };
      yield* harness.send(valid);
      assert.deepEqual(yield* Ref.get(harness.received), [valid]);
    }),
  );

  it.effect("logs typed payload failures for other notifications", () =>
    Effect.gen(function* () {
      const harness = yield* makeNotificationHarness();
      yield* harness.send(
        { threadId: "thread-1", turnId: "turn-1", itemId: "item", delta: 42 },
        "item/agentMessage/delta",
      );
      const failures = (yield* Ref.get(harness.logs)).filter(
        (event) => event.stage === "decode_failed",
      );
      assert.equal(failures.length, 1);
      assert.include(failures[0]!.payload, { method: "item/agentMessage/delta" });
    }),
  );

  it.effect("initializes, handles typed server requests, and reads account and skills data", () =>
    Effect.gen(function* () {
      const userInputRequests = yield* Ref.make<Array<unknown>>([]);
      const messageDeltas = yield* Ref.make<Array<unknown>>([]);
      const handle = yield* makeHandle();
      const scope = yield* Scope.make();
      const clientLayer = CodexClient.layerChildProcess(handle);
      const context = yield* Layer.buildWithScope(clientLayer, scope);

      const result = yield* Effect.gen(function* () {
        const client = yield* CodexClient.CodexAppServerClient;

        yield* client.handleServerRequest("item/tool/requestUserInput", (payload) =>
          Ref.update(userInputRequests, (current) => [...current, payload]).pipe(
            Effect.as({
              answers: {
                approved: {
                  answers: ["yes"],
                },
              },
            }),
          ),
        );

        yield* client.handleServerNotification("item/agentMessage/delta", (payload) =>
          Ref.update(messageDeltas, (current) => [...current, payload]),
        );

        const initialized = yield* client.request("initialize", {
          clientInfo: {
            name: "effect-codex-app-server-test",
            title: "Effect Codex App Server Test",
            version: "0.0.0",
          },
          capabilities: {
            experimentalApi: true,
            optOutNotificationMethods: null,
          },
        });
        assert.equal(initialized.userAgent, "mock-codex-app-server");

        yield* client.notify("initialized", undefined);

        const account = yield* client.request("account/read", {});
        assert.equal(account.requiresOpenaiAuth, false);
        assert.deepEqual(account.account, {
          type: "chatgpt",
          email: "mock@example.com",
          planType: "plus",
        });

        const path = yield* Path.Path;
        const peerCwd = path.join(import.meta.dirname, "..");
        const skills = yield* client.request("skills/list", { cwds: [peerCwd] });
        assert.equal(skills.data.length, 1);
        assert.equal(skills.data[0]?.cwd, peerCwd);

        return {
          account,
          skills,
        };
      }).pipe(Effect.provide(context), Effect.ensuring(Scope.close(scope, Exit.void)));

      assert.equal(result.skills.data[0]?.skills.length, 0);
      assert.deepEqual(yield* Ref.get(userInputRequests), [
        {
          isBlocking: true,
          itemId: "item-approval-1",
          threadId: "thread-1",
          turnId: "turn-1",
          questions: [
            {
              id: "approved",
              header: "Approve",
              question: "Continue with the mock skills request?",
              options: [
                {
                  label: "yes",
                  description: "Approve the request",
                },
              ],
            },
          ],
        },
      ]);
      assert.deepEqual(yield* Ref.get(messageDeltas), [
        {
          delta: "Mock server is ready.",
          itemId: "item-1",
          threadId: "thread-1",
          turnId: "turn-1",
        },
      ]);
    }),
  );
  it.effect("drains child stderr so large diagnostics cannot block protocol responses", () =>
    Effect.gen(function* () {
      const handle = yield* makeHandle({
        CODEX_APP_SERVER_TEST_STDERR_BYTES: String(512 * 1024),
      });
      const scope = yield* Scope.make();
      const clientLayer = CodexClient.layerChildProcess(handle);
      const context = yield* Layer.buildWithScope(clientLayer, scope);

      const initialized = yield* Effect.gen(function* () {
        const client = yield* CodexClient.CodexAppServerClient;
        return yield* client.request("initialize", {
          clientInfo: {
            name: "effect-codex-app-server-test",
            title: "Effect Codex App Server Test",
            version: "0.0.0",
          },
          capabilities: {
            experimentalApi: true,
            optOutNotificationMethods: null,
          },
        });
      }).pipe(
        Effect.timeout("5 seconds"),
        Effect.provide(context),
        Effect.ensuring(Scope.close(scope, Exit.void)),
      );

      assert.equal(initialized.userAgent, "mock-codex-app-server");
    }),
  );
});
