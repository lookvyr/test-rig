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
    watchFingerprint?: PullRequestService.PullRequestService["Service"]["watchFingerprint"];
    invalidate?: PullRequestService.PullRequestService["Service"]["invalidate"];
    dispatch?: (
      command: SyncCommand,
    ) => Effect.Effect<void, Orchestrator.OrchestratorDispatchError>;
    detail?: PullRequestService.PullRequestService["Service"]["detail"];
    activity?: PullRequestService.PullRequestService["Service"]["activity"];
    threadComments?: PullRequestService.PullRequestService["Service"]["threadComments"];
  } = {},
) {
  const threads = yield* Ref.make<ReadonlyArray<ProjectionStore.ProjectionThreadPullRequests>>([
    {
      id: ThreadId.make("watch-thread"),
      projectId: ProjectId.make("watch-project"),
      lineage: {
        rootThreadId: ThreadId.make("watch-thread"),
        parentThreadId: null,
        relationshipToParent: null,
      },
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
  let fingerprintRead = 0;
  const dependencies = Layer.mergeAll(
    Layer.succeed(Crypto.Crypto, crypto),
    Layer.mock(ProjectionStore.ProjectionStoreV2)({
      getThreadsWithPullRequests: () => Ref.get(threads),
    }),
    Layer.mock(PullRequestService.PullRequestService)({
      watchFingerprint:
        options.watchFingerprint ??
        (() =>
          Effect.succeed({ status: String(fingerprintRead++), remarks: String(fingerprintRead) })),
      invalidate: options.invalidate ?? (() => Effect.void),
      detail: options.detail ?? (() => Effect.succeed(detail)),
      activity: options.activity ?? (() => Effect.succeed(activity())),
      threadComments: options.threadComments ?? (() => Effect.die("unexpected reply page")),
    }),
    Layer.mock(Orchestrator.OrchestratorV2)({
      dispatch: (command) => {
        if (command.type !== "thread.pull-request-watch.sync")
          return Effect.die("unexpected command");
        return (options.dispatch?.(command) ?? Effect.void).pipe(
          Effect.andThen(Ref.update(commands, (current) => [...current, command])),
          Effect.andThen(
            Ref.update(threads, (current) =>
              current.map((thread) =>
                thread.id !== command.threadId
                  ? thread
                  : {
                      ...thread,
                      pullRequests: thread.pullRequests!.map((link) => {
                        if (link.watch?.startedAt !== command.startedAt) return link;
                        const { watch: _previous, ...rest } = link;
                        return command.watch ? { ...rest, watch: command.watch } : rest;
                      }),
                    },
              ),
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

it.effect("a plain comment establishes the review baseline and wakes with only comment news", () =>
  Effect.gen(function* () {
    const fresh = {
      ...comment("new-comment"),
      kind: "issue-comment" as const,
      path: null,
      createdAt: "2026-10-06T12:01:00.000Z",
    };
    const fixture = yield* harness({
      detail: () => Effect.succeed({ ...detail, approvalDecision: "review-required" }),
      activity: () => Effect.succeed(activity({ comments: [fresh], commentCount: 1 })),
    });
    yield* fixture.reactor.sweep;
    const commands = yield* Ref.get(fixture.commands);
    assert.equal(commands.length, 1);
    assert.equal(commands[0]?.wake?.notification.summary, "#7: new comments");
    assert.equal(commands[0]?.watch?.approvalDecision, "review-required");
    assert.equal(commands[0]?.watch?.wakes, 1);
    yield* fixture.reactor.sweep;
    assert.equal((yield* Ref.get(fixture.commands)).length, 1);
  }),
);

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

it.effect("settling ends a watch without a host read and unsetting does not restore it", () =>
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
    assert.isNull((yield* Ref.get(fixture.commands))[0]?.watch);
    assert.isUndefined((yield* Ref.get(fixture.threads))[0]?.pullRequests?.[0]?.watch);
    yield* Ref.update(fixture.threads, (threads) =>
      threads.map((thread) => ({ ...thread, settledOverride: null })),
    );
    yield* fixture.reactor.sweep;
    assert.equal(reads, 0);
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

it.effect("persists readiness with one combined wake and no repeat on the next sweep", () =>
  Effect.gen(function* () {
    let current: PullRequestDetail = {
      ...detail,
      approvalDecision: "approved",
      mergeReadiness: { status: "blocked", reason: "GitHub merge state: BLOCKED" },
    };
    const fixture = yield* harness({ detail: () => Effect.succeed(current) });
    yield* fixture.reactor.sweep;
    current = {
      ...current,
      mergeReadiness: { status: "ready", reason: "GitHub merge state: CLEAN" },
    };
    yield* fixture.reactor.sweep;
    yield* fixture.reactor.sweep;
    const commands = yield* Ref.get(fixture.commands);
    assert.equal(commands.length, 2);
    assert.include(commands[0]!.wake!.text, "review decision");
    assert.include(commands[1]!.wake!.text, "ready to merge");
    assert.notInclude(commands[1]!.wake!.text, "review decision");
    assert.equal(commands[1]!.watch?.mergeReadiness?.status, "ready");
    current = { ...current, state: "closed" };
    yield* fixture.reactor.sweep;
    assert.isNull((yield* Ref.get(fixture.commands)).at(-1)!.watch);
  }),
);

it.effect("shares reads within a project, isolates projects, and wakes each watching thread", () =>
  Effect.gen(function* () {
    const reads: ProjectId[] = [];
    let activities = 0;
    const fixture = yield* harness({
      watchFingerprint: () => Effect.succeed(null),
      detail: (ref) =>
        Effect.sync(() => {
          reads.push(ref.projectId);
          return { ...detail, approvalDecision: "approved" as const };
        }),
      activity: () =>
        Effect.sync(() => {
          activities++;
          return activity();
        }),
    });
    yield* Ref.update(fixture.threads, ([first]) => [
      first!,
      { ...first!, id: ThreadId.make("second") },
      { ...first!, id: ThreadId.make("other-project"), projectId: ProjectId.make("other") },
    ]);
    yield* fixture.reactor.sweep;
    assert.equal(reads.length, 2);
    assert.equal(activities, 2);
    assert.equal((yield* Ref.get(fixture.commands)).filter((command) => command.wake).length, 3);
    yield* fixture.reactor.sweep;
    assert.equal(reads.length, 2);
    yield* TestClock.adjust("10 minutes");
    yield* fixture.reactor.sweep;
    assert.equal(reads.length, 4);
  }),
);

it.effect("fingerprints gate reads without losing approval and queue-readiness updates", () =>
  Effect.gen(function* () {
    let current: PullRequestDetail = {
      ...detail,
      approvalDecision: "review-required",
      mergeReadiness: { status: "blocked", reason: "GitHub merge state: BLOCKED" },
    };
    let status = "blocked";
    let remarks = "quiet";
    let reads = 0;
    let activities = 0;
    let invalidations = 0;
    const fixture = yield* harness({
      watchFingerprint: () => Effect.succeed({ status, remarks }),
      invalidate: () =>
        Effect.sync(() => {
          invalidations++;
        }),
      detail: () =>
        Effect.sync(() => {
          reads++;
          return current;
        }),
      activity: () =>
        Effect.sync(() => {
          activities++;
          return activity();
        }),
    });
    yield* fixture.reactor.sweep;
    yield* fixture.reactor.sweep;
    assert.equal(reads, 1);
    assert.equal(activities, 1);
    current = {
      ...current,
      approvalDecision: "approved",
      mergeReadiness: { status: "queue-required", reason: "GitHub merge state: CLEAN" },
    };
    status = "queue-required";
    yield* fixture.reactor.sweep;
    const update = (yield* Ref.get(fixture.commands)).at(-1)!;
    assert.include(update.wake!.text, "approved");
    assert.include(update.wake!.text, "ready for the merge queue");
    assert.equal(reads, 2);
    assert.equal(activities, 1);
    remarks = "new-review";
    yield* fixture.reactor.sweep;
    assert.equal(activities, 2);
    assert.equal(invalidations, 3);
    yield* TestClock.adjust("30 minutes");
    yield* fixture.reactor.sweep;
    assert.equal(activities, 3);
  }),
);

it.effect("unknown readiness keeps detail polling even with a stable fingerprint", () =>
  Effect.gen(function* () {
    let reads = 0;
    let activities = 0;
    const fixture = yield* harness({
      watchFingerprint: () => Effect.succeed({ status: "stable", remarks: "stable" }),
      detail: () =>
        Effect.sync(() => {
          reads++;
          return {
            ...detail,
            mergeReadiness: { status: "unknown" as const, reason: "Host is computing readiness" },
          };
        }),
      activity: () =>
        Effect.sync(() => {
          activities++;
          return activity();
        }),
    });
    yield* fixture.reactor.sweep;
    yield* fixture.reactor.sweep;
    assert.equal(reads, 2);
    assert.equal(activities, 1);
  }),
);

it.effect("an incomplete activity read is retried despite an unchanged fingerprint", () =>
  Effect.gen(function* () {
    let activities = 0;
    const fixture = yield* harness({
      watchFingerprint: () => Effect.succeed({ status: "stable", remarks: "stable" }),
      activity: () =>
        Effect.sync(() => {
          activities++;
          return activity({ commentsTruncated: true, reviewThreadsTruncated: true });
        }),
    });
    yield* fixture.reactor.sweep;
    yield* fixture.reactor.sweep;
    assert.equal(activities, 2);
    assert.equal(
      (yield* Ref.get(fixture.threads))[0]!.pullRequests![0]!.watch!.remarksThrough,
      NOW,
    );
  }),
);

it.effect("a new or restarted watch gets a full read despite a quiet PR", () =>
  Effect.gen(function* () {
    let activities = 0;
    const fixture = yield* harness({
      watchFingerprint: () => Effect.succeed({ status: "stable", remarks: "stable" }),
      activity: () =>
        Effect.sync(() => {
          activities++;
          return activity();
        }),
    });
    yield* fixture.reactor.sweep;
    yield* Ref.update(fixture.threads, ([first]) => [
      first!,
      { ...first!, id: ThreadId.make("new") },
    ]);
    yield* fixture.reactor.sweep;
    assert.equal(activities, 2);
    yield* Ref.update(fixture.threads, (threads) =>
      threads.map((thread) => ({
        ...thread,
        pullRequests: thread.pullRequests!.map((link) => ({
          ...link,
          watch: { ...link.watch!, startedAt: "2026-10-06T13:00:00.000Z" },
        })),
      })),
    );
    yield* fixture.reactor.sweep;
    assert.equal(activities, 3);
  }),
);

it.effect(
  "a refused wake does not block peers and retries without waiting for the quiet interval",
  () =>
    Effect.gen(function* () {
      let refuse = true;
      const fixture = yield* harness({
        watchFingerprint: () => Effect.succeed({ status: "stable", remarks: "stable" }),
        detail: () => Effect.succeed({ ...detail, approvalDecision: "approved" }),
        dispatch: (command) =>
          refuse && command.threadId === "watch-thread"
            ? Effect.fail(
                new Orchestrator.OrchestratorDispatchError({
                  commandId: command.commandId,
                  commandType: command.type,
                  cause: "retry",
                }),
              )
            : Effect.void,
      });
      yield* Ref.update(fixture.threads, ([first]) => [
        first!,
        { ...first!, id: ThreadId.make("peer") },
      ]);
      yield* fixture.reactor.sweep;
      assert.deepEqual(
        (yield* Ref.get(fixture.commands)).map((command) => command.threadId),
        ["peer"],
      );
      refuse = false;
      yield* fixture.reactor.sweep;
      assert.deepEqual(
        (yield* Ref.get(fixture.commands)).map((command) => command.threadId),
        ["peer", "watch-thread"],
      );
    }),
);

it.effect.each(["closed", "merged"] as const)(
  "ends a %s PR watch and reports closure only",
  (state) =>
    Effect.gen(function* () {
      const fixture = yield* harness({ detail: () => Effect.succeed({ ...detail, state }) });
      yield* fixture.reactor.sweep;
      const commands = yield* Ref.get(fixture.commands);
      assert.isNull(commands[0]!.watch);
      assert.equal(commands[0]!.wake !== undefined, state === "closed");
      yield* fixture.reactor.sweep;
      assert.equal((yield* Ref.get(fixture.commands)).length, 1);
    }),
);

it.effect("a fingerprint rate-limit pause neither reads detail nor spends the failure budget", () =>
  Effect.gen(function* () {
    const fixture = yield* harness({
      watchFingerprint: () =>
        Effect.fail(
          new PullRequestOperationError({
            operation: "watchFingerprint",
            detail: "paused",
            cause: new PullRequestProviderError({
              provider: "github",
              operation: "fingerprint",
              reason: "rate-limited",
              detail: "paused",
            }),
          }),
        ),
      detail: () => Effect.die("must not read while paused"),
    });
    for (let i = 0; i < 10; i++) yield* fixture.reactor.sweep;
    assert.isEmpty(yield* Ref.get(fixture.commands));
    assert.isDefined((yield* Ref.get(fixture.threads))[0]!.pullRequests![0]!.watch);
  }),
);
