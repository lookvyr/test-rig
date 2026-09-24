import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Logger from "effect/Logger";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";

import * as CodexClient from "./client.ts";
import { makeInMemoryStdio } from "./_internal/stdio.ts";

const mockPeerPath = Effect.map(Effect.service(Path.Path), (path) =>
  path.join(import.meta.dirname, "../test/fixtures/codex-app-server-mock-peer.ts"),
);
const mockPeerArgs = (path: string) => [path];
const decodeRequestId = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Struct({ id: Schema.Number })),
);
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

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

  it.effect("initializes, handles typed server requests, and reads account and skills data", () =>
    Effect.gen(function* () {
      const userInputRequests = yield* Ref.make<Array<unknown>>([]);
      const requestIds = yield* Ref.make<Array<string | number>>([]);
      const messageDeltas = yield* Ref.make<Array<unknown>>([]);
      const handle = yield* makeHandle();
      const scope = yield* Scope.make();
      const clientLayer = CodexClient.layerChildProcess(handle);
      const context = yield* Layer.buildWithScope(clientLayer, scope);

      const result = yield* Effect.gen(function* () {
        const client = yield* CodexClient.CodexAppServerClient;

        yield* client.handleServerRequest("item/tool/requestUserInput", (payload, context) =>
          Ref.update(userInputRequests, (current) => [...current, payload]).pipe(
            Effect.andThen(Ref.update(requestIds, (current) => [...current, context.requestId])),
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
      assert.deepEqual(yield* Ref.get(requestIds), [10000]);
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
  it.effect("logs incompatible notifications and continues delivering valid events", () => {
    const messages: Array<unknown> = [];
    const logger = Logger.make<unknown, void>(({ message }) => {
      messages.push(...(Array.isArray(message) ? message : [message]));
    });
    return Effect.gen(function* () {
      const { stdio, input, output } = yield* makeInMemoryStdio();
      const client = yield* CodexClient.make(stdio);
      const received = yield* Deferred.make<string>();
      yield* client.handleServerNotification("item/agentMessage/delta", (payload) =>
        Deferred.succeed(received, payload.delta).pipe(Effect.asVoid),
      );

      const initialize = yield* client
        .request("initialize", { clientInfo: { name: "compatibility-test", version: "1" } })
        .pipe(Effect.forkScoped);
      const request = yield* decodeRequestId(yield* Queue.take(output));
      const encode = (value: unknown) => new TextEncoder().encode(`${encodeJson(value)}\n`);
      yield* Queue.offer(
        input,
        encode({
          id: request.id,
          result: {
            userAgent: "codex/0.156.1",
            codexHome: "/tmp/codex-test",
            platformFamily: "unix",
            platformOs: "macos",
          },
        }),
      );
      yield* Fiber.join(initialize);

      yield* Queue.offer(
        input,
        encode({
          method: "item/agentMessage/delta",
          params: { delta: { privateContent: "do-not-log-this" } },
        }),
      );
      yield* Queue.offer(
        input,
        encode({
          method: "item/agentMessage/delta",
          params: { delta: "Still working", itemId: "i", threadId: "t", turnId: "turn" },
        }),
      );
      assert.equal(yield* Deferred.await(received), "Still working");
      assert.include(messages, "Codex app-server payload could not be decoded.");
      const logged = encodeJson(messages);
      assert.include(logged, '"method":"item/agentMessage/delta"');
      assert.include(logged, '"serverUserAgent":"codex/0.156.1"');
      assert.notInclude(logged, "do-not-log-this");
    }).pipe(Effect.provide(Logger.layer([logger], { mergeWithExisting: false })));
  });
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
