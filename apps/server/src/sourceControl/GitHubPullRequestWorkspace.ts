import { Context, Effect, Layer, Schema } from "effect";
import {
  GitPullRequestWorkspaceError,
  type GitListPullRequestsInput,
  type GitListPullRequestsResult,
  type GitGetPullRequestDetailsInput,
  type GitGetPullRequestDetailsResult,
  type GitPullRequestSummary,
} from "@t3tools/contracts";
import { GitHubCli } from "./GitHubCli.ts";
import { SourceControlProviderRegistry } from "./SourceControlProviderRegistry.ts";
import { ServerSettingsService } from "../serverSettings.ts";

const LIMIT = 100;
const User = Schema.NullOr(Schema.Struct({ login: Schema.String }));
const Label = Schema.Struct({ name: Schema.String });
const RawSummary = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  url: Schema.String,
  state: Schema.Literals(["OPEN", "CLOSED", "MERGED"]),
  isDraft: Schema.Boolean,
  author: User,
  baseRefName: Schema.String,
  headRefName: Schema.String,
  headRefOid: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  additions: Schema.Int,
  deletions: Schema.Int,
  changedFiles: Schema.Int,
  labels: Schema.Array(Label),
});
const RawPullRequest = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  html_url: Schema.String,
  state: Schema.Literals(["open", "closed"]),
  merged: Schema.Boolean,
  draft: Schema.Boolean,
  user: User,
  body: Schema.NullOr(Schema.String),
  base: Schema.Struct({ ref: Schema.String, sha: Schema.String }),
  head: Schema.Struct({ ref: Schema.String, sha: Schema.String }),
  created_at: Schema.String,
  updated_at: Schema.String,
  additions: Schema.Int,
  deletions: Schema.Int,
  changed_files: Schema.Int,
  labels: Schema.Array(Label),
});
const RawFile = Schema.Struct({
  filename: Schema.String,
  previous_filename: Schema.optional(Schema.String),
  status: Schema.String,
  additions: Schema.Int,
  deletions: Schema.Int,
  patch: Schema.optional(Schema.String),
});
const RawChecks = Schema.Struct({
  total_count: Schema.Int,
  check_runs: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      status: Schema.String,
      conclusion: Schema.NullOr(Schema.String),
      html_url: Schema.NullOr(Schema.String),
    }),
  ),
});
const RawStatuses = Schema.Struct({
  total_count: Schema.Int,
  statuses: Schema.Array(
    Schema.Struct({
      context: Schema.String,
      state: Schema.String,
      target_url: Schema.NullOr(Schema.String),
    }),
  ),
});
const fields =
  "number,title,url,state,isDraft,author,baseRefName,headRefName,headRefOid,createdAt,updatedAt,additions,deletions,changedFiles,labels";
const failure = (message: string) => new GitPullRequestWorkspaceError({ message });
const author = (user: typeof User.Type) => user?.login ?? "deleted user";

export class GitHubPullRequestWorkspace extends Context.Service<
  GitHubPullRequestWorkspace,
  {
    readonly listPullRequests: (
      input: GitListPullRequestsInput,
    ) => Effect.Effect<GitListPullRequestsResult, GitPullRequestWorkspaceError>;
    readonly getPullRequestDetails: (
      input: GitGetPullRequestDetailsInput,
    ) => Effect.Effect<GitGetPullRequestDetailsResult, GitPullRequestWorkspaceError>;
  }
>()("t3/sourceControl/GitHubPullRequestWorkspace") {}

export const make = Effect.gen(function* () {
  const gh = yield* GitHubCli;
  const registry = yield* SourceControlProviderRegistry;
  const settings = yield* ServerSettingsService;
  const repositoryFor = Effect.fn("GitHubPullRequestWorkspace.repositoryFor")(function* (
    cwd: string,
  ) {
    const config = yield* settings.getSettings.pipe(
      Effect.mapError(() => failure("Could not read integration settings.")),
    );
    if (!config.sourceControlProviders.github)
      return yield* failure(
        "GitHub integration is disabled. Enable it in Settings to browse pull requests.",
      );
    const handle = yield* registry
      .resolveHandle({ cwd })
      .pipe(
        Effect.mapError(() => failure("Could not detect this repository's source-control host.")),
      );
    if (!handle.enabled || handle.context?.provider.kind !== "github")
      return yield* failure(
        "Pull request browsing requires a repository with an enabled GitHub remote.",
      );
    const remote = handle.context.remoteUrl;
    const path = remote.startsWith("git@")
      ? remote.replace(/^git@[^:]+:/, "")
      : (() => {
          try {
            return new URL(remote).pathname;
          } catch {
            return "";
          }
        })();
    const name = path.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
    if (!/^[\w.-]+\/[\w.-]+$/.test(name))
      return yield* failure("Could not identify the GitHub repository from its remote URL.");
    const host = new URL(handle.context.provider.baseUrl).host;
    return { name, host, url: `https://${host}/${name}` };
  });
  const json = <A>(cwd: string, args: ReadonlyArray<string>, schema: Schema.Codec<A>) =>
    gh.execute({ cwd, args }).pipe(
      Effect.mapError((error) => failure(error.detail)),
      Effect.flatMap((result) =>
        result.stdoutTruncated
          ? Effect.fail(
              failure(
                "GitHub response exceeded the size limit. Open this pull request on GitHub to see the complete content.",
              ),
            )
          : Schema.decodeEffect(Schema.fromJsonString(schema))(result.stdout).pipe(
              Effect.mapError(() =>
                failure(
                  "GitHub returned an invalid response. Refresh to retry, or update GitHub CLI.",
                ),
              ),
            ),
      ),
    );
  const api = <A>(
    cwd: string,
    repo: { name: string; host: string },
    endpoint: string,
    schema: Schema.Codec<A>,
  ) => json(cwd, ["api", "--hostname", repo.host, `repos/${repo.name}/${endpoint}`], schema);

  const listPullRequests = Effect.fn("GitHubPullRequestWorkspace.listPullRequests")(function* (
    input: GitListPullRequestsInput,
  ) {
    const repo = yield* repositoryFor(input.cwd);
    const rows = yield* json(
      input.cwd,
      [
        "pr",
        "list",
        "--repo",
        repo.url,
        "--state",
        input.state,
        "--limit",
        String(LIMIT + 1),
        "--json",
        fields,
        ...(input.involvement === "authored"
          ? ["--author", "@me"]
          : input.involvement === "review-requested"
            ? ["--search", "review-requested:@me"]
            : []),
      ],
      Schema.Array(RawSummary),
    );
    return {
      repository: repo.url,
      truncated: rows.length > LIMIT,
      pullRequests: rows.slice(0, LIMIT).map(
        (row): GitPullRequestSummary => ({
          ...row,
          state: row.state === "OPEN" ? "open" : row.state === "MERGED" ? "merged" : "closed",
          author: author(row.author),
          headSha: row.headRefOid,
          labels: row.labels.map((label) => label.name),
        }),
      ),
    };
  });
  const getPullRequestDetails = Effect.fn("GitHubPullRequestWorkspace.getPullRequestDetails")(
    function* (input: GitGetPullRequestDetailsInput) {
      const repo = yield* repositoryFor(input.cwd);
      let reference = input.reference.trim().replace(/^#/, "");
      if (!/^\d+$/.test(reference)) {
        let url: URL;
        try {
          url = new URL(reference);
        } catch {
          return yield* failure("Enter a pull request number or a URL from this repository.");
        }
        const match = url.pathname.match(/^\/([^/]+\/[^/]+)\/pull\/(\d+)\/?$/);
        if (
          url.protocol !== "https:" ||
          url.host !== repo.host ||
          match?.[1]?.toLowerCase() !== repo.name.toLowerCase()
        )
          return yield* failure(
            "The pull request URL must belong to this project's GitHub repository.",
          );
        reference = match[2]!;
      }
      if (!Number.isSafeInteger(Number(reference)) || Number(reference) < 1)
        return yield* failure("Enter a valid pull request number.");
      const raw = yield* api(input.cwd, repo, `pulls/${reference}`, RawPullRequest);
      // Collection requests are bounded; omitted files and check results are reported below.
      const [files, checks, statuses] = yield* Effect.all(
        [
          api(input.cwd, repo, `pulls/${reference}/files?per_page=${LIMIT}`, Schema.Array(RawFile)),
          api(input.cwd, repo, `commits/${raw.head.sha}/check-runs?per_page=${LIMIT}`, RawChecks),
          api(input.cwd, repo, `commits/${raw.head.sha}/status?per_page=${LIMIT}`, RawStatuses),
        ],
        { concurrency: 4 },
      );
      const latest = yield* api(input.cwd, repo, `pulls/${reference}`, RawPullRequest);
      if (latest.head.sha !== raw.head.sha || latest.base.sha !== raw.base.sha)
        return yield* failure(
          "The pull request changed while loading. Refresh to load its latest revision.",
        );
      return {
        repository: repo.url,
        pullRequest: {
          number: raw.number,
          title: raw.title,
          url: raw.html_url,
          state: raw.merged ? "merged" : raw.state,
          isDraft: raw.draft,
          author: author(raw.user),
          baseRefName: raw.base.ref,
          headRefName: raw.head.ref,
          headSha: raw.head.sha,
          createdAt: raw.created_at,
          updatedAt: raw.updated_at,
          additions: raw.additions,
          deletions: raw.deletions,
          changedFiles: raw.changed_files,
          labels: raw.labels.map((label) => label.name),
        },
        body: raw.body ?? "",
        checks: [
          ...checks.check_runs.map((check) => ({
            name: check.name,
            status: check.status,
            conclusion: check.conclusion,
            url: check.html_url,
          })),
          ...statuses.statuses.map((status) => ({
            name: status.context,
            status: status.state === "pending" ? "pending" : "completed",
            conclusion: status.state === "pending" ? null : status.state,
            url: status.target_url,
          })),
        ],
        // Retain the wire field; activity is not loaded by the Summary view.
        timeline: [],
        files: files.map((file) => ({
          path: file.filename,
          previousPath: file.previous_filename ?? null,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
          patch: file.patch ?? null,
        })),
        truncated:
          raw.changed_files > files.length ||
          checks.total_count > checks.check_runs.length ||
          statuses.total_count > statuses.statuses.length,
      } satisfies GitGetPullRequestDetailsResult;
    },
  );
  return GitHubPullRequestWorkspace.of({ listPullRequests, getPullRequestDetails });
});
export const layer = Layer.effect(GitHubPullRequestWorkspace, make);
