import { loadOlderSettledThreadsPage } from "./ShellStream.ts";
import {
  IsoDateTime,
  MessageId,
  OrchestrationThreadSearchSource,
  type OrchestrationV2SearchThreadsInput,
  type OrchestrationV2SearchThreadsResult,
  type OrchestrationV2ThreadShellSnapshot,
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

const OlderSettledTitleRow = Schema.Struct({
  id: ThreadId,
  title: Schema.String,
  branch: Schema.NullOr(Schema.String),
  projectTitle: Schema.String,
  pullRequests: Schema.String,
  updatedAt: IsoDateTime,
});

/**
 * Searches the finished user and assistant messages of active V2 threads in
 * active projects. Legacy V1 transcripts that have not been imported yet are
 * not searched.
 */
export class ThreadSearch extends Context.Service<
  ThreadSearch,
  {
    readonly searchOlderSettled: (input: {
      readonly query: string;
      readonly before: string;
      readonly projectIds?: ReadonlyArray<ProjectId> | undefined;
      readonly environmentLabel?: string | undefined;
      readonly messageThreadIds: ReadonlyArray<ThreadId>;
    }) => Effect.Effect<ReadonlyArray<ThreadId>, ThreadSearchError>;
    readonly search: (
      input: OrchestrationSearchThreadsInput,
    ) => Effect.Effect<OrchestrationSearchThreadsResult, ThreadSearchError>;
  }
>()("t3/orchestration-v2/ThreadSearch") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const olderSettledCandidates = SqlSchema.findAll({
    Request: Schema.Struct({
      before: Schema.String,
      projectIds: Schema.NullOr(Schema.fromJsonString(Schema.Array(ProjectId))),
    }),
    Result: OlderSettledTitleRow,
    execute: ({ before, projectIds }) => sql`
      SELECT threads.thread_id AS id,
        json_extract(threads.payload_json, '$.title') AS title,
        json_extract(threads.payload_json, '$.branch') AS branch,
        projects.title AS "projectTitle", threads.updated_at AS "updatedAt",
        (SELECT coalesce(group_concat(
          json_extract(link.value, '$.repository') || '#' || json_extract(link.value, '$.number')
          || ' ' || coalesce(json_extract(link.value, '$.url'), '') || ' ' ||
          coalesce(json_extract(link.value, '$.snapshot.title'), '')
        , ' '), '') FROM json_each(
          coalesce(json_extract(threads.payload_json, '$.pullRequests'), '[]')
        ) AS link) || ' ' ||
        coalesce(json_extract(threads.payload_json, '$.linkedPullRequest.repository'), '') || '#' ||
        coalesce(json_extract(threads.payload_json, '$.linkedPullRequest.number'), '') || ' ' ||
        coalesce(json_extract(threads.payload_json, '$.linkedPullRequest.url'), '') || ' ' ||
        coalesce(json_extract(threads.payload_json, '$.branchPullRequest.repository'), '') || '#' ||
        coalesce(json_extract(threads.payload_json, '$.branchPullRequest.number'), '') || ' ' ||
        coalesce(json_extract(threads.payload_json, '$.branchPullRequest.url'), '') AS "pullRequests"
      FROM orchestration_v2_projection_threads AS threads
      INNER JOIN projection_projects AS projects ON projects.project_id = threads.project_id
      WHERE threads.deleted_at IS NULL AND threads.archived_at IS NULL
        AND projects.deleted_at IS NULL
        AND json_extract(threads.payload_json, '$.lineage.relationshipToParent') IS NOT 'subagent'
        AND json_extract(threads.payload_json, '$.sideOfThreadId') IS NULL
        AND json_extract(threads.payload_json, '$.settledOverride') = 'settled'
        AND json_extract(threads.payload_json, '$.settledAt') < ${before}
        AND (${projectIds} IS NULL OR threads.project_id IN (SELECT value FROM json_each(${projectIds})))
    `,
  });

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

  const searchOlderSettled: ThreadSearch["Service"]["searchOlderSettled"] = Effect.fn(
    "ThreadSearch.searchOlderSettled",
  )(function* ({ query, before, projectIds, environmentLabel, messageThreadIds }) {
    const rows = yield* olderSettledCandidates({ before, projectIds: projectIds ?? null }).pipe(
      Effect.mapError(
        (cause) =>
          new ThreadSearchError({
            operation: Schema.isSchemaError(cause) ? "decode" : "query",
            cause,
          }),
      ),
    );
    const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
    const normalizedQuery = normalize(query);
    const titleIds = rows
      .flatMap((row) => {
        const haystack = normalize(
          [row.title, row.branch, row.projectTitle, environmentLabel, row.pullRequests]
            .filter(Boolean)
            .join(" "),
        );
        if (!haystack.includes(normalizedQuery)) return [];
        const title = normalize(row.title);
        const quality =
          title === normalizedQuery
            ? 3
            : title.startsWith(normalizedQuery)
              ? 2
              : title.includes(normalizedQuery)
                ? 1
                : 0;
        return [{ row, quality }];
      })
      .toSorted(
        (a, b) =>
          b.quality - a.quality ||
          b.row.updatedAt.localeCompare(a.row.updatedAt) ||
          a.row.id.localeCompare(b.row.id),
      )
      .slice(0, 15)
      .map(({ row }) => row.id);
    const shown = new Set(titleIds);
    const older = new Set(rows.map((row) => row.id));
    return [
      ...titleIds,
      ...[...new Set(messageThreadIds)].filter((id) => !shown.has(id) && older.has(id)).slice(0, 5),
    ];
  });
  return ThreadSearch.of({ search, searchOlderSettled });
});

export const layer = Layer.effect(ThreadSearch, make);

/**
 * The client search: message hits, and with `olderSettledBefore`, the rows of the best older
 * settled matches, which shells that omit them do not hold.
 */
export const searchThreadsWithOlderSettledRows = Effect.fn(
  "ThreadSearch.searchThreadsWithOlderSettledRows",
)(function* <E1, E2, E3, E4, E5>(input: {
  readonly request: OrchestrationV2SearchThreadsInput;
  readonly search: (
    input: OrchestrationSearchThreadsInput,
  ) => Effect.Effect<OrchestrationSearchThreadsResult, E1>;
  readonly searchOlderSettled: (
    input: Parameters<ThreadSearch["Service"]["searchOlderSettled"]>[0],
  ) => Effect.Effect<ReadonlyArray<ThreadId>, E2>;
  readonly sql: SqlClient.SqlClient;
  readonly readThreads: (
    threadIds: ReadonlyArray<ThreadId>,
  ) => Effect.Effect<Effect.Effect<OrchestrationV2ThreadShellSnapshot, E4>, E3>;
  readonly latestSequence: Effect.Effect<number, E5>;
}) {
  const { olderSettledBefore, projectIds, environmentLabel, titlesOnly, ...request } =
    input.request;
  const messages: OrchestrationV2SearchThreadsResult =
    titlesOnly === true ? { matches: [] } : yield* input.search(request);
  if (olderSettledBefore === undefined) return messages;
  // Ranked before the rows' transaction, so scoring never holds the shared reader.
  const threadIds = yield* input.searchOlderSettled({
    query: request.query,
    before: olderSettledBefore,
    projectIds,
    environmentLabel,
    messageThreadIds: messages.matches.map((match) => match.threadId),
  });
  const older = yield* loadOlderSettledThreadsPage({
    sql: input.sql,
    listThreads: Effect.succeed({ threadIds, counts: [] }),
    readThreads: input.readThreads,
    latestSequence: input.latestSequence,
  });
  return { ...messages, snapshotSequence: older.snapshotSequence, threads: older.threads };
});
