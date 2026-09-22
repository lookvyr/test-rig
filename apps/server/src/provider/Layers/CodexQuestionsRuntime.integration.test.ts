// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import * as Schema from "effect/Schema";
import { assert, describe } from "vite-plus/test";
import wire from "../testFixtures/codexMultiAgentWire.json" with { type: "json" };
import { makeCodexSessionRuntime } from "./CodexSessionRuntime.ts";

const peer = NodePath.join(import.meta.dirname, "../testFixtures/codexCollabMockPeer.sh");
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

describe("Codex question runtime", () => {
  for (const mode of ["answered", "cancelled", "timeout"] as const) {
    it.effect(`resolves ${mode} questions using the actual JSON-RPC request identity`, () =>
      Effect.gen(function* () {
        const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "codex-questions-"));
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => NodeFS.rmSync(directory, { recursive: true, force: true })),
        );
        const scriptPath = NodePath.join(directory, "script.json");
        const params = {
          threadId: wire.rootThreadId,
          turnId: wire.responses.turnStart.turn.id,
          itemId: "item-not-the-rpc-id",
          questions: [{ id: "name", header: "Name", question: "What name?", options: null }],
          ...(mode === "timeout" ? { autoResolutionMs: 0 } : {}),
        };
        const notifications = [
          { id: 7701, method: "item/tool/requestUserInput", params },
          ...(mode === "cancelled"
            ? [
                {
                  method: "serverRequest/resolved",
                  params: { threadId: wire.rootThreadId, requestId: 7701 },
                },
              ]
            : []),
        ];
        NodeFS.writeFileSync(
          scriptPath,
          yield* encodeJson({
            rootThreadId: wire.rootThreadId,
            notifications,
            holdTurnOpen: true,
          }),
        );
        const runtime = yield* makeCodexSessionRuntime({
          threadId: ThreadId.make("question-test"),
          binaryPath: peer,
          cwd: directory,
          runtimeMode: "full-access",
          environment: { ...process.env, T3_CODEX_COLLAB_SCRIPT: scriptPath },
        });
        const collected = yield* runtime.events.pipe(
          Stream.tap((event) =>
            event.method === "item/tool/requestUserInput" && mode === "answered" && event.requestId
              ? runtime.respondToUserInput(event.requestId, { name: "Test project" })
              : Effect.void,
          ),
          Stream.takeUntil((event) => event.method === `item/tool/requestUserInput/${mode}`),
          Stream.runCollect,
          Effect.forkScoped,
        );
        yield* runtime.start();
        yield* runtime.sendTurn({ input: "Ask a question" });
        const events = Array.from(yield* Fiber.join(collected));
        const requested = events.find((event) => event.method === "item/tool/requestUserInput");
        const resolved = events.at(-1);
        assert.isDefined(requested?.requestId);
        assert.equal(resolved?.requestId, requested?.requestId);
        assert.equal(resolved?.itemId, "item-not-the-rpc-id");
        if (requested?.requestId) {
          const error = yield* runtime
            .respondToUserInput(requested.requestId, { name: "late" })
            .pipe(Effect.flip);
          assert.equal(error._tag, "CodexSessionRuntimePendingUserInputNotFoundError");
        }
      }).pipe(Effect.provide(NodeServices.layer)),
    );
  }
});
