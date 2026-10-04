import { assert, it } from "@effect/vitest";
import {
  EventId,
  MessageId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2Run,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { V2SqlitePersistenceMemory } from "../persistence/Layers/V2Sqlite.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import { ThreadManagementService } from "./ThreadManagementService.ts";
import { makeThreadFind } from "./ThreadFind.ts";
import { buildBoundedThreadProjection } from "./threadHistoryPaging.ts";
import { v2Now, v2Projection, v2ThreadId } from "./testkit/fixtures.ts";

it.effect(
  "Find reaches unloaded and inherited history through bounded message pages and anchored context",
  () =>
    Effect.gen(function* () {
      const store = yield* ProjectionStore.ProjectionStoreV2;
      const runId = RunId.make("source-run");
      const run: OrchestrationV2Run = {
        id: runId,
        threadId: v2ThreadId,
        ordinal: 1,
        providerInstanceId: v2Projection.thread.providerInstanceId,
        modelSelection: v2Projection.thread.modelSelection,
        providerThreadId: null,
        userMessageId: MessageId.make("initial"),
        rootNodeId: null,
        activeAttemptId: null,
        status: "completed",
        queuePosition: null,
        requestedAt: v2Now,
        startedAt: v2Now,
        completedAt: v2Now,
        checkpointId: null,
        contextHandoffId: null,
      };
      yield* store.apply({
        id: EventId.make("source"),
        threadId: v2ThreadId,
        type: "thread.created",
        occurredAt: v2Now,
        payload: v2Projection.thread,
      });
      yield* store.apply({
        id: EventId.make("run"),
        threadId: v2ThreadId,
        type: "run.created",
        occurredAt: v2Now,
        payload: run,
      });
      for (let index = 0; index < 155; index++) {
        yield* store.apply({
          id: EventId.make(`item-${index}`),
          threadId: v2ThreadId,
          type: "turn-item.updated",
          occurredAt: v2Now,
          payload: {
            id: TurnItemId.make(`item-${index}`),
            threadId: v2ThreadId,
            runId,
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
            type: "user_message",
            messageId: MessageId.make(`message-${index}`),
            text: index === 0 ? "needle in old history" : `Message ${index}`,
            attachments: [],
            createdBy: "user",
            creationSource: "web",
            inputIntent: "turn_start",
          },
        });
      }
      const recent = buildBoundedThreadProjection(
        yield* store.getThreadSnapshotWindow(v2ThreadId, { rowLimit: 77, userTurnLimit: 10 }),
      );
      assert.isTrue(recent.hasMoreHistory);
      assert.isFalse(
        recent.projection.visibleTurnItems.some((row) => row.sourceItemId === "item-0"),
      );
      const find = yield* makeThreadFind.pipe(
        Effect.provide(
          Layer.mock(ThreadManagementService)({
            ensureLegacyTranscript: () => Effect.void,
            getTimelinePage: (id, options) => store.getTimelinePage(id, options).pipe(Effect.orDie),
            getThreadSnapshotWindow: (id, options) =>
              store.getThreadSnapshotWindow(id, options).pipe(Effect.orDie),
            getThreadProjection: () => Effect.die("Find must not load the full projection"),
          }),
        ),
      );
      const first = yield* find.search({ threadId: v2ThreadId, query: "needle" });
      assert.equal(first.messages[0]?.sourceItemId, "item-0");
      assert.isTrue(first.truncated);
      assert.isNotNull(first.nextCursor);
      const second = yield* find.search({
        threadId: v2ThreadId,
        query: "Message 154",
        cursor: first.nextCursor!,
      });
      assert.equal(second.messages[0]?.sourceItemId, "item-154");
      assert.isFalse(second.truncated);
      const childId = ThreadId.make("fork");
      yield* store.apply({
        id: EventId.make("fork"),
        threadId: childId,
        type: "thread.created",
        occurredAt: v2Now,
        payload: {
          ...v2Projection.thread,
          id: childId,
          lineage: {
            rootThreadId: v2ThreadId,
            parentThreadId: v2ThreadId,
            relationshipToParent: "fork",
          },
          forkedFrom: { type: "run", threadId: v2ThreadId, runId },
        },
      });
      const inherited = yield* find.search({ threadId: childId, query: "needle" });
      assert.equal(inherited.messages[0]?.sourceThreadId, v2ThreadId);
      const context = yield* find.getContext({
        threadId: childId,
        sourceThreadId: v2ThreadId,
        sourceItemId: TurnItemId.make("item-0"),
      });
      assert.equal(context.projection.thread.id, childId);
      assert.isTrue(
        context.projection.visibleTurnItems.some(
          (row) => row.sourceThreadId === v2ThreadId && row.sourceItemId === "item-0",
        ),
      );
      assert.isAtMost(context.projection.visibleTurnItems.length, 75);
    }).pipe(Effect.provide(ProjectionStore.layer.pipe(Layer.provide(V2SqlitePersistenceMemory)))),
);
