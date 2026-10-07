import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import * as Schema from "effect/Schema";
import * as GitHubApi from "./GitHubApi.ts";
import { environmentToken } from "./GitHubCredentials.ts";
import { normalizeGitRemoteUrl } from "@t3tools/shared/git";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { SourceControlProviderError, type ChangeRequest } from "@t3tools/contracts";

import * as GitHubCli from "./GitHubCli.ts";
import { findAuthenticatedGitHubAccount, parseGitHubAuthStatus } from "./gitHubAuthStatus.ts";
import { type NormalizedGitHubPullRequestRecord } from "./gitHubPullRequests.ts";
import * as SourceControlProvider from "./SourceControlProvider.ts";
import {
  combinedAuthOutput,
  firstSafeAuthLine,
  providerAuth,
  type SourceControlAuthProbeInput,
  type SourceControlCliDiscoverySpec,
  type SourceControlApiDiscoverySpec,
} from "./SourceControlProviderDiscovery.ts";

function toChangeRequest(
  summary: NormalizedGitHubPullRequestRecord | GitHubCli.GitHubPullRequestSummary,
): ChangeRequest {
  return {
    provider: "github",
    number: summary.number,
    title: summary.title,
    url: summary.url,
    baseRefName: summary.baseRefName,
    headRefName: summary.headRefName,
    state: summary.state ?? "open",
    updatedAt:
      "updatedAt" in summary
        ? typeof summary.updatedAt === "string"
          ? DateTime.make(summary.updatedAt)
          : summary.updatedAt
        : Option.none(),
    ...(summary.isDraft === undefined ? {} : { isDraft: summary.isDraft }),
    closedAt: summary.closedAt ?? null,
    mergedAt: summary.mergedAt ?? null,
    ...(summary.isCrossRepository !== undefined
      ? { isCrossRepository: summary.isCrossRepository }
      : {}),
    ...(summary.headRepositoryNameWithOwner !== undefined
      ? { headRepositoryNameWithOwner: summary.headRepositoryNameWithOwner }
      : {}),
    ...(summary.headRepositoryOwnerLogin !== undefined
      ? { headRepositoryOwnerLogin: summary.headRepositoryOwnerLogin }
      : {}),
  };
}

function parseGitHubAuth(input: SourceControlAuthProbeInput) {
  const output = combinedAuthOutput(input);
  const authStatus = parseGitHubAuthStatus(input.stdout);
  const authenticatedAccount = findAuthenticatedGitHubAccount(authStatus.accounts);
  const host = authenticatedAccount?.host;

  if (authenticatedAccount) {
    return providerAuth({
      status: "authenticated",
      account: authenticatedAccount.account,
      host,
    });
  }

  const failedAccount = authStatus.accounts.find((entry) => entry.active) ?? authStatus.accounts[0];
  if (authStatus.parsed) {
    return providerAuth({
      status: "unauthenticated",
      host: failedAccount?.host,
      detail:
        failedAccount?.error ??
        "Run `gh auth login` to authenticate GitHub CLI with an active account.",
    });
  }

  // `gh auth status --json` requires GitHub CLI 2.81.0 or newer. Older
  // versions reject the flag with the same non-zero exit shape as a signed-out
  // CLI, so surface the actionable version problem instead.
  if (input.exitCode !== 0 && output.includes("unknown flag: --json")) {
    return providerAuth({
      status: "unknown",
      detail:
        "GitHub CLI is too old to report sign-in status. Update `gh` to 2.81.0 or newer (for example `brew upgrade gh`) and rescan.",
    });
  }

  if (input.exitCode !== 0) {
    return providerAuth({
      status: "unauthenticated",
      host,
      detail: firstSafeAuthLine(output) ?? "Run `gh auth login` to authenticate GitHub CLI.",
    });
  }

  return providerAuth({
    status: "unknown",
    host,
    detail: firstSafeAuthLine(output) ?? "GitHub CLI auth status could not be parsed.",
  });
}

export const discovery = {
  type: "cli",
  kind: "github",
  label: "GitHub",
  executable: "gh",
  versionArgs: ["--version"],
  authArgs: ["auth", "status", "--json", "hosts"],
  parseAuth: parseGitHubAuth,
  installHint:
    "Install the GitHub command-line tool (`gh`) via https://cli.github.com/ or your package manager (for example `brew install gh`).",
} satisfies SourceControlCliDiscoverySpec;

const decodeViewer = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Struct({ login: Schema.String })),
);

/** Environment-only credentials work even when the optional gh credential helper is absent. */
export const makeDiscovery = Effect.gen(function* () {
  const environment = yield* HostProcessEnvironment;
  const api = yield* GitHubApi.GitHubApi;
  const host = environment.GH_HOST?.trim().toLowerCase() || "github.com";
  if (environmentToken(host, environment) === null) return discovery;
  return {
    type: "api",
    kind: "github",
    label: "GitHub",
    installHint: "Set GH_TOKEN on the server, or sign in with gh auth login.",
    probeAuth: api.rest({ host, operation: "probeAuth", path: "user" }).pipe(
      Effect.flatMap((response) => decodeViewer(response.body)),
      Effect.map((viewer) =>
        providerAuth({ status: "authenticated", host, account: viewer.login }),
      ),
      Effect.catch((error) =>
        Effect.succeed(
          providerAuth({
            status:
              error._tag === "GitHubApiAuthenticationError" ||
              error._tag === "GitHubNotSignedInError" ||
              error._tag === "GitHubCliMissingError" ||
              error._tag === "GitHubHostDisabledError"
                ? "unauthenticated"
                : "unknown",
            host,
            detail: error.message,
          }),
        ),
      ),
    ),
  } satisfies SourceControlApiDiscoverySpec;
});

export const make = Effect.gen(function* () {
  const github = yield* GitHubCli.GitHubCli;

  const listChangeRequests: SourceControlProvider.SourceControlProvider["Service"]["listChangeRequests"] =
    (input) => {
      if (input.state === "open") {
        return github
          .listOpenPullRequests({
            cwd: input.cwd,
            headSelector: input.headSelector,
            ...(input.limit !== undefined ? { limit: input.limit } : {}),
          })
          .pipe(
            Effect.map((items) => items.map(toChangeRequest)),
            Effect.mapError(
              (error) =>
                new SourceControlProviderError({
                  provider: "github",
                  operation: "listChangeRequests",
                  command: error.command,
                  cwd: input.cwd,
                  reference: SourceControlProvider.transportSafeSourceControlErrorValue(
                    input.headSelector,
                  ),
                  detail: error.detail,
                  cause: error,
                }),
            ),
          );
      }

      return github
        .listPullRequestsByHead({
          cwd: input.cwd,
          headSelector: input.headSelector,
          state: input.state,
          limit: input.limit ?? 20,
        })
        .pipe(
          Effect.map((items) =>
            items.map((item) => ({
              ...toChangeRequest(item),
              updatedAt: item.updatedAt,
            })),
          ),
          Effect.mapError(
            (error) =>
              new SourceControlProviderError({
                provider: "github",
                operation: "listChangeRequests",
                command: error.command,
                cwd: input.cwd,
                reference: SourceControlProvider.transportSafeSourceControlErrorValue(
                  input.headSelector,
                ),
                detail: error.detail,
                cause: error,
              }),
          ),
        );
    };

  return SourceControlProvider.SourceControlProvider.of({
    kind: "github",
    listChangeRequests,
    getChangeRequest: (input) =>
      github
        .getPullRequest({
          ...input,
          // gh otherwise prefers a fork's upstream repository for numeric references.
          reference:
            input.context !== undefined && /^#?\d+$/.test(input.reference.trim())
              ? `https://${normalizeGitRemoteUrl(input.context.remoteUrl)}/pull/${input.reference.trim().replace(/^#/, "")}`
              : input.reference,
        })
        .pipe(
          Effect.map(toChangeRequest),
          Effect.mapError(
            (error) =>
              new SourceControlProviderError({
                provider: "github",
                operation: "getChangeRequest",
                command: error.command,
                cwd: input.cwd,
                reference: SourceControlProvider.transportSafeSourceControlErrorValue(
                  input.reference,
                ),
                detail: error.detail,
                cause: error,
              }),
          ),
        ),
    createChangeRequest: (input) =>
      github
        .createPullRequest({
          cwd: input.cwd,
          baseBranch: input.baseRefName,
          headSelector: input.headSelector,
          title: input.title,
          bodyFile: input.bodyFile,
        })
        .pipe(
          Effect.mapError(
            (error) =>
              new SourceControlProviderError({
                provider: "github",
                operation: "createChangeRequest",
                command: error.command,
                cwd: input.cwd,
                reference: SourceControlProvider.transportSafeSourceControlErrorValue(
                  input.headSelector,
                ),
                detail: error.detail,
                cause: error,
              }),
          ),
        ),
    getRepositoryCloneUrls: (input) =>
      github.getRepositoryCloneUrls(input).pipe(
        Effect.mapError(
          (error) =>
            new SourceControlProviderError({
              provider: "github",
              operation: "getRepositoryCloneUrls",
              command: error.command,
              cwd: input.cwd,
              repository: SourceControlProvider.transportSafeSourceControlErrorValue(
                input.repository,
              ),
              detail: error.detail,
              cause: error,
            }),
        ),
      ),
    createRepository: (input) =>
      github.createRepository(input).pipe(
        Effect.mapError(
          (error) =>
            new SourceControlProviderError({
              provider: "github",
              operation: "createRepository",
              command: error.command,
              cwd: input.cwd,
              repository: SourceControlProvider.transportSafeSourceControlErrorValue(
                input.repository,
              ),
              detail: error.detail,
              cause: error,
            }),
        ),
      ),
    getDefaultBranch: (input) =>
      github.getDefaultBranch(input).pipe(
        Effect.mapError(
          (error) =>
            new SourceControlProviderError({
              provider: "github",
              operation: "getDefaultBranch",
              command: error.command,
              cwd: input.cwd,
              detail: error.detail,
              cause: error,
            }),
        ),
      ),
    checkoutChangeRequest: (input) =>
      github.checkoutPullRequest(input).pipe(
        Effect.mapError(
          (error) =>
            new SourceControlProviderError({
              provider: "github",
              operation: "checkoutChangeRequest",
              command: error.command,
              cwd: input.cwd,
              reference: SourceControlProvider.transportSafeSourceControlErrorValue(
                input.reference,
              ),
              detail: error.detail,
              cause: error,
            }),
        ),
      ),
  });
});

export const layer = Layer.effect(SourceControlProvider.SourceControlProvider, make);
