import * as NodeV8 from "node:v8";

import { CommandId, EventId, ProjectId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { PersistenceDecodeError } from "../Errors.ts";
import { OrchestrationEventStore } from "../Services/OrchestrationEventStore.ts";
import { OrchestrationEventStoreLive } from "./OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";
const isPersistenceDecodeError = Schema.is(PersistenceDecodeError);

const layer = it.layer(
  OrchestrationEventStoreLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

layer("OrchestrationEventStore", (it) => {
  it.effect("stores json columns as strings and replays decoded events", () =>
    Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const now = "2026-01-01T00:00:00.000Z";

      const appended = yield* eventStore.append({
        type: "project.created",
        eventId: EventId.make("evt-store-roundtrip"),
        aggregateKind: "project",
        aggregateId: ProjectId.make("project-roundtrip"),
        occurredAt: now,
        commandId: CommandId.make("cmd-store-roundtrip"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-store-roundtrip"),
        metadata: {
          adapterKey: "codex",
        },
        payload: {
          projectId: ProjectId.make("project-roundtrip"),
          title: "Roundtrip Project",
          workspaceRoot: "/tmp/project-roundtrip",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });

      const storedRows = yield* sql<{
        readonly payloadJson: string;
        readonly metadataJson: string;
      }>`
        SELECT
          payload_json AS "payloadJson",
          metadata_json AS "metadataJson"
        FROM orchestration_events
        WHERE event_id = ${appended.eventId}
      `;
      assert.equal(storedRows.length, 1);
      assert.equal(typeof storedRows[0]?.payloadJson, "string");
      assert.equal(typeof storedRows[0]?.metadataJson, "string");

      const replayed = yield* Stream.runCollect(eventStore.readFromSequence(0, 10)).pipe(
        Effect.map((chunk) => Array.from(chunk)),
      );
      assert.equal(replayed.length, 1);
      assert.equal(replayed[0]?.type, "project.created");
      assert.equal(replayed[0]?.metadata.adapterKey, "codex");
    }),
  );

  it.effect("fails with PersistenceDecodeError when stored json is invalid", () =>
    Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const now = "2026-01-01T00:00:00.000Z";

      yield* sql`
        INSERT INTO orchestration_events (
          event_id,
          aggregate_kind,
          stream_id,
          stream_version,
          event_type,
          occurred_at,
          command_id,
          causation_event_id,
          correlation_id,
          actor_kind,
          payload_json,
          metadata_json
        )
        VALUES (
          ${EventId.make("evt-store-invalid-json")},
          ${"project"},
          ${ProjectId.make("project-invalid-json")},
          ${0},
          ${"project.created"},
          ${now},
          ${CommandId.make("cmd-store-invalid-json")},
          ${null},
          ${null},
          ${"server"},
          ${"{"},
          ${"{}"}
        )
      `;

      const replayResult = yield* Effect.result(
        Stream.runCollect(eventStore.readFromSequence(0, 10)),
      );
      assert.equal(replayResult._tag, "Failure");
      if (replayResult._tag === "Failure") {
        assert.ok(isPersistenceDecodeError(replayResult.failure));
        assert.ok(
          replayResult.failure.operation.includes(
            "OrchestrationEventStore.readFromSequence:decodeRows",
          ),
        );
      }
    }),
  );
});

it.effect("releases consumed replay pages while preserving ordered, repeatable reads", () =>
  Effect.gen(function* () {
    const store = yield* OrchestrationEventStore;
    const now = "2026-01-01T00:00:00.000Z";
    yield* Effect.forEach(
      Array.from({ length: 1_501 }, (_, index) => index),
      (index) =>
        store.append({
          type: "project.created",
          eventId: EventId.make(`replay-retention-${index}`),
          aggregateKind: "project",
          aggregateId: ProjectId.make(`replay-project-${index}`),
          occurredAt: now,
          commandId: null,
          causationEventId: null,
          correlationId: null,
          metadata: {},
          payload: {
            projectId: ProjectId.make(`replay-project-${index}`),
            title: "Replay Project",
            workspaceRoot: `/tmp/replay-project-${index}`,
            defaultModelSelection: null,
            scripts: [],
            createdAt: now,
            updatedAt: now,
          },
        }),
      { discard: true },
    );

    // oxlint-disable-next-line typescript/no-extraneous-class -- Identifies retained pages in V8's heap query.
    class ReplayPage {}
    let count = 0;
    yield* Stream.runForEach(store.readAll(), (event) =>
      Effect.sync(() => {
        assert.equal(event.sequence, count + 1);
        if (count % 500 === 0) {
          // Count live page markers after full GC without timing or heap-size thresholds.
          Object.assign(event, { replayPage: new ReplayPage() });
          assert.isAtMost(NodeV8.queryObjects(ReplayPage, { format: "count" }), 1);
        }
        count++;
      }),
    );
    assert.equal(count, 1_501);

    const limited = store.readFromSequence(500, 501.9);
    for (let run = 0; run < 2; run++) {
      const events = yield* Stream.runCollect(limited);
      assert.deepEqual(
        events.map((event) => event.sequence),
        Array.from({ length: 501 }, (_, index) => index + 501),
      );
    }
    assert.deepEqual(yield* Stream.runCollect(store.readFromSequence(0, -1)), []);
    assert.deepEqual(yield* Stream.runCollect(store.readFromSequence(1_501)), []);
  }).pipe(Effect.provide(OrchestrationEventStoreLive.pipe(Layer.provide(SqlitePersistenceMemory)))),
);
