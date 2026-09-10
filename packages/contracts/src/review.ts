import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { GitCommandError } from "./git.ts";
import { VcsError } from "./vcs.ts";

export const ReviewDiffPreviewSourceKind = Schema.Literals([
  "working-tree",
  "unstaged",
  "staged",
  "branch-range",
  "commit",
]);
export type ReviewDiffPreviewSourceKind = typeof ReviewDiffPreviewSourceKind.Type;

export const ReviewDiffPreviewInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  baseRef: Schema.optional(TrimmedNonEmptyString),
  commitRef: Schema.optionalKey(TrimmedNonEmptyString),
  ignoreWhitespace: Schema.optionalKey(Schema.Boolean),
  sourceKind: Schema.optionalKey(ReviewDiffPreviewSourceKind),
  filePath: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty())),
  includePatch: Schema.optionalKey(Schema.Boolean),
});
export type ReviewDiffPreviewInput = typeof ReviewDiffPreviewInput.Type;

export const ReviewSetFilesStagedInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  filePaths: Schema.NonEmptyArray(Schema.String.check(Schema.isNonEmpty())),
  staged: Schema.Boolean,
});
export type ReviewSetFilesStagedInput = typeof ReviewSetFilesStagedInput.Type;

export const ReviewDiffFile = Schema.Struct({
  path: Schema.String,
  oldPath: Schema.optionalKey(Schema.String),
  status: Schema.Literals(["added", "modified", "deleted", "renamed", "copied", "unmerged"]),
  additions: Schema.Number,
  deletions: Schema.Number,
  binary: Schema.Boolean,
});
export type ReviewDiffFile = typeof ReviewDiffFile.Type;

export const ReviewDiffPreviewSource = Schema.Struct({
  id: TrimmedNonEmptyString,
  kind: ReviewDiffPreviewSourceKind,
  title: TrimmedNonEmptyString,
  baseRef: Schema.NullOr(TrimmedNonEmptyString),
  headRef: Schema.NullOr(TrimmedNonEmptyString),
  mergeBaseRef: Schema.optionalKey(TrimmedNonEmptyString),
  diff: Schema.String,
  diffHash: TrimmedNonEmptyString,
  truncated: Schema.Boolean,
  files: Schema.optionalKey(Schema.Array(ReviewDiffFile)),
});
export type ReviewDiffPreviewSource = typeof ReviewDiffPreviewSource.Type;

export const ReviewDiffFileContentsInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  sourceKind: ReviewDiffPreviewSourceKind,
  changeType: Schema.Literals(["change", "rename-pure", "rename-changed", "new", "deleted"]),
  baseRef: Schema.NullOr(TrimmedNonEmptyString),
  headRef: Schema.NullOr(TrimmedNonEmptyString),
  oldPath: Schema.String.check(Schema.isNonEmpty()),
  newPath: Schema.String.check(Schema.isNonEmpty()),
});
export type ReviewDiffFileContentsInput = typeof ReviewDiffFileContentsInput.Type;

export const ReviewDiffFileContentsResult = Schema.Struct({
  oldContents: Schema.String,
  newContents: Schema.String,
});
export type ReviewDiffFileContentsResult = typeof ReviewDiffFileContentsResult.Type;

export const ReviewDiffPreviewResult = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  generatedAt: Schema.DateTimeUtc,
  sources: Schema.Array(ReviewDiffPreviewSource),
  commits: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        sha: TrimmedNonEmptyString,
        subject: Schema.String,
      }),
    ),
  ),
});
export type ReviewDiffPreviewResult = typeof ReviewDiffPreviewResult.Type;

export const ReviewDiffPreviewError = Schema.Union([VcsError, GitCommandError]);
export type ReviewDiffPreviewError = typeof ReviewDiffPreviewError.Type;
