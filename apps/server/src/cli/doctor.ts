import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import { Command, Flag } from "effect/unstable/cli";

import {
  compactDatabase,
  inspectDatabase,
  DatabaseMaintenanceError,
} from "../persistence/DatabaseMaintenance.ts";

const formatBytes = (bytes: number) => `${(bytes / 1024 ** 2).toFixed(1)} MiB`;

export const runDoctor = Effect.fn("runDoctor")(function* (
  databasePath: string,
  options: { readonly fix: boolean; readonly dryRun: boolean },
) {
  const status = yield* inspectDatabase(databasePath);
  yield* Console.log(
    `Database: ${databasePath}\nSize: ${formatBytes(status.databaseBytes)}; unused pages: ${formatBytes(status.reclaimableBytes)}.\nIntegrity: ${status.integrityValid ? "valid" : "INVALID"}; projections: ${status.projection.valid ? "valid" : "INVALID"}.`,
  );
  if (!status.integrityValid || !status.projection.valid) {
    return yield* new DatabaseMaintenanceError({
      message:
        "Inspection found invalid integrity or projections. Nothing changed; automatic repair is not supported.",
    });
  }
  if (options.dryRun || !options.fix) {
    yield* Console.log(
      "Dry run: nothing changed. To reclaim space, quit Test Rig and stop servers using this database, then rerun with --fix. A backup is kept beside the database.",
    );
    return;
  }
  const result = yield* compactDatabase(databasePath);
  yield* Console.log(
    `Reclaimed: ${formatBytes(result.beforeBytes)} → ${formatBytes(result.afterBytes)}. Removed ${result.deletedEventCount} superseded events and ${result.deletedReceiptCount} imported legacy receipts.\nVerified full projection replay. Backup: ${result.backupPath}`,
  );
});

export const doctorCommand = Command.make("doctor", {
  database: Flag.String("database").pipe(
    Flag.withDescription(
      "Exact path to the local statev2.sqlite database. Required; never guesses an application home.",
    ),
  ),
  fix: Flag.Boolean("fix").pipe(
    Flag.withDescription(
      "Back up, compact verified history, and reclaim space while the app is stopped.",
    ),
    Flag.withDefault(false),
  ),
  dryRun: Flag.Boolean("dry-run").pipe(
    Flag.withDescription("Inspect only, even when --fix is supplied (the default)."),
    Flag.withDefault(false),
  ),
}).pipe(
  Command.withDescription(
    "Inspect a local V2 database. Changes require --fix and exclusive access; no service is stopped automatically.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      yield* runDoctor(path.resolve(flags.database), flags);
    }),
  ),
);
