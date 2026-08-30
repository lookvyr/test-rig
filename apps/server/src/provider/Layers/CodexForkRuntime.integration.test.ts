// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { assert, describe } from "vite-plus/test";

import wireFixture from "../testFixtures/codexMultiAgentWire.json" with { type: "json" };
import { makeCodexSessionRuntime } from "./CodexSessionRuntime.ts";

describe("Codex native fork runtime", () => {
  it.live(
    "preserves native identity and strict resume while side instructions change on Keep",
    () =>
      Effect.gen(function* () {
        const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "codex-fork-runtime-"));
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => NodeFS.rmSync(tempDir, { recursive: true, force: true })),
        );
        const scriptPath = NodePath.join(tempDir, "script.json");
        // The thread/started notification during each send exercises cursor updates
        // after initialization, where a strict marker must not be discarded.
        NodeFS.writeFileSync(
          scriptPath,
          // @effect-diagnostics-next-line preferSchemaOverJson:off
          JSON.stringify({
            rootThreadId: wireFixture.rootThreadId,
            recordRequests: true,
            notifications: [
              {
                method: "thread/started",
                params: { thread: wireFixture.responses.threadStart.thread },
              },
            ],
          }),
        );
        const options = {
          threadId: ThreadId.make("side-runtime"),
          binaryPath: NodePath.join(import.meta.dirname, "../testFixtures/codexCollabMockPeer.sh"),
          cwd: tempDir,
          runtimeMode: "auto-accept-edits" as const,
          environment: { ...process.env, T3_CODEX_COLLAB_SCRIPT: scriptPath },
        };
        const sideScope = yield* Scope.fork(yield* Scope.Scope);
        const side = yield* makeCodexSessionRuntime({
          ...options,
          forkThreadId: "parent-native",
        }).pipe(Effect.provideService(Scope.Scope, sideScope));
        const started = yield* side.start();
        const cursor = { threadId: wireFixture.rootThreadId, strictResume: true as const };
        assert.deepEqual(started.resumeCursor, cursor);

        const sideEvents = yield* side.events.pipe(
          Stream.takeUntil((event) => event.method === "turn/completed"),
          Stream.runCollect,
          Effect.forkScoped,
        );
        const turn = yield* side.sendTurn({ input: "Explore an alternative", sideChat: true });
        yield* Fiber.join(sideEvents);
        assert.deepEqual(turn.resumeCursor, cursor);
        assert.deepEqual((yield* side.getSession).resumeCursor, cursor);
        yield* side.close;

        // Promotion only changes presentation. A reaped/restarted kept thread
        // resumes the same native child and sends normal instructions next turn.
        const keptScope = yield* Scope.fork(yield* Scope.Scope);
        const kept = yield* makeCodexSessionRuntime({ ...options, resumeCursor: cursor }).pipe(
          Effect.provideService(Scope.Scope, keptScope),
        );
        assert.deepEqual((yield* kept.start()).resumeCursor, cursor);
        const keptEvents = yield* kept.events.pipe(
          Stream.takeUntil((event) => event.method === "turn/completed"),
          Stream.runCollect,
          Effect.forkScoped,
        );
        assert.deepEqual((yield* kept.sendTurn({ input: "Continue here" })).resumeCursor, cursor);
        yield* Fiber.join(keptEvents);
        assert.deepEqual((yield* kept.getSession).resumeCursor, cursor);
        yield* kept.close;

        const requestSchema = Schema.Struct({
          method: Schema.String,
          params: Schema.Record(Schema.String, Schema.Unknown),
        });
        const requests = NodeFS.readFileSync(`${scriptPath}.requests`, "utf8")
          .trim()
          .split("\n")
          .map((line) => Schema.decodeSync(Schema.fromJsonString(requestSchema))(line));
        assert.deepEqual(
          requests
            .filter((request) => request.method.startsWith("thread/"))
            .map((request) => request.method),
          ["thread/fork", "thread/resume"],
        );
        const fork = requests.find((request) => request.method === "thread/fork")!;
        assert.equal(fork.params.threadId, "parent-native");
        assert.equal(fork.params.cwd, tempDir);
        assert.equal(fork.params.approvalPolicy, "on-request");
        assert.equal(fork.params.sandbox, "workspace-write");
        assert.notProperty(fork.params, "deferGoalContinuation");
        const sends = requests.filter((request) => request.method === "turn/start");
        assert.lengthOf(sends, 2, "opening and resuming do not start turns");
        const turnInstructions = Schema.decodeUnknownEffect(
          Schema.Struct({
            collaborationMode: Schema.Struct({
              settings: Schema.Struct({ developer_instructions: Schema.String }),
            }),
          }),
        );
        const sideInstructions = (yield* turnInstructions(sends[0]!.params)).collaborationMode
          .settings.developer_instructions;
        const keptInstructions = (yield* turnInstructions(sends[1]!.params)).collaborationMode
          .settings.developer_instructions;
        assert.include(sideInstructions, "<side_chat>");
        assert.notInclude(keptInstructions, "<side_chat>");
        assert.include(keptInstructions, "Collaboration Mode: Default");
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
