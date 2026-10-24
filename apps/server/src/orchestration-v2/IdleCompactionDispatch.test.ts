import { assert, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { ClaudeProviderCapabilitiesV2 } from "./Adapters/ClaudeAdapterV2.ts";
import * as Orchestrator from "./Orchestrator.ts";
import type { ProviderAdapterV2Shape } from "./ProviderAdapter.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import { makeOrchestratorV2ReplayLayerWithRegistry } from "./testkit/ProviderReplayHarness.ts";

const instanceId = ProviderInstanceId.make("claudeAgent");
const adapter: ProviderAdapterV2Shape = {
  instanceId,
  driver: ProviderDriverKind.make("claudeAgent"),
  getCapabilities: () => Effect.succeed(ClaudeProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" }),
  openSession: () => Effect.die("This test only persists dispatch metadata"),
};

it.effect.each(["beforeCacheExpires", "onReturn"] as const)(
  "persists %s on both the conversation message and user turn item",
  (idleCompaction) =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const threadId = ThreadId.make(`compact-${idleCompaction}`);
      yield* orchestrator.dispatch({
        type: "thread.create",
        commandId: CommandId.make("create"),
        threadId,
        projectId: ProjectId.make("compact-project"),
        title: "Compaction",
        modelSelection: { instanceId, model: "test-model" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdBy: "user",
        creationSource: "web",
      });
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make("compact"),
        threadId,
        messageId: MessageId.make("compact-message"),
        text: "/compact",
        attachments: [],
        idleCompaction,
        dispatchMode: { type: "start_immediately" },
        createdBy: "agent",
        creationSource: "server",
      });
      const projection = yield* orchestrator.getThreadProjection(threadId);
      assert.equal(projection.messages[0]?.idleCompaction, idleCompaction);
      assert.equal(
        projection.turnItems.find((item) => item.type === "user_message")?.idleCompaction,
        idleCompaction,
      );
    }).pipe(
      Effect.provide(
        makeOrchestratorV2ReplayLayerWithRegistry(
          { name: `compaction-metadata-${idleCompaction}` },
          ProviderAdapterRegistry.makeLayer([adapter]),
          { runEffectWorker: false },
        ),
      ),
    ),
);
