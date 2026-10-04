import * as Effect from "effect/Effect";
import * as Migrator from "effect/unstable/sql/Migrator";
import { migrationEntries } from "./Migrations.ts";
import prerequisites from "./Migrations/040_ForkV2Prerequisites.ts";
import v2 from "./Migrations/041_OrchestrationV2.ts";
import indexes from "./Migrations/042_V2ProjectionIndexes.ts";
import nightlyDependencies from "./Migrations/043_NightlyV2Dependencies.ts";
// V1 retains its historical ledger. Only the snapshot-backed V2 layer runs these entries.
export const runV2Migrations = Effect.fn("runV2Migrations")(function* () {
  return yield* Migrator.make({})({
    loader: Migrator.fromRecord(
      Object.fromEntries([
        ...migrationEntries.map(([id, name, migration]) => [`${id}_${name}`, migration]),
        ["40_ForkV2Prerequisites", prerequisites],
        ["41_OrchestrationV2", v2],
        ["42_V2ProjectionIndexes", indexes],
        ["43_NightlyV2Dependencies", nightlyDependencies],
      ]),
    ),
  });
});
