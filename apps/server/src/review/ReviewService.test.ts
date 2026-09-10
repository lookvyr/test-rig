import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { VcsRepositoryDetectionError } from "@t3tools/contracts";
import { ServerConfig } from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as ReviewService from "./ReviewService.ts";

const makeLayer = (workspaceRoot: string, baseDir: string) =>
  ReviewService.layer.pipe(
    Layer.provide(VcsDriverRegistry.layer),
    Layer.provideMerge(GitVcsDriver.layer),
    Layer.provide(VcsProcess.layer),
    Layer.provide(ServerConfig.layerTest(workspaceRoot, baseDir)),
    Layer.provideMerge(NodeServices.layer),
  );

const git = Effect.fn("ReviewService.test.git")(function* (
  cwd: string,
  args: ReadonlyArray<string>,
) {
  const driver = yield* GitVcsDriver.GitVcsDriver;
  return yield* driver.execute({ operation: "ReviewService.test.git", cwd, args });
});

const makeFixturePaths = Effect.fn("ReviewService.test.makeFixturePaths")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "test-rig-review-" });
  const startup = path.join(root, "test-rig-checkout");
  const project = path.join(root, "project");
  const baseDir = path.join(root, "state");
  yield* fs.makeDirectory(startup);
  yield* fs.makeDirectory(project);
  return { startup, project, baseDir };
});

const seedRepositories = Effect.fn("ReviewService.test.seedRepositories")(function* (
  startup: string,
  project: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  for (const cwd of [startup, project]) {
    yield* git(cwd, ["init", "-b", "main"]);
    yield* git(cwd, ["config", "user.name", "Review test"]);
    yield* git(cwd, ["config", "user.email", "review@example.invalid"]);
    yield* fs.writeFileString(path.join(cwd, "tracked.txt"), "baseline\n");
    yield* git(cwd, ["add", "."]);
    yield* git(cwd, ["-c", "commit.gpgsign=false", "commit", "-m", "baseline"]);
  }
  yield* fs.writeFileString(path.join(startup, "startup-only.txt"), "unrelated change\n");
  yield* git(project, ["checkout", "-b", "feature"]);
  yield* fs.writeFileString(path.join(project, "tracked.txt"), "committed project change\n");
  yield* git(project, ["-c", "commit.gpgsign=false", "commit", "-am", "feature"]);
  yield* fs.writeFileString(path.join(project, "staged.txt"), "staged project change\n");
  yield* git(project, ["add", "staged.txt"]);
  yield* fs.writeFileString(path.join(project, "tracked.txt"), "unstaged project change\n");
  yield* fs.writeFileString(path.join(project, "untracked.txt"), "untracked project change\n");
});

describe("ReviewService", () => {
  it.effect(
    "stages selected files and unstages without changing working files or other staged work",
    () =>
      Effect.gen(function* () {
        const { startup, project, baseDir } = yield* makeFixturePaths();
        yield* Effect.gen(function* () {
          yield* seedRepositories(startup, project);
          const review = yield* ReviewService.ReviewService;
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          yield* review.setFilesStaged({ cwd: project, filePaths: ["tracked.txt"], staged: true });
          assert.equal(
            (yield* git(project, ["show", ":tracked.txt"])).stdout,
            "unstaged project change\n",
          );
          yield* fs.writeFileString(path.join(project, "tracked.txt"), "newer unstaged work\n");
          yield* review.setFilesStaged({ cwd: project, filePaths: ["tracked.txt"], staged: false });
          assert.equal(
            (yield* git(project, ["show", ":tracked.txt"])).stdout,
            "committed project change\n",
          );
          assert.equal(
            yield* fs.readFileString(path.join(project, "tracked.txt")),
            "newer unstaged work\n",
          );
          assert.equal(
            (yield* git(project, ["diff", "--cached", "--name-only"])).stdout,
            "staged.txt\n",
          );
          assert.equal((yield* git(startup, ["diff", "--cached", "--name-only"])).stdout, "");
        }).pipe(Effect.provide(makeLayer(startup, baseDir)));
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("stages literal filenames, additions, deletions, and both sides of a rename", () =>
    Effect.gen(function* () {
      const { startup, project, baseDir } = yield* makeFixturePaths();
      yield* Effect.gen(function* () {
        yield* seedRepositories(startup, project);
        const review = yield* ReviewService.ReviewService;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* fs.writeFileString(path.join(project, "[a].txt"), "literal\n");
        yield* fs.writeFileString(path.join(project, "a.txt"), "do not stage\n");
        yield* fs.writeFileString(path.join(project, ":(glob)*"), "also literal\n");
        yield* review.setFilesStaged({
          cwd: project,
          filePaths: ["[a].txt", ":(glob)*"],
          staged: true,
        });
        assert.include((yield* git(project, ["ls-files", "-z"])).stdout, "[a].txt\0");
        assert.notInclude((yield* git(project, ["ls-files", "-z"])).stdout, "\0a.txt\0");
        yield* fs.rename(path.join(project, "tracked.txt"), path.join(project, "renamed.txt"));
        yield* review.setFilesStaged({
          cwd: project,
          filePaths: ["tracked.txt", "renamed.txt"],
          staged: true,
        });
        yield* review.setFilesStaged({
          cwd: project,
          filePaths: ["tracked.txt", "renamed.txt"],
          staged: true,
        });
        assert.equal(
          (yield* git(project, ["show", ":renamed.txt"])).stdout,
          "unstaged project change\n",
        );
        assert.notInclude((yield* git(project, ["ls-files", "-z"])).stdout, "tracked.txt\0");
        yield* review.setFilesStaged({
          cwd: project,
          filePaths: ["tracked.txt", "renamed.txt"],
          staged: false,
        });
        assert.equal(
          (yield* git(project, ["show", ":tracked.txt"])).stdout,
          "committed project change\n",
        );
        assert.equal(
          yield* fs.readFileString(path.join(project, "renamed.txt")),
          "unstaged project change\n",
        );
      }).pipe(Effect.provide(makeLayer(startup, baseDir)));
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "unstages additions before the first commit while preserving newer working contents",
    () =>
      Effect.gen(function* () {
        const { startup, project, baseDir } = yield* makeFixturePaths();
        yield* Effect.gen(function* () {
          const review = yield* ReviewService.ReviewService;
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          yield* git(project, ["init"]);
          yield* fs.writeFileString(path.join(project, "new.txt"), "initial\n");
          yield* review.setFilesStaged({ cwd: project, filePaths: ["new.txt"], staged: true });
          yield* fs.writeFileString(path.join(project, "new.txt"), "newer\n");
          yield* review.setFilesStaged({ cwd: project, filePaths: ["new.txt"], staged: false });
          assert.equal((yield* git(project, ["ls-files"])).stdout, "");
          assert.equal(yield* fs.readFileString(path.join(project, "new.txt")), "newer\n");
        }).pipe(Effect.provide(makeLayer(startup, baseDir)));
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("rejects whole-repository and escaping paths before changing the index", () =>
    Effect.gen(function* () {
      const { startup, project, baseDir } = yield* makeFixturePaths();
      yield* Effect.gen(function* () {
        yield* seedRepositories(startup, project);
        const review = yield* ReviewService.ReviewService;
        for (const filePath of [
          ".",
          "../tracked.txt",
          "/tracked.txt",
          "dir/../tracked.txt",
          "file\0name",
        ]) {
          const error = yield* review
            .setFilesStaged({ cwd: project, filePaths: [filePath], staged: true })
            .pipe(Effect.flip);
          assert.equal(error._tag, "GitCommandError");
        }
        assert.equal(
          (yield* git(project, ["diff", "--cached", "--name-only"])).stdout,
          "staged.txt\n",
        );
      }).pipe(Effect.provide(makeLayer(startup, baseDir)));
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "reads working-tree and branch diffs from a project outside the server startup directory",
    () =>
      Effect.gen(function* () {
        const { startup, project, baseDir } = yield* makeFixturePaths();
        yield* Effect.gen(function* () {
          yield* seedRepositories(startup, project);
          const review = yield* ReviewService.ReviewService;
          const preview = yield* review.getDiffPreview({ cwd: project, baseRef: "main" });
          assert.equal(preview.cwd, project);
          const working = preview.sources.find((source) => source.kind === "working-tree");
          const branch = preview.sources.find((source) => source.kind === "branch-range");
          assert.include(working?.diff ?? "", "+unstaged project change");
          assert.include(working?.diff ?? "", "+staged project change");
          assert.include(working?.diff ?? "", "+untracked project change");
          assert.include(branch?.diff ?? "", "+committed project change");
          assert.equal(branch?.baseRef, "main");
          assert.equal(branch?.headRef, (yield* git(project, ["rev-parse", "HEAD"])).stdout.trim());
          assert.notInclude(branch?.diff ?? "", "unstaged project change");
          for (const source of preview.sources) assert.notInclude(source.diff, "startup-only.txt");
        }).pipe(Effect.provide(makeLayer(startup, baseDir)));
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("expands both diff sources using files from the requested external project", () =>
    Effect.gen(function* () {
      const { startup, project, baseDir } = yield* makeFixturePaths();
      yield* Effect.gen(function* () {
        yield* seedRepositories(startup, project);
        const review = yield* ReviewService.ReviewService;
        const working = yield* review.getDiffFileContents({
          cwd: project,
          sourceKind: "working-tree",
          changeType: "change",
          baseRef: "HEAD",
          headRef: null,
          oldPath: "tracked.txt",
          newPath: "tracked.txt",
        });
        assert.deepStrictEqual(working, {
          oldContents: "committed project change\n",
          newContents: "unstaged project change\n",
        });
        const branch = yield* review.getDiffFileContents({
          cwd: project,
          sourceKind: "branch-range",
          changeType: "change",
          baseRef: "main",
          headRef: "feature",
          oldPath: "tracked.txt",
          newPath: "tracked.txt",
        });
        assert.deepStrictEqual(branch, {
          oldContents: "baseline\n",
          newContents: "committed project change\n",
        });
      }).pipe(Effect.provide(makeLayer(startup, baseDir)));
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "returns no sources for a non-repository without substituting the startup repository",
    () =>
      Effect.gen(function* () {
        const { startup, project, baseDir } = yield* makeFixturePaths();
        yield* Effect.gen(function* () {
          yield* git(startup, ["init"]);
          const review = yield* ReviewService.ReviewService;
          const preview = yield* review.getDiffPreview({ cwd: project });
          assert.equal(preview.cwd, project);
          assert.deepStrictEqual(preview.sources, []);
        }).pipe(Effect.provide(makeLayer(startup, baseDir)));
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("preserves detection failures for the requested repository", () => {
    const cwd = "/projects/unavailable";
    const failure = new VcsRepositoryDetectionError({
      operation: "detectRepository",
      cwd,
      detail: "Repository is unavailable",
    });
    const calls: string[] = [];
    return Effect.gen(function* () {
      const review = yield* ReviewService.ReviewService;
      const error = yield* review.getDiffPreview({ cwd }).pipe(Effect.flip);
      assert.strictEqual(error, failure);
      assert.deepStrictEqual(calls, [cwd]);
    }).pipe(
      Effect.provide(
        ReviewService.layer.pipe(
          Layer.provide(
            Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
              detect: (input) => {
                calls.push(input.cwd);
                return Effect.fail(failure);
              },
            }),
          ),
          Layer.provide(Layer.mock(GitVcsDriver.GitVcsDriver)({})),
        ),
      ),
    );
  });
});
