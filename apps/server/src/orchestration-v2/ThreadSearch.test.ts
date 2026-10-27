import { assert, it } from "@effect/vitest";
import {
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2DomainEvent,
  type ThreadLinkedPullRequest,
  type ThreadPullRequestLink,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { V2SqlitePersistenceMemory as SqlitePersistenceMemory } from "../persistence/Layers/V2Sqlite.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ThreadSearch from "./ThreadSearch.ts";

const TestLayer = Layer.mergeAll(
  ThreadSearch.layer,
  ProjectionStore.layer,
  ProjectStore.layer,
).pipe(Layer.provideMerge(SqlitePersistenceMemory));

const providerInstanceId = ProviderInstanceId.make("codex");
const at = (minute: number) => DateTime.makeUnsafe(Date.UTC(2026, 8, 27, 0, minute));

const createProject = (projectId: ProjectId) =>
  Effect.flatMap(ProjectStore.ProjectStoreV2, (projects) =>
    projects.apply({
      sequence: 0,
      eventId: EventId.make(`created:${projectId}`),
      aggregateKind: "project",
      aggregateId: projectId,
      occurredAt: DateTime.formatIso(at(0)),
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      type: "project.created",
      payload: {
        projectId,
        title: projectId,
        workspaceRoot: `/work/${projectId}`,
        defaultModelSelection: null,
        scripts: [],
        createdAt: DateTime.formatIso(at(0)),
        updatedAt: DateTime.formatIso(at(0)),
      },
    }),
  );

const thread = (
  threadId: ThreadId,
  projectId: ProjectId,
  overrides: {
    readonly archivedAt?: DateTime.Utc;
    readonly deletedAt?: DateTime.Utc;
    readonly settledAt?: DateTime.Utc;
    readonly title?: string;
    readonly branch?: string;
    readonly subagentOf?: ThreadId;
    readonly linkedPullRequest?: ThreadLinkedPullRequest;
    readonly branchPullRequest?: ThreadLinkedPullRequest;
    readonly pullRequests?: ReadonlyArray<ThreadPullRequestLink>;
  } = {},
): OrchestrationV2DomainEvent => ({
  id: EventId.make(`created:${threadId}`),
  type: "thread.created",
  threadId,
  providerInstanceId,
  occurredAt: at(0),
  payload: {
    createdBy: "user",
    creationSource: "web",
    id: threadId,
    projectId,
    title: overrides.title ?? threadId,
    providerInstanceId,
    modelSelection: { instanceId: providerInstanceId, model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: overrides.branch ?? null,
    linkedPullRequest: overrides.linkedPullRequest ?? null,
    branchPullRequest: overrides.branchPullRequest ?? null,
    pullRequests: overrides.pullRequests ?? [],
    worktreePath: null,
    activeProviderThreadId: null,
    lineage:
      overrides.subagentOf === undefined
        ? { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId }
        : {
            parentThreadId: overrides.subagentOf,
            relationshipToParent: "subagent",
            rootThreadId: overrides.subagentOf,
          },
    forkedFrom: null,
    createdAt: at(0),
    updatedAt: at(0),
    archivedAt: overrides.archivedAt ?? null,
    settledOverride: overrides.settledAt === undefined ? null : "settled",
    settledAt: overrides.settledAt ?? null,
    lastVisitedAt: null,
    deletedAt: overrides.deletedAt ?? null,
  },
});

const message = (
  threadId: ThreadId,
  id: string,
  role: "user" | "assistant" | "system",
  text: string,
  options: { readonly minute?: number; readonly streaming?: boolean } = {},
): OrchestrationV2DomainEvent => ({
  id: EventId.make(`message:${id}`),
  type: "message.updated",
  threadId,
  providerInstanceId,
  occurredAt: at(options.minute ?? 1),
  payload: {
    createdBy: role === "user" ? "user" : "agent",
    creationSource: role === "user" ? "web" : "provider",
    id: MessageId.make(id),
    threadId,
    runId: null,
    nodeId: null,
    role,
    text,
    attachments: [],
    streaming: options.streaming ?? false,
    createdAt: at(options.minute ?? 1),
    updatedAt: at(options.minute ?? 1),
  },
});

it.layer(TestLayer)("ThreadSearch", (it) => {
  it.effect("returns one finished user or assistant match per active thread", () =>
    Effect.gen(function* () {
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const search = yield* ThreadSearch.ThreadSearch;
      const project = ProjectId.make("project:search");
      const deletedProject = ProjectId.make("project:search-deleted");
      yield* createProject(project);
      yield* createProject(deletedProject);
      yield* Effect.flatMap(ProjectStore.ProjectStoreV2, (projects) =>
        projects.apply({
          sequence: 0,
          eventId: EventId.make("deleted:project"),
          aggregateKind: "project",
          aggregateId: deletedProject,
          occurredAt: DateTime.formatIso(at(2)),
          commandId: null,
          causationEventId: null,
          correlationId: null,
          metadata: {},
          type: "project.deleted",
          payload: { projectId: deletedProject, deletedAt: DateTime.formatIso(at(2)) },
        }),
      );

      const both = ThreadId.make("thread:both");
      const assistantOnly = ThreadId.make("thread:assistant");
      const events: ReadonlyArray<OrchestrationV2DomainEvent> = [
        thread(both, project),
        message(both, "both-assistant", "assistant", "needle from the answer", { minute: 3 }),
        message(both, "both-user-old", "user", "older needle question", { minute: 1 }),
        message(both, "both-user-new", "user", "newer needle question", { minute: 2 }),
        thread(assistantOnly, project),
        message(assistantOnly, "assistant-only", "assistant", "needle in an answer"),
        message(assistantOnly, "assistant-streaming", "user", "needle still typing", {
          streaming: true,
        }),
        message(assistantOnly, "assistant-system", "system", "needle system prompt"),
        thread(ThreadId.make("thread:archived"), project, { archivedAt: at(1) }),
        message(ThreadId.make("thread:archived"), "archived", "user", "needle archived"),
        thread(ThreadId.make("thread:deleted"), project, { deletedAt: at(1) }),
        message(ThreadId.make("thread:deleted"), "deleted", "user", "needle deleted"),
        thread(ThreadId.make("thread:orphaned"), deletedProject),
        message(ThreadId.make("thread:orphaned"), "orphaned", "user", "needle orphaned"),
      ];
      yield* Effect.forEach(events, projections.apply, { discard: true });

      const result = yield* search.search({ query: "NEEDLE", limit: 20 });
      assert.deepEqual(
        result.matches.map((match) => [match.threadId, match.source, match.snippet]),
        [
          [both, "user", "newer needle question"],
          [assistantOnly, "assistant", "needle in an answer"],
        ],
      );
      assert.lengthOf((yield* search.search({ query: "needle", limit: 1 })).matches, 1);
      // LIKE wildcards in the query match literally.
      assert.deepEqual((yield* search.search({ query: "ne%le" })).matches, []);
    }),
  );

  it.effect(
    "finds words apart through the index, ranks proximity, and hides internal messages",
    () =>
      Effect.gen(function* () {
        const projections = yield* ProjectionStore.ProjectionStoreV2;
        const search = yield* ThreadSearch.ThreadSearch;
        const sql = yield* SqlClient.SqlClient;
        const project = ProjectId.make("project:search-words");
        yield* createProject(project);
        const phrase = ThreadId.make("thread:search-phrase");
        const near = ThreadId.make("thread:search-near");
        const far = ThreadId.make("thread:search-far");
        const child = ThreadId.make("thread:search-child");
        const notice = ThreadId.make("thread:search-notice");
        const childEvent = thread(child, project);
        if (childEvent.type !== "thread.created") throw new Error("Unexpected fixture");
        yield* Effect.forEach(
          [
            thread(phrase, project),
            message(phrase, "search-phrase", "user", "Database timeout"),
            thread(near, project),
            message(near, "search-near", "user", "Database connection timeout", { minute: 2 }),
            thread(far, project),
            message(far, "search-far", "user", `Database ${"details ".repeat(40)}timeout`, {
              minute: 3,
            }),
            {
              ...childEvent,
              payload: {
                ...childEvent.payload,
                lineage: {
                  rootThreadId: near,
                  parentThreadId: near,
                  relationshipToParent: "subagent" as const,
                },
              },
            },
            message(child, "search-child", "assistant", "Database timeout"),
            thread(notice, project),
            message(notice, "search-notice", "user", "Database timeout"),
          ],
          projections.apply,
          { discard: true },
        );
        yield* sql`UPDATE orchestration_v2_projection_messages SET payload_json = json_set(payload_json, '$.createdBy', 'agent') WHERE message_id = 'search-notice'`;
        const result = yield* search.search({ query: "database timeout" });
        assert.deepEqual(
          result.matches.map((match) => match.threadId),
          [phrase, near, far],
        );
        assert.equal(result.matches[0]?.messageId, "search-phrase");
        assert.include(result.matches[1]?.snippet, "Database connection timeout");
        const plan =
          yield* sql`EXPLAIN QUERY PLAN SELECT rowid FROM orchestration_v2_message_search WHERE orchestration_v2_message_search MATCH '"database" AND "timeout"' ORDER BY rowid DESC LIMIT 2000`;
        assert.isTrue(plan.some((row) => String(row.detail).includes("VIRTUAL TABLE INDEX")));
        yield* projections.apply(message(near, "search-cjk", "assistant", "搜索完成"));
        assert.equal((yield* search.search({ query: "搜索" })).matches[0]?.messageId, "search-cjk");
        assert.equal((yield* search.search({ query: "完成" })).matches[0]?.messageId, "search-cjk");
        assert.deepEqual((yield* search.search({ query: "on" })).matches, []);
        yield* projections.apply(
          message(
            near,
            "search-link",
            "assistant",
            "[Useful label](https://example.test/invisible-needle)",
          ),
        );
        assert.deepEqual((yield* search.search({ query: "invisible-needle" })).matches, []);
        assert.equal(
          (yield* search.search({ query: "Useful label" })).matches[0]?.snippet,
          "Useful label",
        );
      }),
  );

  it.effect("reports an unreadable match as a decode failure", () =>
    Effect.gen(function* () {
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const search = yield* ThreadSearch.ThreadSearch;
      const sql = yield* SqlClient.SqlClient;
      const project = ProjectId.make("project:search-corrupt");
      const threadId = ThreadId.make("thread:corrupt");
      yield* createProject(project);
      yield* Effect.forEach(
        [thread(threadId, project), message(threadId, "corrupt", "user", "20260927")],
        projections.apply,
        { discard: true },
      );
      yield* sql`
        UPDATE orchestration_v2_projection_messages
        SET payload_json = json_set(payload_json, '$.text', 20260927)
        WHERE message_id = 'corrupt'
      `;

      const error = yield* Effect.flip(search.search({ query: "0260927" }));
      assert.equal(error.operation, "decode");
    }),
  );
});

it.layer(TestLayer)("ThreadSearch.searchOlderSettled", (it) => {
  it.effect("returns older settled title matches in scope, then older message hits", () =>
    Effect.gen(function* () {
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const search = yield* ThreadSearch.ThreadSearch;
      const project = ProjectId.make("project:woodland");
      const other = ProjectId.make("project:marsh");
      yield* createProject(project);
      yield* createProject(other);
      const id = (name: string) => ThreadId.make(`thread:kestrel-${name}`);
      const old = at(10);
      yield* Effect.forEach(
        [
          thread(id("old"), project, { title: "Kestrel nest", settledAt: old }),
          thread(id("recent"), project, { title: "Kestrel nest", settledAt: at(50) }),
          thread(id("open"), project, { title: "Kestrel nest" }),
          thread(id("child"), project, {
            title: "Kestrel nest",
            settledAt: old,
            subagentOf: id("old"),
          }),
          thread(id("archived"), project, {
            title: "Kestrel nest",
            settledAt: old,
            archivedAt: at(20),
          }),
          thread(id("deleted"), project, {
            title: "Kestrel nest",
            settledAt: old,
            deletedAt: at(20),
          }),
          thread(id("elsewhere"), other, { title: "Kestrel nest", settledAt: old }),
          thread(id("note"), project, { title: "Unrelated", settledAt: old }),
          thread(id("new-note"), project, { title: "Unrelated", settledAt: at(50) }),
        ],
        projections.apply,
        { discard: true },
      );
      const before = DateTime.formatIso(at(30));
      const messageThreadIds = [
        id("new-note"),
        id("note"),
        id("old"),
        id("child"),
        id("archived"),
        id("deleted"),
        id("open"),
      ];
      assert.sameMembers(
        [...(yield* search.searchOlderSettled({ query: "kestrel", before, messageThreadIds }))],
        [id("old"), id("elsewhere"), id("note")],
      );
      // Metadata follows the palette's substring matching, including short interior text.
      assert.deepEqual(
        yield* search.searchOlderSettled({
          query: "est",
          before,
          projectIds: [project],
          messageThreadIds: [],
        }),
        [id("old")],
      );
      // The scope applies to titles and message hits; message hits follow the titles in order.
      assert.deepEqual(
        yield* search.searchOlderSettled({
          query: "kestrel",
          before,
          projectIds: [project],
          messageThreadIds: [id("elsewhere"), ...messageThreadIds],
        }),
        [id("old"), id("note")],
      );
      assert.deepEqual(
        yield* search.searchOlderSettled({
          query: "kestrel",
          before,
          projectIds: [],
          messageThreadIds,
        }),
        [],
      );
      assert.sameMembers(
        [
          ...(yield* search.searchOlderSettled({
            query: "woodland",
            before,
            messageThreadIds: [],
          })),
        ],
        [id("old"), id("note")],
      );
      // A palette also matches the environment's name.
      assert.include(
        yield* search.searchOlderSettled({
          query: "laptop",
          before,
          environmentLabel: "Laptop",
          messageThreadIds: [],
        }),
        id("note"),
      );
    }),
  );

  it.effect("matches the branch and linked pull requests, like the palette", () =>
    Effect.gen(function* () {
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const search = yield* ThreadSearch.ThreadSearch;
      const project = ProjectId.make("project:heron");
      yield* createProject(project);
      const pullRequest = (number: number): ThreadLinkedPullRequest => ({
        projectId: project,
        repository: "acme/heron",
        number,
        url: `https://github.com/acme/heron/pull/${number}`,
      });
      const branch = ThreadId.make("thread:heron-branch");
      const linked = ThreadId.make("thread:heron-linked");
      const modern = ThreadId.make("thread:heron-modern");
      const branchName = ThreadId.make("thread:heron-branch-name");
      yield* Effect.forEach(
        [
          thread(branch, project, {
            title: "Heron",
            settledAt: at(10),
            branchPullRequest: pullRequest(4101),
          }),
          thread(branchName, project, {
            title: "Unrelated",
            settledAt: at(10),
            branch: "codex/kingfisher-fix",
          }),
          thread(modern, project, {
            title: "Unrelated",
            settledAt: at(10),
            pullRequests: [
              {
                host: "github.com",
                repository: "acme/heron",
                number: 4303,
                url: "https://github.com/acme/heron/pull/4303",
                source: "agent",
                linkedAt: DateTime.formatIso(at(1)),
                snapshot: null,
                stack: null,
              },
            ],
          }),
          thread(linked, project, {
            title: "Heron",
            settledAt: at(10),
            linkedPullRequest: pullRequest(4202),
          }),
        ],
        projections.apply,
        { discard: true },
      );
      const find = (query: string) =>
        search.searchOlderSettled({
          query,
          before: DateTime.formatIso(at(30)),
          messageThreadIds: [],
        });
      assert.deepEqual(yield* find("kingfisher-fix"), [branchName]);
      assert.deepEqual(yield* find("acme/heron#4303"), [modern]);
      assert.deepEqual(yield* find("#4101"), [branch]);
      assert.deepEqual(yield* find("acme/heron#4202"), [linked]);
    }),
  );
});

it.layer(TestLayer)("ThreadSearch.searchThreadsWithOlderSettledRows", (it) => {
  it.effect("adds older settled rows to message hits, or alone for titles only", () =>
    Effect.gen(function* () {
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const search = yield* ThreadSearch.ThreadSearch;
      const sql = yield* SqlClient.SqlClient;
      const project = ProjectId.make("project:seaside");
      yield* createProject(project);
      const old = ThreadId.make("thread:plover-old");
      const recent = ThreadId.make("thread:plover-recent");
      const messageOnly = ThreadId.make("thread:plover-message-only");
      yield* Effect.forEach(
        [
          thread(old, project, { title: "Plover nest", settledAt: at(10) }),
          thread(recent, project, { title: "Plover nest", settledAt: at(50) }),
          thread(messageOnly, project, { title: "Unrelated", settledAt: at(10) }),
          message(messageOnly, "plover-message-only", "assistant", "plover distant note", {
            minute: 1,
          }),
          message(recent, "plover-note", "user", "a plover note", { minute: 2 }),
        ],
        projections.apply,
        { discard: true },
      );
      const run = (request: { readonly titlesOnly?: boolean }) =>
        ThreadSearch.searchThreadsWithOlderSettledRows({
          request: { query: "plover", olderSettledBefore: DateTime.formatIso(at(30)), ...request },
          search: search.search,
          searchOlderSettled: search.searchOlderSettled,
          sql,
          readThreads: (threadIds) =>
            projections.readShellSnapshot({ location: "active", threadIds }),
          latestSequence: Effect.succeed(7),
        });
      const withMessages = yield* run({});
      assert.deepEqual(
        withMessages.matches.map((match) => match.threadId),
        [recent, messageOnly],
      );
      assert.equal(withMessages.snapshotSequence, 7);
      assert.deepEqual(
        withMessages.threads?.map((row) => row.id),
        [old, messageOnly],
      );
      const titles = yield* run({ titlesOnly: true });
      assert.deepEqual(titles.matches, []);
      assert.deepEqual(
        titles.threads?.map((row) => row.id),
        [old],
      );
      // Without the cut it is the plain message search.
      assert.isUndefined(
        (yield* ThreadSearch.searchThreadsWithOlderSettledRows({
          request: { query: "plover" },
          search: search.search,
          searchOlderSettled: search.searchOlderSettled,
          sql,
          readThreads: (threadIds) =>
            projections.readShellSnapshot({ location: "active", threadIds }),
          latestSequence: Effect.succeed(7),
        })).threads,
      );
    }),
  );
});
