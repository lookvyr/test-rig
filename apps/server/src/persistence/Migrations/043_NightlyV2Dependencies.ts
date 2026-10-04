import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import scheduledTasks from "./OrchestrationV2/ScheduledTasks.ts";
import pullRequestFilesViewed from "./OrchestrationV2/PullRequestFilesViewed.ts";

/** Extend Test Rig's existing V2 database without rebuilding its projections. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ name: string }>`PRAGMA table_info(projection_projects)`;
  const present = new Set(columns.map((column) => column.name));
  for (const [name, definition] of [
    ["default_thread_env_mode", "TEXT"],
    ["auto_pull", "INTEGER NOT NULL DEFAULT 0"],
    ["favicon_path", "TEXT"],
    ["project_icon_json", "TEXT"],
  ] as const) {
    if (!present.has(name))
      yield* sql.unsafe(`ALTER TABLE projection_projects ADD COLUMN ${name} ${definition}`);
  }
  yield* scheduledTasks;
  yield* pullRequestFilesViewed;
});
