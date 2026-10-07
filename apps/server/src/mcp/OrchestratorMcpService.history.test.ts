import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  EnvironmentId,
  EventId,
  MessageId,
  ProviderInstanceId,
  ProviderThreadId,
  RunId,
  TurnItemId,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { V2SqlitePersistenceMemory } from "../persistence/Layers/V2Sqlite.ts";
import * as ContextHandoffService from "../orchestration-v2/ContextHandoffService.ts";
import * as IdAllocator from "../orchestration-v2/IdAllocator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import { v2Now, v2Projection } from "../orchestration-v2/testkit/fixtures.ts";
import * as ProviderRegistry from "../provider/Services/ProviderRegistry.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import type { McpInvocationScope } from "./McpInvocationContext.ts";
import * as OrchestratorMcpService from "./OrchestratorMcpService.ts";

it.effect("retrieves whole omitted handoff items through paged MCP history", () =>
  Effect.gen(function* () {
    const store = yield* ProjectionStore.ProjectionStoreV2;
    const handoffs = yield* ContextHandoffService.ContextHandoffServiceV2;
    const threadId = v2Projection.thread.id;
    yield* store.apply({
      id: EventId.make("history:create"),
      threadId,
      type: "thread.created",
      occurredAt: v2Now,
      payload: v2Projection.thread,
    });
    const longText = `Original constraint: ${"界🧪\n".repeat(10_000)} END_OF_ORIGINAL_REQUEST`;
    const items: Array<OrchestrationV2TurnItem> = Array.from({ length: 43 }, (_, index) => ({
      id: TurnItemId.make(`history:item:${index}`),
      threadId,
      runId: null,
      nodeId: null,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: index + 1,
      status: "completed",
      title: null,
      startedAt: v2Now,
      completedAt: v2Now,
      updatedAt: v2Now,
      messageId: MessageId.make(`history:message:${index}`),
      type: "user_message",
      createdBy: "user",
      creationSource: "web",
      inputIntent: "turn_start",
      attachments: [],
      text: index === 17 ? longText : `Saved request ${index}`,
    }));
    for (const item of items) {
      yield* store.apply({
        id: EventId.make(`event:${item.id}`),
        threadId,
        type: "turn-item.updated",
        occurredAt: v2Now,
        payload: item,
      });
    }
    const handoff = yield* handoffs.prepareProviderHandoff({
      threadId,
      targetRunId: RunId.make("history:target-run"),
      transferId: null,
      fromProviderThreadIds: [ProviderThreadId.make("history:codex")],
      toProviderThreadId: ProviderThreadId.make("history:claude"),
      fromProviderInstanceId: ProviderInstanceId.make("codex"),
      toProviderInstanceId: ProviderInstanceId.make("claudeAgent"),
      coveredRunOrdinals: { from: 1, to: 43 },
      strategy: "full_thread_summary",
      items: yield* store.getTurnStartHistory(threadId),
      createdAt: v2Now,
    });
    assert.include(handoff.history?.omittedItemIds ?? [], items[17]!.id);
    assert.notInclude(
      handoff.history!.messages.map((item) => item.itemId),
      items[17]!.id,
    );
    assert.include(handoff.history!.coverage, "t3_thread_read");
    assert.include(handoff.history!.coverage, threadId);

    const scope: McpInvocationScope = {
      environmentId: EnvironmentId.make("history:environment"),
      threadId,
      providerSessionId: "history:target-session",
      providerInstanceId: ProviderInstanceId.make("claudeAgent"),
      capabilities: new Set(["orchestration"]),
      issuedAt: 1,
    };
    const dependencies = Layer.mergeAll(
      NodeServices.layer,
      Layer.mock(ThreadManagementService.ThreadManagementService)({
        getThreadRecords: (id, fields, filter) =>
          store.getThreadRecords(id, fields, filter).pipe(Effect.orDie),
        getTimelinePage: (id, options) => store.getTimelinePage(id, options).pipe(Effect.orDie),
      }),
      Layer.mock(ProviderRegistry.ProviderRegistry)({ getProviders: Effect.succeed([]) }),
      Layer.mock(ProviderAdapterRegistry.ProviderAdapterRegistryV2)({}),
      Layer.mock(ScheduledTaskService.ScheduledTaskService)({}),
    );
    yield* Effect.gen(function* () {
      const service = yield* OrchestratorMcpService.OrchestratorMcpService;
      const seen: Array<TurnItemId> = [];
      let afterPosition = -1;
      for (;;) {
        const page = yield* service.readThread(scope, {
          threadId,
          view: "activity",
          afterPosition,
          limit: 7,
          maxCharsPerItem: 1_003,
        });
        seen.push(...page.items.map((item) => item.itemId));
        if (!page.hasMore) break;
        assert.isAbove(page.nextPosition!, afterPosition);
        afterPosition = page.nextPosition!;
      }
      assert.deepEqual(
        seen,
        items.map((item) => item.id),
      );
      let recovered = "";
      let textOffset = 0;
      for (;;) {
        const page = yield* service.readThread(scope, {
          threadId,
          view: "activity",
          itemId: items[17]!.id,
          textOffset,
          maxCharsPerItem: 1_003,
        });
        assert.lengthOf(page.items, 1);
        const item = page.items[0]!;
        assert.equal(item.itemId, items[17]!.id);
        recovered += item.text;
        if (item.nextTextOffset == null) {
          assert.isFalse(item.textTruncated);
          break;
        }
        assert.isTrue(item.textTruncated);
        assert.isAbove(item.nextTextOffset, textOffset);
        textOffset = item.nextTextOffset;
      }
      assert.equal(recovered, longText);
    }).pipe(
      Effect.provide(
        OrchestratorMcpService.layer
          .pipe(Layer.provide(Layer.mock(SecretRequests.SecretRequests)({})))
          .pipe(Layer.provide(dependencies)),
      ),
    );
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        ProjectionStore.layer.pipe(Layer.provide(V2SqlitePersistenceMemory)),
        ContextHandoffService.layer.pipe(Layer.provide(IdAllocator.layer)),
      ),
    ),
  ),
);
