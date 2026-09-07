import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const GitListPullRequestsInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  state: Schema.Literals(["open", "closed", "merged", "all"]),
  involvement: Schema.Literals(["all", "authored", "review-requested"]),
});
export type GitListPullRequestsInput = typeof GitListPullRequestsInput.Type;
export const GitGetPullRequestDetailsInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  reference: TrimmedNonEmptyString,
});
export type GitGetPullRequestDetailsInput = typeof GitGetPullRequestDetailsInput.Type;
export const GitPullRequestSummary = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  url: Schema.String,
  state: Schema.Literals(["open", "closed", "merged"]),
  isDraft: Schema.Boolean,
  author: Schema.String,
  baseRefName: Schema.String,
  headRefName: Schema.String,
  headSha: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  additions: Schema.Int,
  deletions: Schema.Int,
  changedFiles: Schema.Int,
  labels: Schema.Array(Schema.String),
});
export type GitPullRequestSummary = typeof GitPullRequestSummary.Type;
export const GitListPullRequestsResult = Schema.Struct({
  repository: Schema.String,
  pullRequests: Schema.Array(GitPullRequestSummary),
  truncated: Schema.Boolean,
});
export type GitListPullRequestsResult = typeof GitListPullRequestsResult.Type;
export const GitPullRequestCheck = Schema.Struct({
  name: Schema.String,
  status: Schema.String,
  conclusion: Schema.NullOr(Schema.String),
  url: Schema.NullOr(Schema.String),
});
export const GitPullRequestTimelineEntry = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["comment", "review", "review-comment"]),
  author: Schema.String,
  body: Schema.String,
  createdAt: Schema.String,
  url: Schema.String,
  state: Schema.NullOr(Schema.String),
  path: Schema.NullOr(Schema.String),
  line: Schema.NullOr(Schema.Int),
  side: Schema.NullOr(Schema.Literals(["LEFT", "RIGHT"])),
});
export type GitPullRequestTimelineEntry = typeof GitPullRequestTimelineEntry.Type;
export const GitPullRequestFile = Schema.Struct({
  path: Schema.String,
  previousPath: Schema.NullOr(Schema.String),
  status: Schema.String,
  additions: Schema.Int,
  deletions: Schema.Int,
  patch: Schema.NullOr(Schema.String),
});
export type GitPullRequestFile = typeof GitPullRequestFile.Type;
export const GitGetPullRequestDetailsResult = Schema.Struct({
  repository: Schema.String,
  pullRequest: GitPullRequestSummary,
  body: Schema.String,
  checks: Schema.Array(GitPullRequestCheck),
  timeline: Schema.Array(GitPullRequestTimelineEntry),
  files: Schema.Array(GitPullRequestFile),
  truncated: Schema.Boolean,
});
export type GitGetPullRequestDetailsResult = typeof GitGetPullRequestDetailsResult.Type;
export class GitPullRequestWorkspaceError extends Schema.TaggedErrorClass<GitPullRequestWorkspaceError>()(
  "GitPullRequestWorkspaceError",
  { message: Schema.String },
) {}
