import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

it.layer(NodeSqliteClient.layerMemory())("038_ProjectionThreadSideChats", (it) => {
  it.effect("existing threads remain ordinary after the migration", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 37 });
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode,
          created_at, updated_at
        ) VALUES (
          'existing', 'project', 'Existing thread', '{"instanceId":"codex","model":"gpt-5-codex"}',
          'full-access', 'default', '2026-08-30T12:00:00.000Z', '2026-08-30T12:00:00.000Z'
        )
      `;
      yield* runMigrations({ toMigrationInclusive: 38 });
      const rows = yield* sql<{ readonly sideOf: string | null; readonly title: string }>`
        SELECT side_of_thread_id AS "sideOf", title FROM projection_threads WHERE thread_id = 'existing'
      `;
      assert.deepStrictEqual(rows, [{ sideOf: null, title: "Existing thread" }]);
    }),
  );
});
