import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** V2 never reads these copied projections. Lazy transcript sources and historical checkpoint metadata/diffs stay. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`DROP TABLE IF EXISTS projection_thread_activities`;
  yield* sql`DROP TABLE IF EXISTS projection_thread_proposed_plans`;
  yield* sql`DROP TABLE IF EXISTS projection_pending_approvals`;
  yield* sql`DROP TABLE IF EXISTS projection_state`;
});
