// @effect-diagnostics nodeBuiltinImport:off - Offline SQLite locking/deletion needs lstat (no-follow) and one synchronous lock lifetime.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import * as Effect from "effect/Effect";

import { DatabaseMaintenanceError, inspectDatabase } from "./DatabaseMaintenance.ts";

/** Only the original V1 snapshot beside a verified V2 database is eligible. */
export const inspectLegacyDatabase = Effect.fn("inspectLegacyDatabase")(function* (
  databasePath: string,
) {
  return yield* Effect.try({
    try: () => {
      if (NodePath.basename(databasePath) !== "statev2.sqlite") return null;
      const legacyPath = NodePath.join(NodePath.dirname(databasePath), "state.sqlite");
      try {
        const stat = NodeFS.lstatSync(legacyPath);
        return stat.isFile() ? { path: legacyPath, bytes: stat.size } : null;
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw cause;
      }
    },
    catch: (cause) =>
      new DatabaseMaintenanceError({ message: "Could not inspect the legacy database.", cause }),
  });
});

/** Explicit, offline deletion; never invoked by ordinary compaction. */
export const removeLegacyDatabase = Effect.fn("removeLegacyDatabase")(function* (
  databasePath: string,
) {
  const legacy = yield* inspectLegacyDatabase(databasePath);
  if (legacy === null) {
    return yield* new DatabaseMaintenanceError({
      message: "No regular sibling state.sqlite is eligible for removal beside statev2.sqlite.",
    });
  }
  const status = yield* inspectDatabase(databasePath);
  if (!status.integrityValid || !status.projection.valid) {
    return yield* new DatabaseMaintenanceError({
      message:
        "Current database integrity or projections are invalid; the legacy database was kept.",
    });
  }
  yield* Effect.try({
    try: () => {
      const currentStat = NodeFS.lstatSync(databasePath);
      const legacyStat = NodeFS.lstatSync(legacy.path);
      if (
        !currentStat.isFile() ||
        !legacyStat.isFile() ||
        (currentStat.dev === legacyStat.dev && currentStat.ino === legacyStat.ino)
      ) {
        throw new Error("Database paths must be distinct regular files, without symlinks.");
      }
      const database = new NodeSqlite.DatabaseSync(databasePath);
      try {
        database.exec(
          "PRAGMA busy_timeout = 0; PRAGMA locking_mode = EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT;",
        );
        database.prepare("ATTACH DATABASE ? AS legacy").run(legacy.path);
        database.exec("PRAGMA legacy.locking_mode = EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT;");
        const tables = database
          .prepare("SELECT name FROM legacy.sqlite_master WHERE type = 'table'")
          .all();
        const names = new Set(tables.map((row) => row.name));
        if (names.has("orchestration_v2_events") || !names.has("effect_sql_migrations")) {
          throw new Error("The sibling database is not a recognized V1 database.");
        }
        for (const required of [
          "projection_projects",
          "projection_threads",
          "projection_thread_messages",
        ]) {
          if (!names.has(required)) throw new Error(`Missing V1 source table: ${required}`);
        }
        const integrity = database.prepare("PRAGMA legacy.quick_check").get();
        if (integrity?.quick_check !== "ok")
          throw new Error("Legacy database integrity is invalid.");
        // Compare the original columns: V2 adds legacy import columns during upgrade.
        // Refuse if the old app wrote any source rows after the snapshot was copied.
        for (const table of [
          "projection_projects",
          "projection_threads",
          "projection_thread_messages",
          "projection_thread_pull_requests",
          "projection_thread_sessions",
          "projection_turns",
          "checkpoint_diff_blobs",
        ]) {
          if (!names.has(table)) continue;
          const columns = database
            .prepare(`PRAGMA legacy.table_info(${table})`)
            .all()
            .map((row) => `"${String(row.name).replaceAll('"', '""')}"`)
            .join(", ");
          const missing = database
            .prepare(
              `SELECT ${columns} FROM legacy.${table} EXCEPT SELECT ${columns} FROM main.${table} LIMIT 1`,
            )
            .get();
          if (missing !== undefined)
            throw new Error(`Current database does not retain all legacy source rows in ${table}.`);
        }
        // Delete the main file first so a failed unlink cannot strand committed WAL data.
        NodeFS.unlinkSync(legacy.path);
        for (const suffix of ["-wal", "-shm"]) NodeFS.rmSync(legacy.path + suffix, { force: true });
      } finally {
        database.close();
      }
    },
    catch: (cause) =>
      new DatabaseMaintenanceError({
        message:
          "Legacy removal refused or failed. Stop all Test Rig versions and check that migration retained the legacy source rows. No rollback copy is created by this operation.",
        cause,
      }),
  });
});
