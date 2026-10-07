import { assert, it } from "@effect/vitest";
import {
  ProjectId,
  PullRequestOperationError,
  ThreadId,
  type PullRequestActivity,
  type PullRequestComment,
  type PullRequestDetail,
  type ThreadPullRequestWatch,
  type OrchestrationV2ServerCommand,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { TestClock } from "effect/testing";
import { PullRequestProviderError } from "../pullRequest/PullRequestProvider.ts";
import * as PullRequestService from "../pullRequest/PullRequestService.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as PullRequestWatchReactor from "./PullRequestWatchReactor.ts";

const NOW = "2026-10-06T12:00:00.000Z";
const watch: ThreadPullRequestWatch = {
  startedAt: NOW,
  headSha: "head",
  failedChecks: [],
  passed: false,
  passedChecks: [],
  remarksThrough: NOW,
  remarkIds: [],
  conflicting: false,
  wakes: 0,
};
const comment = (id: string, editedAt?: string): PullRequestComment => ({
  id,
  kind: "review-comment",
  author: { login: "bot", name: null, avatarUrl: null },
  body: `Report ${id}`,
  createdAt: "2026-10-06T11:00:00.000Z",
  ...(editedAt ? { editedAt } : {}),
  url: null,
  path: "src/index.ts",
  reviewState: null,
});
const detail: PullRequestDetail = {
  provider: "github",
  projectId: ProjectId.make("watch-project"),
  projectTitle: "Watch",
  workspaceRoot: "/watch",
  repository: "owner/repository",
  number: 7,
  title: "Watched pull request",
  body: "",
  url: "https://github.com/owner/repository/pull/7",
  state: "open",
  isDraft: false,
  headBranch: "feature",
  baseBranch: "main",
  headSha: "head",
  checks: [],
  mergeability: "mergeable",
  viewer: "agent",
  author: { login: "agent", name: null, avatarUrl: null },
  additions: 0,
  deletions: 0,
  changedFiles: 0,
  createdAt: NOW,
  updatedAt: NOW,
  mergedAt: null,
  closedAt: null,
  reviewers: [],
  labels: [],
  mergeCapabilities: { merge: true, squash: true, rebase: true },
  capabilities: {
    diff: true,
    comment: true,
    actions: [],
    mergeMethods: [],
    search: false,
    review: { inlineComment: false, reply: false, resolve: false, verdicts: [] },
    reviewers: { request: false, listCandidates: false },
  },
  viewerPermissions: {
    actions: [],
    comment: true,
    resolve: true,
    verdicts: [],
    requestReviewers: false,
  },
};
const activity = (overrides: Partial<PullRequestActivity> = {}): PullRequestActivity => ({
  comments: [],
  commentCount: 0,
  commentsTruncated: false,
  reviewThreadsTruncated: false,
  reviewThreads: [],
  commits: [],
  ...overrides,
});
type SyncCommand = Extract<
  OrchestrationV2ServerCommand,
  { type: "thread.pull-request-watch.sync" }
>;
const crypto = Crypto.make({
  randomBytes: (size) => new Uint8Array(size).fill(1),
  digest: (_algorithm, data) => Effect.succeed(data),
});

const harness = Effect.fn("PullRequestWatchTest.harness")(function* (
  options: {
    detail?: PullRequestService.PullRequestService["Service"]["detail"];
    activity?: PullRequestService.PullRequestService["Service"]["activity"];
    threadComments?: PullRequestService.PullRequestService["Service"]["threadComments"];
  } = {},
) {
  const threads = yield* Ref.make<ReadonlyArray<ProjectionStore.ProjectionThreadPullRequests>>([
    {
      id: ThreadId.make("watch-thread"),
      projectId: ProjectId.make("watch-project"),
      settledAt: null,
      settledOverride: null,
      pullRequestAssociation: null,
      pullRequests: [
        {
          host: "github.com",
          repository: "owner/repository",
          number: 7,
          source: "manual",
          linkedAt: NOW,
          url: "https://github.com/owner/repository/pull/7",
          snapshot: null,
          stack: null,
          watch,
        },
      ],
    },
  ]);
  const commands = yield* Ref.make<ReadonlyArray<SyncCommand>>([]);
  const dependencies = Layer.mergeAll(
    Layer.succeed(Crypto.Crypto, crypto),
    Layer.mock(ProjectionStore.ProjectionStoreV2)({
      getThreadsWithPullRequests: () => Ref.get(threads),
    }),
    Layer.mock(PullRequestService.PullRequestService)({
      detail: options.detail ?? (() => Effect.succeed(detail)),
      activity: options.activity ?? (() => Effect.succeed(activity())),
      threadComments: options.threadComments ?? (() => Effect.die("unexpected reply page")),
    }),
    Layer.mock(Orchestrator.OrchestratorV2)({
      dispatch: (command) => {
        if (command.type !== "thread.pull-request-watch.sync")
          return Effect.die("unexpected command");
        return Ref.update(commands, (current) => [...current, command]).pipe(
          Effect.andThen(
            Ref.update(threads, (current) =>
              current.map((thread) => ({
                ...thread,
                pullRequests: thread.pullRequests!.map((link) => {
                  if (link.watch?.startedAt !== command.startedAt) return link;
                  const { watch: _previous, ...rest } = link;
                  return command.watch ? { ...rest, watch: command.watch } : rest;
                }),
              })),
            ),
          ),
          Effect.as({ sequence: 1, storedEvents: [] }),
        );
      },
    }),
  );
  const reactor = yield* PullRequestWatchReactor.make.pipe(Effect.provide(dependencies));
  return { reactor, commands, threads };
});

it.effect("reads every reply page and sees a tail edit with an unchanged comment count", () =>
  Effect.gen(function* () {
    let tail = comment("tail", "2026-10-06T12:06:00.000Z");
    const pages: string[] = [];
    const first = comment("first");
    const fixture = yield* harness({
      activity: () =>
        Effect.succeed(
          activity({
            comments: [first],
            commentCount: 3,
            commentsTruncated: true,
            reviewThreads: [
              {
                id: "thread",
                path: "src/index.ts",
                line: 1,
                side: "right",
                isResolved: false,
                isOutdated: false,
                comments: [first],
                commentCount: 3,
                nextCommentsCursor: "page-2",
              },
            ],
          }),
        ),
      threadComments: (input) =>
        Effect.sync(() => {
          pages.push(input.cursor);
          return input.cursor === "page-2"
            ? { comments: [comment("middle")], nextCursor: "page-3" }
            : { comments: [tail], nextCursor: null };
        }),
    });
    yield* fixture.reactor.sweep;
    let recorded = yield* Ref.get(fixture.commands);
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0]?.watch?.remarksThrough, tail.editedAt);
    assert.include(recorded[0]?.wake?.text ?? "", "Report tail");
    yield* fixture.reactor.sweep;
    assert.equal((yield* Ref.get(fixture.commands)).length, 1);
    tail = { ...tail, body: "Edited tail", editedAt: "2026-10-06T12:08:00.000Z" };
    yield* fixture.reactor.sweep;
    recorded = yield* Ref.get(fixture.commands);
    assert.equal(recorded.length, 2);
    assert.include(recorded[1]?.wake?.text ?? "", "Edited tail");
    assert.deepEqual(pages, ["page-2", "page-3", "page-2", "page-3", "page-2", "page-3"]);
  }),
);

it.effect.each(["missing-threads", "cycle", "failed-page", "short-page"] as const)(
  "does not advance the comment watermark on %s",
  (scenario) =>
    Effect.gen(function* () {
      const first = comment("first", "2026-10-06T12:06:00.000Z");
      let reads = 0;
      const fixture = yield* harness({
        activity: () =>
          Effect.succeed(
            activity({
              comments: [first],
              commentCount: 2,
              commentsTruncated: true,
              reviewThreadsTruncated: scenario === "missing-threads",
              reviewThreads: [
                {
                  id: "thread",
                  path: "src/index.ts",
                  line: 1,
                  side: "right",
                  isResolved: false,
                  isOutdated: false,
                  comments: [first],
                  commentCount: 2,
                  nextCommentsCursor: "page-2",
                },
              ],
            }),
          ),
        threadComments: () => {
          reads++;
          if (scenario === "failed-page")
            return Effect.fail(
              new PullRequestOperationError({
                operation: "threadComments",
                detail: "transient page failure",
              }),
            );
          return Effect.succeed({
            comments: [],
            nextCursor: scenario === "cycle" ? "page-2" : null,
          });
        },
      });
      yield* fixture.reactor.sweep;
      assert.isEmpty(yield* Ref.get(fixture.commands));
      assert.equal(reads, scenario === "missing-threads" ? 0 : 1);
      assert.equal(
        (yield* Ref.get(fixture.threads))[0]?.pullRequests?.[0]?.watch?.remarksThrough,
        NOW,
      );
    }),
);

it.effect("rate-limit pauses retain the watch and retry after the reported reset", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse(NOW));
    const reset = Date.parse(NOW) + 30 * 60_000;
    let reads = 0;
    const fixture = yield* harness({
      detail: () =>
        Effect.gen(function* () {
          reads++;
          const now = yield* Clock.currentTimeMillis;
          if (now < reset)
            return yield* new PullRequestOperationError({
              operation: "detail",
              detail: "host paused",
              cause: new PullRequestProviderError({
                provider: "github",
                operation: "detail",
                reason: "rate-limited",
                retryAt: reset,
                detail: "host paused",
              }),
            });
          return detail;
        }),
      activity: () =>
        Effect.succeed(
          activity({ comments: [comment("resumed", "2026-10-06T12:30:00.000Z")], commentCount: 1 }),
        ),
    });
    for (let pass = 0; pass < 20; pass++) {
      yield* fixture.reactor.sweep;
      yield* TestClock.adjust("1 minute");
    }
    assert.isEmpty(yield* Ref.get(fixture.commands));
    assert.isDefined((yield* Ref.get(fixture.threads))[0]?.pullRequests?.[0]?.watch);
    yield* TestClock.setTime(reset);
    yield* fixture.reactor.sweep;
    assert.equal((yield* Ref.get(fixture.commands)).length, 1);
    assert.equal(reads, 21);
  }),
);

it.effect("settling pauses a watch without discarding it and unsetting resumes its reads", () =>
  Effect.gen(function* () {
    let reads = 0;
    const fixture = yield* harness({
      detail: () =>
        Effect.sync(() => {
          reads++;
          return detail;
        }),
    });
    yield* Ref.update(fixture.threads, (threads) =>
      threads.map((thread) => ({ ...thread, settledOverride: "settled" as const })),
    );
    yield* fixture.reactor.sweep;
    assert.equal(reads, 0);
    assert.isEmpty(yield* Ref.get(fixture.commands));
    assert.isDefined((yield* Ref.get(fixture.threads))[0]?.pullRequests?.[0]?.watch);
    yield* Ref.update(fixture.threads, (threads) =>
      threads.map((thread) => ({ ...thread, settledOverride: null })),
    );
    yield* fixture.reactor.sweep;
    assert.equal(reads, 1);
  }),
);

it.effect("includes complete review threads even when the flat conversation omits them", () =>
  Effect.gen(function* () {
    const reply = comment("thread-only", "2026-10-06T12:06:00.000Z");
    const fixture = yield* harness({
      activity: () =>
        Effect.succeed(
          activity({
            reviewThreads: [
              {
                id: "thread",
                path: "src/index.ts",
                line: 1,
                side: "right",
                isResolved: false,
                isOutdated: false,
                comments: [reply],
              },
            ],
          }),
        ),
    });
    yield* fixture.reactor.sweep;
    assert.include((yield* Ref.get(fixture.commands))[0]?.wake?.text ?? "", "Report thread-only");
  }),
);
