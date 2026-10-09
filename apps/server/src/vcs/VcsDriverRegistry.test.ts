import { assert, it, describe } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as VcsProcess from "./VcsProcess.ts";
import * as VcsProjectConfig from "./VcsProjectConfig.ts";
import * as VcsDriverRegistry from "./VcsDriverRegistry.ts";

const RealGitLayer = VcsProcess.layer.pipe(Layer.provideMerge(NodeServices.layer));

const processOutput = (stdout: string): VcsProcess.VcsProcessOutput => ({
  exitCode: ChildProcessSpawner.ExitCode(0),
  stdout,
  stderr: "",
  stdoutTruncated: false,
  stderrTruncated: false,
});

const normalizeGitArgs = (args: ReadonlyArray<string>): ReadonlyArray<string> =>
  args[0] === "-C" && args.length >= 2 ? args.slice(2) : args;

describe("VcsDriverRegistry", () => {
  it.effect("routes directly by VCS driver kind for non-repository workflows", () => {
    const layer = Layer.effect(VcsDriverRegistry.VcsDriverRegistry, VcsDriverRegistry.make).pipe(
      Layer.provide(NodeServices.layer),
      Layer.provide(
        Layer.mock(VcsProjectConfig.VcsProjectConfig)({
          resolveKind: (input) => Effect.succeed(input.requestedKind ?? "auto"),
        }),
      ),
      Layer.provide(
        Layer.mock(VcsProcess.VcsProcess)({
          run: () => Effect.succeed(processOutput("")),
        }),
      ),
    );

    return Effect.gen(function* () {
      const registry = yield* VcsDriverRegistry.VcsDriverRegistry;
      const driver = yield* registry.get("git");

      assert.strictEqual(driver.capabilities.kind, "git");
    }).pipe(Effect.provide(layer));
  });

  // Answers detection like git: the nearest folder at or above the cwd, up to
  // `rootDir`, that holds `.git` is the repository.
  const makeDiskBackedLayer = (rootDir: string, calls: string[]) =>
    Layer.effect(VcsDriverRegistry.VcsDriverRegistry, VcsDriverRegistry.make).pipe(
      Layer.provide(NodeServices.layer),
      Layer.provide(
        Layer.mock(VcsProjectConfig.VcsProjectConfig)({
          resolveKind: (input) => Effect.succeed(input.requestedKind ?? "auto"),
        }),
      ),
      Layer.provide(
        Layer.mock(VcsProcess.VcsProcess)({
          run: (input) =>
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem;
              const path = yield* Path.Path;
              const command = normalizeGitArgs(input.args).join(" ");
              calls.push(command);
              let repoDir: string | null = input.cwd;
              while (repoDir !== null && !(yield* fs.exists(path.join(repoDir, ".git")))) {
                repoDir = repoDir === rootDir ? null : path.dirname(repoDir);
              }
              if (repoDir === null) {
                return {
                  ...processOutput(""),
                  exitCode: ChildProcessSpawner.ExitCode(128),
                  stderr: "fatal: not a git repository",
                };
              }
              if (command === "rev-parse --is-inside-work-tree") return processOutput("true\n");
              if (command === "rev-parse --show-toplevel") return processOutput(`${repoDir}\n`);
              if (command === "rev-parse --git-common-dir") {
                return processOutput(`${path.relative(input.cwd, path.join(repoDir, ".git"))}\n`);
              }
              return processOutput("");
            }).pipe(Effect.provide(NodeServices.layer), Effect.orDie),
        }),
      ),
    );

  it.effect("caches repository detection for repeated resolves in the same cwd and kind", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const repoDir = yield* fs
        .makeTempDirectoryScoped({ prefix: "t3-vcs-registry-" })
        .pipe(Effect.flatMap((folder) => fs.realPath(folder)));
      yield* fs.makeDirectory(path.join(repoDir, ".git"));
      const calls: string[] = [];

      yield* Effect.gen(function* () {
        const registry = yield* VcsDriverRegistry.VcsDriverRegistry;
        const first = yield* registry.resolve({ cwd: repoDir, requestedKind: "git" });
        yield* TestClock.adjust("30 seconds");
        const second = yield* registry.resolve({ cwd: repoDir, requestedKind: "git" });

        assert.equal(first.repository.rootPath, repoDir);
        assert.equal(second.repository.rootPath, repoDir);
        assert.deepStrictEqual(calls, [
          "rev-parse --is-inside-work-tree",
          "rev-parse --show-toplevel",
          "rev-parse --git-common-dir",
        ]);
      }).pipe(Effect.provide(makeDiskBackedLayer(repoDir, calls)));
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "invalidates a linked worktree from a nested cwd when its root gitfile disappears",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const process = yield* VcsProcess.VcsProcess;
        const sandbox = yield* fs
          .makeTempDirectoryScoped({ prefix: "test-rig-vcs-linked-" })
          .pipe(Effect.flatMap((folder) => fs.realPath(folder)));
        const main = path.join(sandbox, "main");
        const worktree = path.join(sandbox, "worktree");
        yield* fs.makeDirectory(main);
        const git = (args: string[]) =>
          process.run({ cwd: main, command: "git", args, operation: "test" });
        yield* git(["init"]);
        yield* git([
          "-c",
          "user.name=Test",
          "-c",
          "user.email=test@example.com",
          "commit",
          "--allow-empty",
          "-m",
          "Initial",
        ]);
        yield* git(["worktree", "add", "-b", "linked", worktree]);
        const cwd = path.join(worktree, "src");
        yield* fs.makeDirectory(cwd);

        yield* Effect.gen(function* () {
          const registry = yield* VcsDriverRegistry.VcsDriverRegistry;
          const before = yield* registry.resolve({ cwd });
          assert.equal(before.repository.rootPath, yield* fs.realPath(worktree));
          yield* fs.remove(path.join(worktree, ".git"));
          assert.equal(yield* registry.detect({ cwd }), null);
        }).pipe(Effect.provide(VcsDriverRegistry.layer));
      }).pipe(Effect.provide(RealGitLayer)),
  );

  it.effect("invalidates a retargeted gitfile while both metadata directories still exist", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const process = yield* VcsProcess.VcsProcess;
      const sandbox = yield* fs
        .makeTempDirectoryScoped({ prefix: "test-rig-vcs-retarget-" })
        .pipe(Effect.flatMap((folder) => fs.realPath(folder)));
      const first = path.join(sandbox, "first");
      const second = path.join(sandbox, "second");
      const firstMetadata = path.join(sandbox, "metadata-first");
      const secondMetadata = path.join(sandbox, "metadata-second-longer");
      for (const [cwd, metadata] of [
        [first, firstMetadata],
        [second, secondMetadata],
      ] as const) {
        yield* fs.makeDirectory(cwd);
        yield* process.run({
          cwd,
          command: "git",
          args: ["init", "--separate-git-dir", metadata],
          operation: "test",
        });
      }
      const cwd = path.join(first, "src");
      yield* fs.makeDirectory(cwd);
      yield* Effect.gen(function* () {
        const registry = yield* VcsDriverRegistry.VcsDriverRegistry;
        const before = yield* registry.resolve({ cwd });
        assert.equal(before.repository.metadataPath, yield* fs.realPath(firstMetadata));
        yield* fs.copyFile(path.join(second, ".git"), path.join(first, ".git"));
        const after = yield* registry.resolve({ cwd });
        assert.equal(after.repository.metadataPath, yield* fs.realPath(secondMetadata));

        // Replacing external metadata also invalidates an unchanged root gitfile.
        const previousMetadata = path.join(sandbox, "previous-metadata");
        yield* fs.rename(secondMetadata, previousMetadata);
        yield* fs.copy(previousMetadata, secondMetadata);
        assert.notStrictEqual(yield* registry.resolve({ cwd }), after);
      }).pipe(Effect.provide(VcsDriverRegistry.layer));
    }).pipe(Effect.provide(RealGitLayer)),
  );

  it.effect("detects replacement of a cached repository's git directory", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const repoDir = yield* fs
        .makeTempDirectoryScoped({ prefix: "test-rig-vcs-replaced-" })
        .pipe(Effect.flatMap((folder) => fs.realPath(folder)));
      yield* fs.makeDirectory(path.join(repoDir, ".git"));
      const calls: string[] = [];
      yield* Effect.gen(function* () {
        const registry = yield* VcsDriverRegistry.VcsDriverRegistry;
        yield* registry.resolve({ cwd: repoDir });
        yield* fs.rename(path.join(repoDir, ".git"), path.join(repoDir, "old-git"));
        yield* fs.makeDirectory(path.join(repoDir, ".git"));
        yield* registry.resolve({ cwd: repoDir });
        assert.equal(calls.filter((call) => call === "rev-parse --is-inside-work-tree").length, 2);
      }).pipe(Effect.provide(makeDiskBackedLayer(repoDir, calls)));
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("detects intermediate git init and retargeting through a symlinked cwd", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const process = yield* VcsProcess.VcsProcess;
      const sandbox = yield* fs
        .makeTempDirectoryScoped({ prefix: "test-rig-vcs-symlink-" })
        .pipe(Effect.flatMap((folder) => fs.realPath(folder)));
      const repo = path.join(sandbox, "repo");
      const other = path.join(sandbox, "other");
      const alias = path.join(sandbox, "alias");
      const middle = path.join(repo, "packages");
      yield* fs.makeDirectory(path.join(middle, "app"), { recursive: true });
      yield* fs.makeDirectory(path.join(other, "packages", "app"), { recursive: true });
      const init = (cwd: string) =>
        process.run({ cwd, command: "git", args: ["init"], operation: "test" });
      yield* init(repo);
      yield* init(other);
      yield* fs.symlink(repo, alias);
      const cwd = path.join(alias, "packages", "app");
      yield* Effect.gen(function* () {
        const registry = yield* VcsDriverRegistry.VcsDriverRegistry;
        assert.equal(
          (yield* registry.resolve({ cwd })).repository.rootPath,
          yield* fs.realPath(repo),
        );
        yield* init(middle);
        assert.equal(
          (yield* registry.resolve({ cwd })).repository.rootPath,
          yield* fs.realPath(middle),
        );
        yield* fs.remove(alias);
        yield* fs.symlink(other, alias);
        assert.equal(
          (yield* registry.resolve({ cwd })).repository.rootPath,
          yield* fs.realPath(other),
        );
      }).pipe(Effect.provide(VcsDriverRegistry.layer));
    }).pipe(Effect.provide(RealGitLayer)),
  );

  it.effect("detects again when a cached repository is removed from disk", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const repoDir = yield* fs
        .makeTempDirectoryScoped({ prefix: "t3-vcs-registry-" })
        .pipe(Effect.flatMap((folder) => fs.realPath(folder)));
      yield* fs.makeDirectory(path.join(repoDir, ".git"));
      const calls: string[] = [];

      yield* Effect.gen(function* () {
        const registry = yield* VcsDriverRegistry.VcsDriverRegistry;
        assert.equal((yield* registry.detect({ cwd: repoDir }))?.repository.rootPath, repoDir);

        yield* fs.remove(path.join(repoDir, ".git"), { recursive: true });

        assert.equal(yield* registry.detect({ cwd: repoDir }), null);
        assert.equal(calls.filter((call) => call === "rev-parse --is-inside-work-tree").length, 2);
      }).pipe(Effect.provide(makeDiskBackedLayer(repoDir, calls)));
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("detects again when git init creates a repository inside a cached one", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const parentDir = yield* fs
        .makeTempDirectoryScoped({ prefix: "t3-vcs-registry-" })
        .pipe(Effect.flatMap((folder) => fs.realPath(folder)));
      const projectDir = path.join(parentDir, "project");
      yield* fs.makeDirectory(path.join(parentDir, ".git"));
      yield* fs.makeDirectory(projectDir);
      const calls: string[] = [];

      yield* Effect.gen(function* () {
        const registry = yield* VcsDriverRegistry.VcsDriverRegistry;
        assert.equal((yield* registry.detect({ cwd: projectDir }))?.repository.rootPath, parentDir);

        yield* fs.makeDirectory(path.join(projectDir, ".git"));

        assert.equal(
          (yield* registry.detect({ cwd: projectDir }))?.repository.rootPath,
          projectDir,
        );
      }).pipe(Effect.provide(makeDiskBackedLayer(parentDir, calls)));
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("detects again when git init creates a repository between the cwd and its root", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const parentDir = yield* fs
        .makeTempDirectoryScoped({ prefix: "t3-vcs-registry-" })
        .pipe(Effect.flatMap((folder) => fs.realPath(folder)));
      const middleDir = path.join(parentDir, "a");
      const cwd = path.join(middleDir, "b");
      yield* fs.makeDirectory(path.join(parentDir, ".git"));
      yield* fs.makeDirectory(cwd, { recursive: true });
      const calls: string[] = [];

      yield* Effect.gen(function* () {
        const registry = yield* VcsDriverRegistry.VcsDriverRegistry;
        assert.equal((yield* registry.detect({ cwd }))?.repository.rootPath, parentDir);

        yield* fs.makeDirectory(path.join(middleDir, ".git"));

        assert.equal((yield* registry.detect({ cwd }))?.repository.rootPath, middleDir);
      }).pipe(Effect.provide(makeDiskBackedLayer(parentDir, calls)));
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("detects a repository created after a negative lookup", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const repoDir = yield* fs
        .makeTempDirectoryScoped({ prefix: "t3-vcs-registry-" })
        .pipe(Effect.flatMap((folder) => fs.realPath(folder)));
      const calls: string[] = [];

      yield* Effect.gen(function* () {
        const registry = yield* VcsDriverRegistry.VcsDriverRegistry;
        assert.equal(yield* registry.detect({ cwd: repoDir }), null);

        yield* fs.makeDirectory(path.join(repoDir, ".git"));

        assert.equal((yield* registry.detect({ cwd: repoDir }))?.repository.rootPath, repoDir);
        assert.equal(calls.filter((call) => call === "rev-parse --is-inside-work-tree").length, 2);
      }).pipe(Effect.provide(makeDiskBackedLayer(repoDir, calls)));
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
