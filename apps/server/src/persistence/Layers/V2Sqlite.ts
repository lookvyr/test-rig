import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import { runV2Migrations } from "../V2Migrations.ts";
import { initializeV2Database } from "../initializeV2Database.ts";

const setup = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`PRAGMA foreign_keys = ON`;
    yield* sql`PRAGMA journal_mode = WAL`;
    yield* runV2Migrations();
  }),
);

/** Separate V2 snapshot; callers supply the state directory, never the V1 filename. */
export const makeV2SqlitePersistenceLive = Effect.fn("makeV2SqlitePersistenceLive")(function* (
  stateDirectory: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(stateDirectory, { recursive: true });
  const filename = path.join(stateDirectory, "statev2.sqlite");
  yield* initializeV2Database(filename);
  return setup.pipe(Layer.provideMerge(NodeSqliteClient.layer({ filename })));
}, Layer.unwrap);

export const V2SqlitePersistenceMemory = setup.pipe(
  Layer.provideMerge(NodeSqliteClient.layerMemory()),
);
