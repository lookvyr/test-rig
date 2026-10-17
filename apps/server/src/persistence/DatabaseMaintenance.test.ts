import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { EventId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Tracer from "effect/Tracer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as EventStore from "../orchestration-v2/EventStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { v2Now, v2Projection } from "../orchestration-v2/testkit/fixtures.ts";
import { runDoctor } from "../cli/doctor.ts";
import { compactDatabase, inspectDatabase } from "./DatabaseMaintenance.ts";
import { makeV2SqlitePersistenceLive } from "./Layers/V2Sqlite.ts";
import * as NodeSqliteClient from "./NodeSqliteClient.ts";

const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: "test-rig-doctor-" });
  const databasePath = `${directory}/statev2.sqlite`;
  const stores = Layer.merge(EventStore.layer, ProjectionStore.layer).pipe(
    Layer.provideMerge(makeV2SqlitePersistenceLive(directory)),
  );
  yield* Effect.gen(function* () {
    const sink = yield* EventSink.EventSinkV2;
    const sql = yield* SqlClient.SqlClient;
    yield* sink.write({
      events: [
        {
          id: EventId.make("doctor-created"),
          type: "thread.created",
          threadId: v2Projection.thread.id,
          occurredAt: v2Now,
          payload: v2Projection.thread,
        },
        ...Array.from({ length: 4 }, (_, index) => ({
          id: EventId.make(`doctor-rename-${index}`),
          type: "thread.metadata-updated" as const,
          threadId: v2Projection.thread.id,
          occurredAt: v2Now,
          payload: { ...v2Projection.thread, title: `Rename ${index}` },
        })),
      ],
    });
    yield* sql`CREATE TABLE retained_data (value TEXT)`;
    yield* sql`INSERT INTO retained_data VALUES ('keep')`;
    yield* sql`CREATE TABLE discarded_data (value BLOB)`;
    yield* sql`INSERT INTO discarded_data VALUES (zeroblob(4194304))`;
    yield* sql`DROP TABLE discarded_data`;
    yield* sql`PRAGMA wal_checkpoint(TRUNCATE)`;
  }).pipe(Effect.provide(EventSink.layer.pipe(Layer.provideMerge(stores))));
  return { databasePath, directory };
});

const readData = (databasePath: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return {
      events: yield* sql`SELECT * FROM orchestration_events ORDER BY sequence`,
      projection: yield* sql`SELECT * FROM orchestration_v2_projection_threads`,
      retained: yield* sql`SELECT * FROM retained_data`,
    };
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: databasePath, readonly: true })));

it.effect("doctor is read-only by default and --dry-run overrides --fix", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const { databasePath, directory } = yield* fixture;
    const before = yield* fs.readFile(databasePath);
    const status = yield* inspectDatabase(databasePath);
    assert.isTrue(status.integrityValid);
    assert.isTrue(status.projection.valid);
    assert.isAbove(status.reclaimableBytes, 3 * 1024 ** 2);
    yield* runDoctor(databasePath, { fix: false, dryRun: false });
    yield* runDoctor(databasePath, { fix: true, dryRun: true });
    assert.deepEqual(yield* fs.readFile(databasePath), before);
    assert.isFalse((yield* fs.readDirectory(directory)).some((name) => name.endsWith(".backups")));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect(
  "refuses an idle open server, then backs up and reclaims offline without losing data",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { databasePath, directory } = yield* fixture;
      const before = yield* readData(databasePath);
      const failure = yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`SELECT * FROM retained_data`;
        return yield* compactDatabase(databasePath).pipe(Effect.flip);
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: databasePath })));
      assert.match(failure.message, /in use/);
      assert.deepEqual(yield* readData(databasePath), before);

      const result = yield* compactDatabase(databasePath);
      assert.isBelow(result.afterBytes, result.beforeBytes - 3 * 1024 ** 2);
      assert.equal(result.deletedEventCount, 3);
      assert.deepEqual(yield* readData(result.backupPath), before);
      const recoveredPath = `${directory}/recovered.sqlite`;
      yield* fs.copyFile(result.backupPath, recoveredPath);
      assert.isTrue((yield* inspectDatabase(recoveredPath)).projection.valid);
      assert.deepEqual(yield* readData(recoveredPath), before);
      const after = yield* readData(databasePath);
      assert.deepEqual(after.projection, before.projection);
      assert.deepEqual(after.retained, before.retained);
      assert.isTrue((yield* inspectDatabase(databasePath)).projection.valid);
      const repeated = yield* compactDatabase(databasePath);
      assert.equal(repeated.deletedEventCount, 0);
      assert.notEqual(repeated.backupPath, result.backupPath);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("interruption rolls back the history transaction and releases the exclusive lock", () =>
  Effect.gen(function* () {
    const { databasePath } = yield* fixture;
    const before = yield* readData(databasePath);
    const deleting = yield* Deferred.make<void>();
    const tracer = Tracer.make({
      span(options) {
        const span = new Tracer.NativeSpan(options);
        const end = span.end.bind(span);
        span.end = (endTime, exit) => {
          end(endTime, exit);
          const query = span.attributes.get("db.query.text");
          if (
            typeof query === "string" &&
            query.includes("DELETE FROM orchestration_events WHERE sequence IN")
          ) {
            Deferred.doneUnsafe(deleting, Effect.void);
          }
        };
        return span;
      },
    });
    const fiber = yield* compactDatabase(databasePath).pipe(
      Effect.withTracer(tracer),
      Effect.forkScoped,
    );
    yield* Deferred.await(deleting);
    yield* Fiber.interrupt(fiber);
    assert.deepEqual(yield* readData(databasePath), before);
    assert.isTrue((yield* inspectDatabase(databasePath)).projection.valid);
    assert.equal((yield* compactDatabase(databasePath)).deletedEventCount, 3);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("rolls back compaction when replay differs and leaves a usable pre-change backup", () =>
  Effect.gen(function* () {
    const { databasePath } = yield* fixture;
    yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      // Still decodable and sequence-consistent, but not reproducible from event history.
      yield* sql`UPDATE orchestration_v2_projection_threads SET title = 'unreplayable'`;
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: databasePath })));
    const before = yield* readData(databasePath);
    const failure = yield* compactDatabase(databasePath).pipe(Effect.flip);
    assert.match(failure.message, /rolled back/);
    assert.isDefined(failure.backupPath);
    assert.deepEqual(yield* readData(databasePath), before);
    assert.deepEqual(yield* readData(failure.backupPath!), before);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("does not advertise a recovery backup when backup finalization fails", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const { databasePath, directory } = yield* fixture;
    const before = yield* readData(databasePath);
    const failure = yield* fs.stat(`${directory}/missing`).pipe(Effect.flip);
    const result = yield* compactDatabase(databasePath).pipe(
      Effect.provideService(FileSystem.FileSystem, {
        ...fs,
        chmod: () => Effect.fail(failure),
      }),
      Effect.flip,
    );
    assert.isUndefined(result.backupPath);
    assert.match(result.message, /before changes/);
    assert.deepEqual(yield* readData(databasePath), before);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect(
  "refuses invalid projections, missing databases and invalid files without repairing them",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { databasePath, directory } = yield* fixture;
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE orchestration_v2_projection_metadata SET last_sequence = -1`;
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: databasePath })));
      assert.isFalse((yield* inspectDatabase(databasePath)).projection.valid);
      assert.match((yield* compactDatabase(databasePath).pipe(Effect.flip)).message, /invalid/);
      const missing = `${directory}/missing.sqlite`;
      yield* compactDatabase(missing).pipe(Effect.flip);
      yield* inspectDatabase(missing).pipe(Effect.flip);
      assert.isFalse(yield* fs.exists(missing));
      const invalid = `${directory}/invalid.sqlite`;
      yield* fs.writeFileString(invalid, "not a database");
      yield* inspectDatabase(invalid).pipe(Effect.flip);
      assert.equal(yield* fs.readFileString(invalid), "not a database");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
