import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  GitCommandError,
  VcsUnsupportedOperationError,
  type ReviewDiffFileContentsInput,
  type ReviewDiffFileContentsResult,
  type ReviewDiffPreviewError,
  type ReviewDiffPreviewInput,
  type ReviewDiffPreviewResult,
  type ReviewSetFilesStagedInput,
} from "@t3tools/contracts";

import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";

export class ReviewService extends Context.Service<
  ReviewService,
  {
    readonly getDiffPreview: (
      input: ReviewDiffPreviewInput,
    ) => Effect.Effect<ReviewDiffPreviewResult, ReviewDiffPreviewError>;
    readonly getDiffFileContents: (
      input: ReviewDiffFileContentsInput,
    ) => Effect.Effect<ReviewDiffFileContentsResult, ReviewDiffPreviewError>;
    readonly setFilesStaged: (
      input: ReviewSetFilesStagedInput,
    ) => Effect.Effect<void, ReviewDiffPreviewError>;
  }
>()("t3/review/ReviewService") {}

export const make = Effect.gen(function* () {
  const vcsRegistry = yield* VcsDriverRegistry.VcsDriverRegistry;
  const git = yield* GitVcsDriver.GitVcsDriver;

  const getDiffPreview: ReviewService["Service"]["getDiffPreview"] = Effect.fn(
    "ReviewService.getDiffPreview",
  )(function* (input) {
    // Like other cwd-based Git operations, review targets the requested repository.
    // The server startup directory does not bound project locations.

    const handle = yield* vcsRegistry.detect({ cwd: input.cwd, requestedKind: "auto" });
    if (!handle) {
      return {
        cwd: input.cwd,
        generatedAt: yield* DateTime.now,
        sources: [],
      };
    }

    const getDriverDiffPreview = handle.driver.getDiffPreview;
    if (!getDriverDiffPreview) {
      if (handle.kind === "git") {
        return yield* git.getReviewDiffPreview(input);
      }
      return yield* new VcsUnsupportedOperationError({
        operation: "ReviewService.getDiffPreview",
        kind: handle.kind,
        detail: `The ${handle.kind} VCS driver does not support review diff previews.`,
      });
    }

    return yield* getDriverDiffPreview(input);
  });

  const getDiffFileContents: ReviewService["Service"]["getDiffFileContents"] = Effect.fn(
    "ReviewService.getDiffFileContents",
  )(function* (input) {
    const handle = yield* vcsRegistry.detect({ cwd: input.cwd, requestedKind: "auto" });
    if (handle?.kind !== "git") {
      return yield* new VcsUnsupportedOperationError({
        operation: "ReviewService.getDiffFileContents",
        kind: handle?.kind ?? "unknown",
        detail: "Unchanged diff expansion currently requires a Git repository.",
      });
    }

    return yield* git.getReviewDiffFileContents(input);
  });

  const setFilesStaged: ReviewService["Service"]["setFilesStaged"] = Effect.fn(
    "ReviewService.setFilesStaged",
  )(function* (input) {
    const operation = "ReviewService.setFilesStaged";
    const handle = yield* vcsRegistry.detect({ cwd: input.cwd, requestedKind: "auto" });
    if (handle?.kind !== "git") {
      return yield* new VcsUnsupportedOperationError({
        operation,
        kind: handle?.kind ?? "unknown",
        detail: "Staging files requires a Git repository.",
      });
    }

    const filePaths = [...new Set(input.filePaths)];
    if (
      filePaths.length === 0 ||
      filePaths.some(
        (filePath) =>
          !filePath ||
          filePath.includes("\0") ||
          filePath.startsWith("/") ||
          /^[A-Za-z]:[\\/]/.test(filePath) ||
          filePath.split("/").some((part) => part === ".." || part === "." || part === ""),
      )
    ) {
      return yield* new GitCommandError({
        operation,
        command: "git",
        cwd: input.cwd,
        detail: "Select repository-relative file paths to stage or unstage.",
      });
    }

    const entries = yield* git.execute({
      operation,
      cwd: handle.repository.rootPath,
      args: [
        "--literal-pathspecs",
        ...(input.staged
          ? ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]
          : ["diff", "--cached", "--name-only", "--no-renames", "-z"]),
        "--",
        ...filePaths,
      ],
    });
    const existing = new Set(entries.stdout.split("\0"));
    // A previously staged rename no longer has its old path in the index.
    // Ignore that obsolete path, and never expand a directory selection.
    const selectedFilePaths = filePaths.filter((filePath) => existing.has(filePath));
    if (selectedFilePaths.length === 0) return;

    // Reset only changes the index, including before the first commit. Literal
    // pathspecs preserve filenames containing brackets, stars, or leading colons.
    yield* git.execute({
      operation,
      cwd: handle.repository.rootPath,
      args: [
        "--literal-pathspecs",
        ...(input.staged ? ["add", "-A"] : ["reset", "--quiet"]),
        "--",
        ...selectedFilePaths,
      ],
    });
  });

  return ReviewService.of({
    getDiffPreview,
    getDiffFileContents,
    setFilesStaged,
  });
});

export const layer = Layer.effect(ReviewService, make);
