import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ServerConfig } from "../../config.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { ProjectionThreadRepository } from "../../persistence/Services/ProjectionThreads.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import { OrchestrationProjectionPipeline } from "../Services/ProjectionPipeline.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import * as ThreadBackgroundLiveness from "../ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../ThreadPlanProgress.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";

const testLayer = Layer.mergeAll(
  OrchestrationProjectionPipelineLive,
  OrchestrationProjectionSnapshotQueryLive,
).pipe(
  Layer.provideMerge(OrchestrationEventStoreLive),
  Layer.provide(ThreadBackgroundLiveness.layer),
  Layer.provide(ThreadPlanProgress.layer),
  Layer.provide(RepositoryIdentityResolver.layer),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "side-chat-projection-" })),
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(NodeServices.layer),
);

it.layer(testLayer)("side chat projections", (it) => {
  it.effect(
    "retains the hidden child in backing snapshots and reveals the same row after Keep",
    () =>
      Effect.gen(function* () {
        const pipeline = yield* OrchestrationProjectionPipeline;
        const query = yield* ProjectionSnapshotQuery;
        const repository = yield* ProjectionThreadRepository;
        const parentId = ThreadId.make("parent");
        const childId = ThreadId.make("side");
        const projectId = ProjectId.make("project");
        const now = "2026-08-30T12:00:00.000Z";
        let sequence = 0;
        const apply = (
          event: Pick<OrchestrationEvent, "aggregateKind" | "aggregateId"> &
            (
              | Pick<Extract<OrchestrationEvent, { type: "project.created" }>, "type" | "payload">
              | Pick<Extract<OrchestrationEvent, { type: "thread.created" }>, "type" | "payload">
              | Pick<
                  Extract<OrchestrationEvent, { type: "thread.message-sent" }>,
                  "type" | "payload"
                >
              | Pick<
                  Extract<OrchestrationEvent, { type: "thread.meta-updated" }>,
                  "type" | "payload"
                >
              | Pick<Extract<OrchestrationEvent, { type: "thread.archived" }>, "type" | "payload">
            ),
        ) => {
          sequence += 1;
          return pipeline.projectEvent({
            ...event,
            sequence,
            eventId: EventId.make(`event-${sequence}`),
            commandId: CommandId.make(`command-${sequence}`),
            occurredAt: now,
            correlationId: null,
            causationEventId: null,
            metadata: {},
          });
        };
        yield* apply({
          type: "project.created",
          aggregateKind: "project",
          aggregateId: projectId,
          payload: {
            projectId,
            title: "Example",
            workspaceRoot: "/tmp/example",
            defaultModelSelection: null,
            scripts: [],
            createdAt: now,
            updatedAt: now,
          },
        });
        for (const threadId of [parentId, childId]) {
          yield* apply({
            type: "thread.created",
            aggregateKind: "thread",
            aggregateId: threadId,
            payload: {
              threadId,
              projectId,
              ...(threadId === childId ? { sideOfThreadId: parentId } : {}),
              title: threadId === childId ? "Side chat" : "Parent",
              modelSelection: {
                instanceId: ProviderInstanceId.make("codex"),
                model: "gpt-5-codex",
              },
              runtimeMode: "full-access",
              interactionMode: "default",
              branch: "codex/example",
              worktreePath: "/tmp/example/worktree",
              createdAt: now,
              updatedAt: now,
            },
          });
        }
        yield* apply({
          type: "thread.message-sent",
          aggregateKind: "thread",
          aggregateId: childId,
          payload: {
            threadId: childId,
            messageId: MessageId.make("side-question"),
            role: "user",
            text: "Explore alternate refresh behavior",
            turnId: null,
            streaming: false,
            createdAt: now,
            updatedAt: now,
          },
        });

        const shell = yield* query.getShellSnapshot();
        assert.strictEqual(shell.threads.length, 2);
        assert.strictEqual(
          shell.threads.find((thread) => thread.id === childId)?.sideOfThreadId,
          parentId,
        );
        assert.strictEqual(
          (yield* query.getCommandReadModel()).threads.find((thread) => thread.id === childId)
            ?.sideOfThreadId,
          parentId,
        );
        assert.strictEqual(
          (yield* query.getSnapshot()).threads.find((thread) => thread.id === childId)
            ?.sideOfThreadId,
          parentId,
        );
        assert.strictEqual(
          Option.getOrThrow(yield* query.getThreadShellById(childId)).sideOfThreadId,
          parentId,
        );
        const detail = Option.getOrThrow(yield* query.getThreadDetailById(childId));
        assert.strictEqual(detail.sideOfThreadId, parentId);
        assert.strictEqual(detail.messages[0]?.text, "Explore alternate refresh behavior");
        assert.deepStrictEqual((yield* query.searchThreads({ query: "alternate" })).matches, []);
        assert.deepStrictEqual(yield* repository.listSideThreadIds(), [childId]);

        yield* apply({
          type: "thread.meta-updated",
          aggregateKind: "thread",
          aggregateId: childId,
          payload: { threadId: childId, sideOfThreadId: null, updatedAt: now },
        });
        assert.strictEqual(
          Option.getOrThrow(yield* query.getThreadDetailById(childId)).sideOfThreadId,
          null,
        );
        assert.strictEqual(
          (yield* query.searchThreads({ query: "alternate" })).matches[0]?.threadId,
          childId,
        );
        assert.deepStrictEqual(yield* repository.listSideThreadIds(), []);
      }),
  );
});
