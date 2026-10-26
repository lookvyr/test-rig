import { assert, it } from "@effect/vitest";
import {
  EventId,
  MessageId,
  NodeId,
  RuntimeRequestId,
  RunId,
  TurnItemId,
  type OrchestrationV2RuntimeRequest,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { V2SqlitePersistenceMemory } from "../persistence/Layers/V2Sqlite.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import {
  buildBoundedThreadProjection,
  selectHistoryPageFromCursor,
  encodeThreadHistoryCursor,
  missingInterruptRequests,
} from "./threadHistoryPaging.ts";
import { v2Now, v2Projection, v2ThreadId } from "./testkit/fixtures.ts";

const layer = ProjectionStore.layer.pipe(Layer.provide(V2SqlitePersistenceMemory));
const base = {
  threadId: v2ThreadId,
  runId: null,
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  status: "completed" as const,
  title: null,
  startedAt: v2Now,
  completedAt: v2Now,
  updatedAt: v2Now,
};
for (const kind of ["user_input", "command"] as const) {
  it.effect(`retains an old pending ${kind} display item on a bounded cold reopen`, () =>
    Effect.gen(function* () {
      const store = yield* ProjectionStore.ProjectionStoreV2;
      yield* store.apply({
        id: EventId.make("thread"),
        threadId: v2ThreadId,
        type: "thread.created",
        occurredAt: v2Now,
        payload: v2Projection.thread,
      });
      const requestId = RuntimeRequestId.make("pending-old-request");
      const request: OrchestrationV2RuntimeRequest = {
        id: requestId,
        nodeId: NodeId.make("old-node"),
        providerTurnId: null,
        nativeRequestRef: null,
        kind,
        status: "pending",
        responseCapability: { type: "message" },
        createdAt: v2Now,
        resolvedAt: null,
      };
      const item: OrchestrationV2TurnItem =
        kind === "user_input"
          ? {
              ...base,
              id: TurnItemId.make("old-question"),
              ordinal: 1,
              type: "user_input_request",
              requestId,
              responseMode: "message",
              questions: [
                {
                  id: "choice",
                  header: "Next",
                  question: "What next?",
                  required: true,
                  allowCustomAnswer: true,
                  options: [],
                },
              ],
            }
          : {
              ...base,
              id: TurnItemId.make("old-approval"),
              ordinal: 1,
              type: "approval_request",
              requestId,
              requestKind: "command",
              prompt: "Run the command?",
            };
      yield* store.apply({
        id: EventId.make("request"),
        threadId: v2ThreadId,
        type: "runtime-request.updated",
        occurredAt: v2Now,
        payload: request,
      });
      yield* store.apply({
        id: EventId.make("request-item"),
        threadId: v2ThreadId,
        type: "turn-item.updated",
        occurredAt: v2Now,
        payload: item,
      });
      for (let index = 0; index < 25; index++) {
        yield* store.apply({
          id: EventId.make(`later-${index}`),
          threadId: v2ThreadId,
          type: "turn-item.updated",
          occurredAt: v2Now,
          payload: {
            ...base,
            id: TurnItemId.make(`later-${index}`),
            ordinal: index + 2,
            type: "user_message",
            messageId: MessageId.make(`message-${index}`),
            createdBy: "user",
            creationSource: "web",
            inputIntent: "turn_start",
            text: `Later turn ${index}`,
            attachments: [],
          },
        });
      }
      const snapshot = yield* store.getThreadSnapshotWindow(v2ThreadId, {
        rowLimit: 77,
        userTurnLimit: 10,
      });
      assert.isTrue(snapshot.projection.turnItems.some((candidate) => candidate.id === item.id));
      const bounded = buildBoundedThreadProjection(snapshot);
      assert.isFalse(
        bounded.projection.visibleTurnItems.some((row) => row.sourceItemId === item.id),
      );
      assert.deepEqual(
        bounded.projection.turnItems.find((candidate) => candidate.id === item.id),
        item,
      );
      assert.equal(
        bounded.projection.runtimeRequests.find((candidate) => candidate.id === requestId)?.status,
        "pending",
      );
      yield* store.apply({
        id: EventId.make("resolved"),
        threadId: v2ThreadId,
        type: "runtime-request.updated",
        occurredAt: v2Now,
        payload: { ...request, status: "resolved", resolvedAt: v2Now },
      });
      const after = yield* store.getThreadSnapshotWindow(v2ThreadId, {
        rowLimit: 77,
        userTurnLimit: 10,
      });
      assert.isFalse(
        buildBoundedThreadProjection(after).projection.turnItems.some(
          (candidate) => candidate.id === item.id,
        ),
      );
    }).pipe(Effect.provide(layer)),
  );
}

for (const [name, storeLayer] of [
  ["SQL", layer],
  ["memory", ProjectionStore.layerMemory],
] as const) {
  it.effect(
    `${name} history pages keep an interrupt request when the row budget splits its turn`,
    () =>
      Effect.gen(function* () {
        const store = yield* ProjectionStore.ProjectionStoreV2;
        yield* store.apply({
          id: EventId.make("split:thread"),
          threadId: v2ThreadId,
          type: "thread.created",
          occurredAt: v2Now,
          payload: v2Projection.thread,
        });
        const runId = RunId.make("split:run");
        for (let ordinal = 1; ordinal <= 120; ordinal++) {
          const item: OrchestrationV2TurnItem = {
            ...base,
            id: TurnItemId.make(`split:item:${ordinal}`),
            runId,
            ordinal,
            ...(ordinal === 1 || ordinal === 100
              ? {
                  type: ordinal === 1 ? "run_interrupt_request" : "run_interrupt_result",
                  message: "Stopped",
                }
              : { type: "command_execution", input: "pwd", output: "workspace", exitCode: 0 }),
          };
          yield* store.apply({
            id: EventId.make(`split:event:${ordinal}`),
            threadId: v2ThreadId,
            type: "turn-item.updated",
            occurredAt: v2Now,
            payload: item,
          });
        }
        const anchorItemId = TurnItemId.make("split:item:120");
        const snapshot = yield* store.getThreadSnapshotWindow(v2ThreadId, {
          rowLimit: 77,
          userTurnLimit: 20,
          anchorItemId,
        });
        const page = selectHistoryPageFromCursor({
          items: snapshot.projection.visibleTurnItems,
          snapshotSequence: snapshot.snapshotSequence,
          cursor: encodeThreadHistoryCursor({
            snapshotSequence: snapshot.snapshotSequence,
            sourceThreadId: v2ThreadId,
            sourceItemId: anchorItemId,
            position: 119,
          }),
        });
        const retained = missingInterruptRequests(snapshot.projection.visibleTurnItems, page.items);
        assert.deepEqual(
          retained.map((row) => row.sourceItemId),
          [TurnItemId.make("split:item:1")],
        );
        assert.isTrue(page.items.some((row) => row.sourceItemId === "split:item:100"));
        assert.isTrue(page.hasMoreHistory);
        assert.isFalse(page.items.some((row) => row.sourceItemId === "split:item:1"));
        assert.isEmpty(
          missingInterruptRequests(snapshot.projection.visibleTurnItems, [
            ...retained,
            ...page.items,
          ]),
        );
      }).pipe(Effect.provide(storeLayer)),
  );
}
