import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Folders someone added to a project from outside its folder. Repositories inside the project
  // folder are found on disk each time, so they are never stored.
  yield* sql`
    ALTER TABLE projection_projects ADD COLUMN added_folders_json TEXT NOT NULL DEFAULT '[]'
  `;
});
