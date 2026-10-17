import { DatabaseStorageError, type DatabaseStorageStatus } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as EventStore from "../orchestration-v2/EventStore.ts";
import * as ProjectionMaintenance from "../orchestration-v2/ProjectionMaintenance.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as NodeSqliteClient from "./NodeSqliteClient.ts";

export class DatabaseMaintenanceError extends Schema.TaggedError<DatabaseMaintenanceError>()(
  "DatabaseMaintenanceError",
  {
    message: Schema.String,
    backupPath: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect()),
  },
) {}
const isDatabaseMaintenanceError = Schema.is(DatabaseMaintenanceError);

const readStorage = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const pages = yield* sql<{ readonly page_count: number }>`PRAGMA page_count`;
  const free = yield* sql<{ readonly freelist_count: number }>`PRAGMA freelist_count`;
  const size = yield* sql<{ readonly page_size: number }>`PRAGMA page_size`;
  const pageSize = size[0]?.page_size ?? 0;
  return {
    databaseBytes: (pages[0]?.page_count ?? 0) * pageSize,
    reclaimableBytes: (free[0]?.freelist_count ?? 0) * pageSize,
  };
});

const projectionLayer = (filename: string, readonly: boolean) =>
  ProjectionMaintenance.layer.pipe(
    Layer.provide(Layer.merge(EventStore.layer, ProjectionStore.layer)),
    Layer.provideMerge(NodeSqliteClient.layer({ filename, readonly })),
  );

/** Read-only, on-demand accounting. Never migrates or creates the database. */
export const readDatabaseStorage = Effect.fn("readDatabaseStorage")(
  function* (databasePath: string, inspectCommand: string) {
    const status = yield* readStorage.pipe(
      Effect.provide(NodeSqliteClient.layer({ filename: databasePath, readonly: true })),
    );
    return { ...status, inspectCommand } satisfies DatabaseStorageStatus;
  },
  Effect.mapError((cause) => new DatabaseStorageError({ cause })),
);

/** Dry-run inspection uses only a read-only connection, including projection verification. */
export const inspectDatabase = Effect.fn("inspectDatabase")(
  function* (databasePath: string) {
    return yield* Effect.gen(function* () {
      const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
      const sql = yield* SqlClient.SqlClient;
      const integrity = yield* sql<{ readonly quick_check: string }>`PRAGMA quick_check`;
      return {
        ...(yield* readStorage),
        integrityValid: integrity.length === 1 && integrity[0]?.quick_check === "ok",
        projection: yield* maintenance.verify,
      };
    }).pipe(Effect.provide(projectionLayer(databasePath, true)));
  },
  Effect.mapError(
    (cause) =>
      new DatabaseMaintenanceError({
        message:
          "Could not inspect this V2 database. Check the path, permissions, and database version. Nothing was repaired.",
        cause,
      }),
  ),
);

/**
 * Offline only. The exclusive lock survives transaction boundaries, including VACUUM.
 * A backup precedes changes; the event rewrite and full projection replay are atomic.
 * VACUUM failure leaves the verified database usable and retains the backup.
 */
export const compactDatabase = Effect.fn("compactDatabase")(function* (databasePath: string) {
  const fs = yield* FileSystem.FileSystem;
  // Refuse missing paths before opening a read/write connection (which would create a file).
  if (
    !(yield* fs.exists(databasePath).pipe(
      Effect.mapError(
        (cause) =>
          new DatabaseMaintenanceError({
            message: `Could not access database: ${databasePath}`,
            cause,
          }),
      ),
    ))
  ) {
    return yield* new DatabaseMaintenanceError({
      message: `Database does not exist: ${databasePath}`,
    });
  }
  let backupPath: string | undefined;
  return yield* Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
    yield* sql`PRAGMA busy_timeout = 0`;
    yield* sql`PRAGMA locking_mode = EXCLUSIVE`;
    yield* sql`BEGIN EXCLUSIVE`.pipe(
      Effect.mapError(
        (cause) =>
          new DatabaseMaintenanceError({
            message:
              "Database is in use. Quit Test Rig and stop servers using this database, then retry. No changes were made.",
            cause,
          }),
      ),
    );
    yield* sql`COMMIT`;
    const integrity = yield* sql<{ readonly quick_check: string }>`PRAGMA quick_check`;
    if (
      integrity.length !== 1 ||
      integrity[0]?.quick_check !== "ok" ||
      !(yield* maintenance.verify).valid
    ) {
      return yield* new DatabaseMaintenanceError({
        message:
          "Database integrity or projections are invalid. Refusing compaction; no repair was attempted.",
      });
    }
    const before = yield* readStorage;
    yield* fs.makeDirectory(`${databasePath}.backups`, { recursive: true, mode: 0o700 });
    const backupDirectory = yield* fs.makeTempDirectory({
      directory: `${databasePath}.backups`,
      prefix: "doctor-",
    });
    const candidateBackupPath = `${backupDirectory}/statev2.sqlite`;
    yield* sql`VACUUM INTO ${candidateBackupPath}`;
    yield* fs.chmod(candidateBackupPath, 0o600);
    yield* Effect.gen(function* () {
      const file = yield* fs.open(candidateBackupPath, { flag: "r" });
      yield* file.sync;
    }).pipe(Effect.scoped);
    // A failed/incomplete backup must never be advertised as a recovery file.
    backupPath = candidateBackupPath;

    const summary = yield* sql.withTransaction(
      Effect.gen(function* () {
        // SQL snapshots keep the comparison out of JS memory. Every projection table is
        // compared, except bookkeeping timestamps; receipts and other local state stay intact.
        const tables = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master WHERE type = 'table'
          AND (name GLOB 'orchestration_v2_projection_*' OR name = 'orchestration_v2_turn_item_positions')
          AND name != 'orchestration_v2_projection_metadata'
        ORDER BY name
      `;
        for (const { name } of tables) {
          yield* sql`CREATE TEMP TABLE ${sql(`doctor_before_${name}`)} AS SELECT * FROM ${sql(name)}`;
        }
        const result = yield* maintenance.compactEventStore;
        if (!(yield* maintenance.rebuild).valid) {
          return yield* new DatabaseMaintenanceError({
            message: "Projection replay failed verification. Compaction was rolled back.",
            backupPath,
          });
        }
        for (const { name } of tables) {
          const snapshot = `doctor_before_${name}`;
          const differences = yield* sql<{ readonly different: number }>`
          SELECT EXISTS(SELECT * FROM ${sql(snapshot)} EXCEPT SELECT * FROM ${sql(name)})
            OR EXISTS(SELECT * FROM ${sql(name)} EXCEPT SELECT * FROM ${sql(snapshot)}) AS different
        `;
          if (differences[0]?.different !== 0) {
            return yield* new DatabaseMaintenanceError({
              message: `Projection replay changed ${name}. Compaction was rolled back.`,
              backupPath,
            });
          }
          yield* sql`DROP TABLE ${sql(snapshot)}`;
        }
        return result;
      }),
    );
    yield* sql`VACUUM`;
    yield* sql`PRAGMA wal_checkpoint(TRUNCATE)`;
    const after = yield* readStorage;
    return {
      beforeBytes: before.databaseBytes,
      afterBytes: after.databaseBytes,
      ...summary,
      backupPath,
    };
  }).pipe(
    Effect.provide(projectionLayer(databasePath, false)),
    Effect.mapError((cause) =>
      isDatabaseMaintenanceError(cause)
        ? cause
        : new DatabaseMaintenanceError({
            message: backupPath
              ? `Maintenance failed. The database remains transactional; the pre-change backup is at ${backupPath}.`
              : "Maintenance failed before changes. Check permissions and available disk space.",
            ...(backupPath === undefined ? {} : { backupPath }),
            cause,
          }),
    ),
  );
});
