import { assert, it } from "@effect/vitest";
import {
  EventId,
  MessageId,
  NodeId,
  ThreadId,
  TurnItemId,
  isProviderNativeSubagentThread,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { V2SqlitePersistenceMemory } from "../persistence/Layers/V2Sqlite.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import {
  makeSubagentChildThread,
  makeSubagentConversationArtifacts,
} from "./SubagentProjection.ts";
import { v2Now, v2Projection } from "./testkit/fixtures.ts";

const layer = ProjectionStore.layer.pipe(Layer.provide(V2SqlitePersistenceMemory));

for (const parentState of ["missing", "archived"] as const) {
  it.effect(`pages a long native child transcript with a ${parentState} parent`, () =>
    Effect.gen(function* () {
      const store = yield* ProjectionStore.ProjectionStoreV2;
      const parentThread = {
        ...v2Projection.thread,
        archivedAt: parentState === "archived" ? v2Now : null,
      };
      if (parentState === "archived") {
        yield* store.apply({
          id: EventId.make("parent-created"),
          threadId: parentThread.id,
          type: "thread.created",
          occurredAt: v2Now,
          payload: parentThread,
        });
      }
      const childThreadId = ThreadId.make("native-child-long-history");
      const child = makeSubagentChildThread({
        parentThread,
        childThreadId,
        parentNodeId: NodeId.make("parent-node"),
        activeProviderThreadId: null,
        providerInstanceId: parentThread.providerInstanceId,
        modelSelection: parentThread.modelSelection,
        title: "Native child",
        now: v2Now,
        createdBy: "agent",
        creationSource: "provider",
      });
      yield* store.apply({
        id: EventId.make("child-created"),
        threadId: childThreadId,
        type: "thread.created",
        occurredAt: v2Now,
        payload: child,
      });

      const messageCount = 251;
      const expectedIds: Array<TurnItemId> = [];
      for (let index = 0; index < messageCount; index++) {
        const { message, turnItem } = makeSubagentConversationArtifacts({
          messageId: MessageId.make(`child-message-${index}`),
          turnItemId: TurnItemId.make(`child-item-${index}`),
          threadId: childThreadId,
          senderThreadId: parentThread.id,
          rootNodeId: NodeId.make("child-node"),
          providerThreadId: null,
          providerTurnId: null,
          nativeItemRef: null,
          role: index % 2 === 0 ? "user" : "assistant",
          text: `Child transcript ${index}`,
          ordinal: index + 1,
          now: v2Now,
        });
        expectedIds.push(turnItem.id);
        yield* store.apply({
          id: EventId.make(`message-${index}`),
          threadId: childThreadId,
          type: "message.updated",
          occurredAt: v2Now,
          payload: message,
        });
        yield* store.apply({
          id: EventId.make(`item-${index}`),
          threadId: childThreadId,
          type: "turn-item.updated",
          occurredAt: v2Now,
          payload: turnItem,
        });
      }

      const snapshot = yield* store.getThreadSnapshotWindow(childThreadId, { rowLimit: 37 });
      assert.isTrue(isProviderNativeSubagentThread(snapshot.projection.thread));
      assert.equal(snapshot.projection.thread.lineage.parentThreadId, parentThread.id);
      assert.isNull(snapshot.projection.thread.archivedAt);
      assert.lengthOf(snapshot.projection.visibleTurnItems, 37);
      assert.deepEqual(
        snapshot.projection.visibleTurnItems.map((row) => row.sourceItemId),
        expectedIds.slice(-37),
      );

      const seenIds: Array<TurnItemId> = [];
      for (let offset = 0; offset < messageCount; offset += 37) {
        const page = yield* store.getTimelinePage(childThreadId, {
          view: "messages",
          limit: 37,
          ...(offset === 0 ? {} : { afterPosition: offset - 1 }),
        });
        assert.equal(page.totalItems, messageCount);
        assert.equal(page.hasMore, offset + page.items.length < messageCount);
        seenIds.push(...page.items.map((row) => row.sourceItemId));
        for (const row of page.items) {
          if (row.item.type === "user_message") {
            assert.equal(row.item.senderThreadId, parentThread.id);
          }
        }
      }
      assert.deepEqual(seenIds, expectedIds);
      assert.equal(yield* store.getMessageCount(childThreadId), messageCount);
      assert.equal(
        (yield* store.getThreadShell(childThreadId))?.lineage.parentThreadId,
        parentThread.id,
      );
      const parentShell = yield* store.getThreadShell(parentThread.id);
      if (parentState === "missing") assert.isNull(parentShell);
      else assert.isNotNull(parentShell?.archivedAt);
    }).pipe(Effect.provide(layer)),
  );
}
