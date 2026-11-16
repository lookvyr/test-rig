import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // A bound task can start each run in a new provider session on its thread.
  yield* sql`
    ALTER TABLE scheduled_tasks ADD COLUMN fresh_session INTEGER NOT NULL DEFAULT 0
  `;
});
