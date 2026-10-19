import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ORCHESTRATION_V2_PROJECTION_SCHEMA_VERSION } from "../orchestration-v2/ProjectionStore.ts";
import { runDoctor } from "../cli/doctor.ts";
import { inspectLegacyDatabase, removeLegacyDatabase } from "./LegacyDatabaseCleanup.ts";
import { makeV2SqlitePersistenceLive } from "./Layers/V2Sqlite.ts";
import { runMigrations } from "./Migrations.ts";
import * as NodeSqliteClient from "./NodeSqliteClient.ts";

const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: "rig-legacy-cleanup-" });
  const legacy = `${directory}/state.sqlite`;
  const current = `${directory}/statev2.sqlite`;
  yield* Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations();
    yield* sql`PRAGMA journal_mode = WAL`;
    yield* sql`INSERT INTO projection_turns (thread_id, turn_id, state, requested_at, checkpoint_turn_count, checkpoint_ref, checkpoint_status, checkpoint_files_json) VALUES ('thread', 'turn', 'completed', '2026-01-01', 1, 'refs/test-rig/checkpoints/legacy', 'ready', '[]')`;
    yield* sql`INSERT INTO checkpoint_diff_blobs (thread_id, from_turn_count, to_turn_count, diff, created_at) VALUES ('thread', 0, 1, 'retained checkpoint diff', '2026-01-01')`;
    yield* sql`INSERT INTO projection_thread_messages (message_id, thread_id, role, text, is_streaming, created_at, updated_at) VALUES ('message', 'thread', 'user', 'history', 0, '2026-01-01', '2026-01-01')`;
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: legacy })));
  yield* Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`UPDATE orchestration_v2_projection_metadata SET schema_version = ${ORCHESTRATION_V2_PROJECTION_SCHEMA_VERSION} WHERE projection_name = 'thread-projections'`;
  }).pipe(Effect.provide(makeV2SqlitePersistenceLive(directory)));
  return { directory, legacy, current };
});

it.effect(
  "V2 drops unused copied tables but retains legacy transcripts and the original rollback database",
  () =>
    Effect.gen(function* () {
      const { legacy, current } = yield* fixture;
      for (const [filename, dropped] of [
        [legacy, false],
        [current, true],
      ] as const) {
        yield* Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const tables = new Set(
            (yield* sql<{ name: string }>`SELECT name FROM sqlite_master WHERE type = 'table'`).map(
              (row) => row.name,
            ),
          );
          for (const table of [
            "projection_thread_activities",
            "projection_thread_proposed_plans",
            "projection_pending_approvals",
            "projection_state",
          ]) {
            assert.equal(tables.has(table), !dropped, table);
          }
          assert.deepEqual(yield* sql`SELECT text FROM projection_thread_messages`, [
            { text: "history" },
          ]);
          for (const table of [
            "projection_projects",
            "projection_threads",
            "projection_thread_messages",
            "projection_turns",
            "checkpoint_diff_blobs",
          ])
            assert.isTrue(tables.has(table));
        }).pipe(Effect.provide(NodeSqliteClient.layer({ filename, readonly: true })));
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect(
  "deletion is explicit, dry-run overrides it, and current history and unrelated backups survive",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { directory, legacy, current } = yield* fixture;
      yield* fs.writeFileString(`${directory}/state.sqlite.backup`, "keep");
      yield* runDoctor(current, { fix: false, dryRun: false });
      yield* runDoctor(current, { fix: true, dryRun: true, removeLegacyDatabase: true });
      assert.isAbove((yield* inspectLegacyDatabase(current))?.bytes ?? 0, 0);
      yield* runDoctor(current, { fix: true, dryRun: false });
      assert.isTrue(yield* fs.exists(legacy));
      yield* removeLegacyDatabase(current);
      for (const suffix of ["", "-wal", "-shm"]) assert.isFalse(yield* fs.exists(legacy + suffix));
      assert.isTrue(yield* fs.exists(current));
      assert.equal(yield* fs.readFileString(`${directory}/state.sqlite.backup`), "keep");
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        assert.deepEqual(yield* sql`SELECT text FROM projection_thread_messages`, [
          { text: "history" },
        ]);
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: current, readonly: true })));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect(
  "refuses a live legacy connection, unmatched source rows, wrong filenames, and symlinks",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { directory, legacy, current } = yield* fixture;
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`SELECT * FROM projection_thread_messages`;
        yield* removeLegacyDatabase(current).pipe(Effect.flip);
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: legacy })));
      assert.isTrue(yield* fs.exists(legacy));
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`SELECT * FROM projection_thread_messages`;
        yield* removeLegacyDatabase(current).pipe(Effect.flip);
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: current })));
      assert.isTrue(yield* fs.exists(legacy));
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE projection_thread_messages SET text = 'newer than snapshot'`;
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: legacy })));
      yield* removeLegacyDatabase(current).pipe(Effect.flip);
      assert.isTrue(yield* fs.exists(legacy));
      yield* removeLegacyDatabase(legacy).pipe(Effect.flip);
      yield* fs.rename(legacy, `${directory}/retained.sqlite`);
      yield* fs.symlink(`${directory}/retained.sqlite`, legacy);
      yield* removeLegacyDatabase(current).pipe(Effect.flip);
      assert.isTrue(yield* fs.exists(`${directory}/retained.sqlite`));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
