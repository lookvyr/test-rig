import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { SourceControlProviderKind } from "@t3tools/contracts";

import * as AzureDevOpsCli from "../sourceControl/AzureDevOpsCli.ts";
import * as BitbucketApi from "../sourceControl/BitbucketApi.ts";
import * as GitHubCli from "../sourceControl/GitHubCli.ts";
import * as GitHubGraphQlBudget from "../sourceControl/githubGraphQlBudget.ts";
import * as GitLabCli from "../sourceControl/GitLabCli.ts";
import * as AzureDevOpsPullRequestCli from "./AzureDevOpsPullRequestCli.ts";
import * as AzureDevOpsPullRequestProvider from "./AzureDevOpsPullRequestProvider.ts";
import * as BitbucketPullRequestApi from "./BitbucketPullRequestApi.ts";
import * as BitbucketPullRequestProvider from "./BitbucketPullRequestProvider.ts";
import * as GitHubPullRequestCli from "./GitHubPullRequestCli.ts";
import * as GitHubPullRequestProvider from "./GitHubPullRequestProvider.ts";
import * as GitLabPullRequestCli from "./GitLabPullRequestCli.ts";
import * as GitLabPullRequestProvider from "./GitLabPullRequestProvider.ts";
import { PullRequestProviderError, type PullRequestProviderApi } from "./PullRequestProvider.ts";
import { ServerSettingsService } from "../serverSettings.ts";

export class PullRequestProviderRegistry extends Context.Service<
  PullRequestProviderRegistry,
  {
    /** Null for a host with no implementation, which the service reports as unsupported. */
    readonly get: (kind: SourceControlProviderKind) => PullRequestProviderApi | null;
    readonly kinds: ReadonlyArray<SourceControlProviderKind>;
  }
>()("t3/pullRequest/PullRequestProviderRegistry") {}

/** Exported for tests, which stand a registry up from providers they supply themselves. */
export function fromProviders(
  providers: ReadonlyArray<PullRequestProviderApi>,
): PullRequestProviderRegistry["Service"] {
  const byKind = new Map(providers.map((provider) => [provider.kind, provider]));
  return {
    get: (kind) => byKind.get(kind) ?? null,
    kinds: providers.map((provider) => provider.kind),
  };
}

/**
 * The hosts this build can read change requests from. A host with no entry here still shows up
 * in the provider list as unimplemented, so its projects are explained rather than missing.
 *
 * @public Service construction is part of the canonical Effect module API.
 */
/** Recheck retained API handles so disabling a host stops subsequent operations. */
export function gateProvider(
  provider: PullRequestProviderApi,
  settings: ServerSettingsService["Service"],
): PullRequestProviderApi {
  const guard = <A, E, R>(
    operation: string,
    use: () => Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | PullRequestProviderError, R> =>
    Effect.gen(function* () {
      const current = yield* settings.getSettings.pipe(
        Effect.mapError(
          (cause) =>
            new PullRequestProviderError({
              provider: provider.kind,
              operation,
              reason: "failed",
              detail: "Could not read source-control integration settings.",
              cause,
            }),
        ),
      );
      if (provider.kind === "unknown" || !current.sourceControlProviders[provider.kind]) {
        return yield* new PullRequestProviderError({
          provider: provider.kind,
          operation,
          reason: "failed",
          detail: "This source-control integration is disabled in Test Rig settings.",
        });
      }
      return yield* Effect.suspend(use);
    });
  const withVerifiedCredential: PullRequestProviderApi["withVerifiedCredential"] =
    provider.withVerifiedCredential
      ? (input, use) =>
          guard("withVerifiedCredential", () => provider.withVerifiedCredential!(input, use))
      : undefined;
  return {
    kind: provider.kind,
    capabilities: provider.capabilities,
    ...(withVerifiedCredential ? { withVerifiedCredential } : {}),
    ...(provider.getRoutingIdentity
      ? {
          getRoutingIdentity: (
            ...args: Parameters<NonNullable<PullRequestProviderApi["getRoutingIdentity"]>>
          ) => guard("getRoutingIdentity", () => provider.getRoutingIdentity!(...args)),
        }
      : {}),
    getViewer: (...args) => guard("getViewer", () => provider.getViewer(...args)),
    listChangeRequests: (...args) =>
      guard("listChangeRequests", () => provider.listChangeRequests(...args)),
    ...(provider.listChangeRequestsAcross
      ? {
          listChangeRequestsAcross: (
            ...args: Parameters<NonNullable<PullRequestProviderApi["listChangeRequestsAcross"]>>
          ) => guard("listChangeRequestsAcross", () => provider.listChangeRequestsAcross!(...args)),
        }
      : {}),
    ...(provider.listChangeRequestStats
      ? {
          listChangeRequestStats: (
            ...args: Parameters<NonNullable<PullRequestProviderApi["listChangeRequestStats"]>>
          ) => guard("listChangeRequestStats", () => provider.listChangeRequestStats!(...args)),
        }
      : {}),
    ...(provider.getChangeRequestChecks
      ? {
          getChangeRequestChecks: (
            ...args: Parameters<NonNullable<PullRequestProviderApi["getChangeRequestChecks"]>>
          ) => guard("getChangeRequestChecks", () => provider.getChangeRequestChecks!(...args)),
        }
      : {}),
    getChangeRequest: (...args) =>
      guard("getChangeRequest", () => provider.getChangeRequest(...args)),
    ...(provider.getChangeRequestPreview
      ? {
          getChangeRequestPreview: (
            ...args: Parameters<NonNullable<PullRequestProviderApi["getChangeRequestPreview"]>>
          ) => guard("getChangeRequestPreview", () => provider.getChangeRequestPreview!(...args)),
        }
      : {}),
    ...(provider.getChangeRequestSummary
      ? {
          getChangeRequestSummary: (
            ...args: Parameters<NonNullable<PullRequestProviderApi["getChangeRequestSummary"]>>
          ) => guard("getChangeRequestSummary", () => provider.getChangeRequestSummary!(...args)),
        }
      : {}),
    ...(provider.getChangeRequestStack
      ? {
          getChangeRequestStack: (
            ...args: Parameters<NonNullable<PullRequestProviderApi["getChangeRequestStack"]>>
          ) => guard("getChangeRequestStack", () => provider.getChangeRequestStack!(...args)),
        }
      : {}),
    getChangeRequestActivity: (...args) =>
      guard("getChangeRequestActivity", () => provider.getChangeRequestActivity(...args)),
    ...(provider.getReviewThreadComments
      ? {
          getReviewThreadComments: (
            ...args: Parameters<NonNullable<PullRequestProviderApi["getReviewThreadComments"]>>
          ) => guard("getReviewThreadComments", () => provider.getReviewThreadComments!(...args)),
        }
      : {}),
    getViewerPermissions: (...args) =>
      guard("getViewerPermissions", () => provider.getViewerPermissions(...args)),
    getDiff: (...args) => guard("getDiff", () => provider.getDiff(...args)),
    ...(provider.getDiffFileContents
      ? {
          getDiffFileContents: (
            ...args: Parameters<NonNullable<PullRequestProviderApi["getDiffFileContents"]>>
          ) => guard("getDiffFileContents", () => provider.getDiffFileContents!(...args)),
        }
      : {}),
    ...(provider.getFilesViewed
      ? {
          getFilesViewed: (
            ...args: Parameters<NonNullable<PullRequestProviderApi["getFilesViewed"]>>
          ) => guard("getFilesViewed", () => provider.getFilesViewed!(...args)),
        }
      : {}),
    ...(provider.setFilesViewed
      ? {
          setFilesViewed: (
            ...args: Parameters<NonNullable<PullRequestProviderApi["setFilesViewed"]>>
          ) => guard("setFilesViewed", () => provider.setFilesViewed!(...args)),
        }
      : {}),
    ...(provider.getFileRevisions
      ? {
          getFileRevisions: (
            ...args: Parameters<NonNullable<PullRequestProviderApi["getFileRevisions"]>>
          ) => guard("getFileRevisions", () => provider.getFileRevisions!(...args)),
        }
      : {}),
    runAction: (...args) => guard("runAction", () => provider.runAction(...args)),
    ...(provider.updateChangeRequest
      ? {
          updateChangeRequest: (
            ...args: Parameters<NonNullable<PullRequestProviderApi["updateChangeRequest"]>>
          ) => guard("updateChangeRequest", () => provider.updateChangeRequest!(...args)),
        }
      : {}),
    comment: (...args) => guard("comment", () => provider.comment(...args)),
    ...(provider.updateComment
      ? {
          updateComment: (
            ...args: Parameters<NonNullable<PullRequestProviderApi["updateComment"]>>
          ) => guard("updateComment", () => provider.updateComment!(...args)),
        }
      : {}),
    submitReview: (...args) => guard("submitReview", () => provider.submitReview(...args)),
    listReviewerCandidates: (...args) =>
      guard("listReviewerCandidates", () => provider.listReviewerCandidates(...args)),
    setReviewerRequest: (...args) =>
      guard("setReviewerRequest", () => provider.setReviewerRequest(...args)),
    ...(provider.listLabelCandidates
      ? {
          listLabelCandidates: (
            ...args: Parameters<NonNullable<PullRequestProviderApi["listLabelCandidates"]>>
          ) => guard("listLabelCandidates", () => provider.listLabelCandidates!(...args)),
        }
      : {}),
    ...(provider.setLabels
      ? {
          setLabels: (...args: Parameters<NonNullable<PullRequestProviderApi["setLabels"]>>) =>
            guard("setLabels", () => provider.setLabels!(...args)),
        }
      : {}),
    replyToThread: (...args) => guard("replyToThread", () => provider.replyToThread(...args)),
    setReaction: (...args) => guard("setReaction", () => provider.setReaction(...args)),
    setThreadResolution: (...args) =>
      guard("setThreadResolution", () => provider.setThreadResolution(...args)),
  };
}

export const make = Effect.gen(function* () {
  const settings = yield* ServerSettingsService;
  const providers = yield* Effect.all([
    GitHubPullRequestProvider.make,
    GitLabPullRequestProvider.make,
    BitbucketPullRequestProvider.make,
    AzureDevOpsPullRequestProvider.make,
  ]);
  return fromProviders(providers.map((provider) => gateProvider(provider, settings)));
});

export const layer = Layer.effect(PullRequestProviderRegistry, make).pipe(
  Layer.provide(
    GitHubPullRequestCli.layer.pipe(
      Layer.provide(GitHubCli.layer),
      Layer.provide(GitHubGraphQlBudget.layer),
    ),
  ),
  Layer.provide(GitLabPullRequestCli.layer.pipe(Layer.provide(GitLabCli.layer))),
  Layer.provide(BitbucketPullRequestApi.layer.pipe(Layer.provide(BitbucketApi.layer))),
  Layer.provide(AzureDevOpsPullRequestCli.layer.pipe(Layer.provide(AzureDevOpsCli.layer))),
);
