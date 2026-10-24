import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import migrate from "./046_ThreadMessageSearch.ts";
import { rebuildMessageSearch } from "../../orchestration-v2/messageSearchIndex.ts";

it.effect(
  "backfills and synchronizes finished message text through insert, update, delete, and VACUUM",
  () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`CREATE TABLE orchestration_v2_projection_threads(thread_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL)`;
      yield* sql`CREATE TABLE orchestration_v2_projection_messages(message_id TEXT PRIMARY KEY, thread_id TEXT, role TEXT, streaming INTEGER, payload_json TEXT)`;
      yield* sql`INSERT INTO orchestration_v2_projection_threads VALUES ('thread', '{}'), ('child', '{"lineage":{"relationshipToParent":"subagent"}}'), ('side', '{"sideOfThreadId":"thread"}')`;
      yield* sql`INSERT INTO orchestration_v2_projection_messages VALUES
      ('first', 'thread', 'user', 0, '{"text":"backfilled needle","createdBy":"user"}'),
      ('notice', 'thread', 'user', 0, '{"text":"notice needle","createdBy":"agent"}'),
      ('child', 'child', 'assistant', 0, '{"text":"child needle"}'),
      ('side', 'side', 'user', 0, '{"text":"side needle"}'),
      ('stream', 'thread', 'assistant', 1, '{"text":"streaming needle"}')`;
      yield* migrate;
      const hits = () =>
        sql<{
          rowid: number;
        }>`SELECT rowid FROM orchestration_v2_message_search WHERE orchestration_v2_message_search MATCH '"needle"'`;
      assert.lengthOf(yield* hits(), 1);
      yield* sql`UPDATE orchestration_v2_projection_messages SET streaming = 0 WHERE message_id = 'stream'`;
      assert.lengthOf(yield* hits(), 2);
      yield* sql`UPDATE orchestration_v2_projection_messages SET payload_json = '{"text":"changed text"}' WHERE message_id = 'first'`;
      assert.lengthOf(yield* hits(), 1);
      yield* sql`UPDATE orchestration_v2_projection_messages SET role = 'system' WHERE message_id = 'stream'`;
      assert.lengthOf(yield* hits(), 0);
      yield* sql`INSERT INTO orchestration_v2_projection_messages VALUES ('insert', 'thread', 'assistant', 0, '{"text":"inserted needle"}')`;
      assert.lengthOf(yield* hits(), 1);
      yield* sql`DELETE FROM orchestration_v2_projection_messages WHERE message_id = 'first'`;
      yield* sql`VACUUM`;
      yield* rebuildMessageSearch(sql);
      const rows =
        yield* sql`SELECT messages.message_id FROM orchestration_v2_message_search INNER JOIN orchestration_v2_projection_messages AS messages ON messages.rowid = orchestration_v2_message_search.rowid WHERE orchestration_v2_message_search MATCH '"needle"'`;
      assert.deepEqual(
        rows.map((row) => row.message_id),
        ["insert"],
      );
      yield* sql`DELETE FROM orchestration_v2_projection_messages WHERE message_id = 'insert'`;
      assert.lengthOf(yield* hits(), 0);
    }).pipe(Effect.provide(NodeSqliteClient.layerMemory())),
);
