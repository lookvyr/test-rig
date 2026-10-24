import {
  IsoDateTime,
  MessageId,
  OrchestrationThreadSearchSource,
  type OrchestrationSearchThreadsInput,
  type OrchestrationSearchThreadsResult,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { indexedMessageCondition } from "./messageSearchIndex.ts";
import { buildSearchSnippet, matchMessage, messageSearchTokens } from "./messageSearch.ts";

/** Carries no query text: search input is user content. */
export class ThreadSearchError extends Schema.TaggedError<ThreadSearchError>()(
  "ThreadSearchError",
  {
    operation: Schema.Literals(["query", "decode"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Thread search ${this.operation} failed.`;
  }
}

const SearchRequest = Schema.Struct({
  match: Schema.NullOr(Schema.String),
  substrings: Schema.fromJsonString(Schema.Array(Schema.String)),
});
const SearchRow = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  messageId: MessageId,
  source: OrchestrationThreadSearchSource,
  matchText: Schema.String,
  messageCreatedAt: Schema.NullOr(IsoDateTime),
});

/**
 * Searches the finished user and assistant messages of active V2 threads in
 * active projects. Legacy V1 transcripts that have not been imported yet are
 * not searched.
 */
export class ThreadSearch extends Context.Service<
  ThreadSearch,
  {
    readonly search: (
      input: OrchestrationSearchThreadsInput,
    ) => Effect.Effect<OrchestrationSearchThreadsResult, ThreadSearchError>;
  }
>()("t3/orchestration-v2/ThreadSearch") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const index =
    yield* sql`SELECT 1 FROM sqlite_master WHERE name = 'orchestration_v2_message_search'`;
  const hasIndex = index.length > 0;
  const searchRows = SqlSchema.findAll({
    Request: SearchRequest,
    Result: SearchRow,
    execute: ({ match, substrings }) => sql`
      SELECT messages.thread_id AS "threadId", threads.project_id AS "projectId",
        messages.message_id AS "messageId", messages.role AS source,
        json_extract(messages.payload_json, '$.text') AS "matchText",
        messages.created_at AS "messageCreatedAt"
      FROM ${
        match === null
          ? sql`orchestration_v2_projection_messages AS messages`
          : sql`
        orchestration_v2_message_search
        INNER JOIN orchestration_v2_projection_messages AS messages
          ON messages.rowid = orchestration_v2_message_search.rowid
      `
      }
      INNER JOIN orchestration_v2_projection_threads AS threads ON threads.thread_id = messages.thread_id
      INNER JOIN projection_projects AS projects ON projects.project_id = threads.project_id
      WHERE threads.deleted_at IS NULL AND threads.archived_at IS NULL AND projects.deleted_at IS NULL
        AND json_extract(threads.payload_json, '$.lineage.relationshipToParent') IS NOT 'subagent'
        AND json_extract(threads.payload_json, '$.sideOfThreadId') IS NULL
        AND ${indexedMessageCondition(sql)}
        AND NOT EXISTS (SELECT 1 FROM json_each(${substrings}) AS token
          WHERE instr(lower(replace(replace(json_extract(messages.payload_json, '$.text'), '’', ''''), '‘', '''')), token.value) = 0)
        AND ${
          match === null
            ? sql`messages.rowid > (SELECT coalesce(max(rowid), 0) FROM orchestration_v2_projection_messages) - 20000`
            : sql`
          orchestration_v2_message_search MATCH ${match}
          AND orchestration_v2_message_search.rowid >= coalesce((
            SELECT rowid FROM orchestration_v2_message_search
            WHERE orchestration_v2_message_search MATCH ${match}
            ORDER BY rowid DESC LIMIT 1 OFFSET 9999
          ), 0)
        `
        }
      ORDER BY ${match === null ? sql`messages.rowid` : sql`orchestration_v2_message_search.rowid`} DESC
      LIMIT 2000
    `,
  });

  const search: ThreadSearch["Service"]["search"] = Effect.fn("ThreadSearch.search")(
    function* (input) {
      const { tokens, long } = messageSearchTokens(input.query);
      if (long.length === 0) return { matches: [] };
      const indexed = hasIndex && long.every((token) => Array.from(token).length >= 3);
      const rows = yield* searchRows({
        substrings: indexed ? tokens.filter((token) => !long.includes(token)) : tokens,
        match: indexed
          ? long.map((token) => `"${token.replaceAll('"', '""')}"`).join(" AND ")
          : null,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ThreadSearchError({
              operation: Schema.isSchemaError(cause) ? "decode" : "query",
              cause,
            }),
        ),
      );
      const candidates = rows
        .flatMap((row) => {
          // Link addresses are hidden by Markdown; find can only reveal their displayed labels.
          const matchText = row.matchText.replace(/!?\[([^\]\n]*)\]\([^)\s]*\)/g, "$1");
          const match = matchMessage(matchText, tokens);
          return match === null ? [] : [{ ...row, matchText, ...match }];
        })
        .sort(
          (left, right) =>
            right.quality - left.quality ||
            Number(left.source !== "user") - Number(right.source !== "user") ||
            (right.messageCreatedAt ?? "").localeCompare(left.messageCreatedAt ?? "") ||
            left.messageId.localeCompare(right.messageId),
        );
      const seen = new Set<string>();
      return {
        matches: candidates
          .filter((row) => {
            if (seen.has(row.threadId)) return false;
            seen.add(row.threadId);
            return true;
          })
          .slice(0, input.limit ?? 50)
          .map((row) => ({
            threadId: row.threadId,
            projectId: row.projectId,
            messageId: row.messageId,
            source: row.source,
            snippet: buildSearchSnippet(row.matchText, row.offset),
            messageCreatedAt: row.messageCreatedAt,
          })),
      };
    },
  );

  return ThreadSearch.of({ search });
});

export const layer = Layer.effect(ThreadSearch, make);
