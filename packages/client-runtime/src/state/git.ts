import { fetchEnvironmentPullRequestDiff } from "./pullRequestDiffHttp.ts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { HttpClient } from "effect/unstable/http";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import { request } from "../rpc/client.ts";
import { WS_METHODS, type PullRequestDiffInput } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import {
  createAtomCommandScheduler,
  createEnvironmentRpcSubscriptionAtomFamily,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentQueryAtomFamily,
} from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { vcsCommandConcurrency, vcsCommandScheduler } from "./vcsCommandScheduler.ts";

const pullRequestCommandScheduler = createAtomCommandScheduler();
const pullRequestCommandConcurrency = {
  mode: "serial" as const,
  key: ({
    environmentId,
    input,
  }: {
    environmentId: string;
    input: { host?: string | undefined; repository: string; number: number };
  }) => JSON.stringify([environmentId, input.host ?? "github.com", input.repository, input.number]),
};

const loadPullRequestDiff = Effect.fn("PullRequests.loadDiff")(function* ({
  revision: _revision,
  ...input
}: PullRequestDiffInput & { revision?: string | null }) {
  const supervisor = yield* EnvironmentSupervisor;
  const prepared = yield* SubscriptionRef.get(supervisor.prepared);
  const http = yield* Effect.serviceOption(HttpClient.HttpClient);
  const viaSocket = request(WS_METHODS.pullRequestDiff, input);
  if (Option.isNone(prepared) || Option.isNone(http)) return yield* viaSocket;
  return yield* fetchEnvironmentPullRequestDiff(prepared.value, input).pipe(
    Effect.provideService(HttpClient.HttpClient, http.value),
    // Older paired servers serve PR diffs only over their existing RPC.
    Effect.catchIf(
      (e) =>
        e._tag === "RemoteEnvironmentAuthUndeclaredStatusError" &&
        (e.status === 404 || e.status === 405),
      () => viaSocket,
    ),
  );
});

export function createGitEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    pullRequestRefreshes: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:pull-request:refreshes",
      tag: WS_METHODS.pullRequestSubscribeRefreshes,
    }),
    pullRequestThreadComments: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:pull-request:threadComments",
      tag: WS_METHODS.pullRequestThreadComments,
    }),
    pullRequestDiffFileContents: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:pull-request:diffFileContents",
      tag: WS_METHODS.pullRequestDiffFileContents,
    }),
    pullRequestChecks: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:pull-request:checks",
      tag: WS_METHODS.pullRequestChecks,
    }),
    pullRequestStack: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:pull-request:stack",
      tag: WS_METHODS.pullRequestStack,
    }),
    pullRequestRunAction: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:pull-request:runAction",
      tag: WS_METHODS.pullRequestRunAction,
      scheduler: pullRequestCommandScheduler,
      concurrency: pullRequestCommandConcurrency,
    }),
    pullRequestUpdate: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:pull-request:update",
      tag: WS_METHODS.pullRequestUpdate,
      scheduler: pullRequestCommandScheduler,
      concurrency: pullRequestCommandConcurrency,
    }),
    pullRequestComment: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:pull-request:comment",
      tag: WS_METHODS.pullRequestComment,
      scheduler: pullRequestCommandScheduler,
      concurrency: pullRequestCommandConcurrency,
    }),
    pullRequestUpdateComment: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:pull-request:updateComment",
      tag: WS_METHODS.pullRequestUpdateComment,
      scheduler: pullRequestCommandScheduler,
      concurrency: pullRequestCommandConcurrency,
    }),
    pullRequestSubmitReview: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:pull-request:submitReview",
      tag: WS_METHODS.pullRequestSubmitReview,
      scheduler: pullRequestCommandScheduler,
      concurrency: pullRequestCommandConcurrency,
    }),
    pullRequestReplyToThread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:pull-request:replyToThread",
      tag: WS_METHODS.pullRequestReplyToThread,
      scheduler: pullRequestCommandScheduler,
      concurrency: pullRequestCommandConcurrency,
    }),
    pullRequestSetThreadResolution: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:pull-request:setThreadResolution",
      tag: WS_METHODS.pullRequestSetThreadResolution,
      scheduler: pullRequestCommandScheduler,
      concurrency: pullRequestCommandConcurrency,
    }),
    pullRequestSetReaction: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:pull-request:setReaction",
      tag: WS_METHODS.pullRequestSetReaction,
      scheduler: pullRequestCommandScheduler,
      concurrency: pullRequestCommandConcurrency,
    }),
    pullRequestCompletions: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:pull-request:completions",
      tag: WS_METHODS.pullRequestCompletions,
    }),
    pullRequestReviewerCandidates: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:pull-request:reviewerCandidates",
      tag: WS_METHODS.pullRequestReviewerCandidates,
    }),
    pullRequestRequestReviewers: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:pull-request:requestReviewers",
      tag: WS_METHODS.pullRequestRequestReviewers,
      scheduler: pullRequestCommandScheduler,
      concurrency: pullRequestCommandConcurrency,
    }),
    pullRequestLabelCandidates: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:pull-request:labelCandidates",
      tag: WS_METHODS.pullRequestLabelCandidates,
    }),
    pullRequestSetLabels: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:pull-request:setLabels",
      tag: WS_METHODS.pullRequestSetLabels,
      scheduler: pullRequestCommandScheduler,
      concurrency: pullRequestCommandConcurrency,
    }),
    pullRequestFilesViewed: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:pull-request:files-viewed",
      tag: WS_METHODS.pullRequestFilesViewed,
      staleTimeMs: 15_000,
    }),
    setPullRequestFilesViewed: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:pull-request:set-files-viewed",
      tag: WS_METHODS.pullRequestSetFilesViewed,
      scheduler: pullRequestCommandScheduler,
      concurrency: pullRequestCommandConcurrency,
    }),
    pullRequestDetail: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:pull-request:detail",
      tag: WS_METHODS.pullRequestDetail,
    }),
    pullRequestDiff: createEnvironmentQueryAtomFamily(runtime, {
      label: "environment-data:pull-request:diff",
      // A newly observed head must not reuse a previous head's patch while revalidating.
      staleTimeMs: 60_000,
      execute: loadPullRequestDiff,
    }),
    pullRequestActivity: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:pull-request:activity",
      tag: WS_METHODS.pullRequestActivity,
    }),
    invalidatePullRequest: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:pull-request:invalidate",
      tag: WS_METHODS.pullRequestInvalidate,
    }),
    pullRequestStats: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:git:pull-request-stats",
      tag: WS_METHODS.gitGetPullRequestStats,
    }),
    pullRequests: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:git:pull-requests",
      tag: WS_METHODS.gitListPullRequests,
    }),
    pullRequestDetails: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:git:pull-request-details",
      tag: WS_METHODS.gitGetPullRequestDetails,
    }),
    pullRequestResolution: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:git:resolve-pull-request",
      tag: WS_METHODS.gitResolvePullRequest,
    }),
    linkedPullRequest: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:git:linked-pull-request",
      tag: WS_METHODS.gitResolvePullRequest,
      refreshIntervalMs: 60_000,
      isFinal: ({ pullRequest }) => pullRequest.state === "merged",
    }),
    preparePullRequestThread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git:prepare-pull-request-thread",
      tag: WS_METHODS.gitPreparePullRequestThread,
      scheduler: vcsCommandScheduler,
      concurrency: vcsCommandConcurrency,
    }),
  };
}
