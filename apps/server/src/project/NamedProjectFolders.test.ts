import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { GitCommandError, type Project } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as Option from "effect/Option";
import * as ServerConfig from "../config.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ProjectService from "./ProjectService.ts";
import { makeNamedProjectFolders } from "./NamedProjectFolders.ts";

const withFolders = <A, E>(
  body: (
    folders: Effect.Success<typeof makeNamedProjectFolders>,
    baseDir: string,
  ) => Effect.Effect<A, E, FileSystem.FileSystem>,
  options?: {
    commitFailure?: boolean;
    initFailure?: boolean;
    createFailure?: boolean;
    owned?: boolean;
  },
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "test-rig-named-project-" });
    const process = yield* VcsProcess.VcsProcess;
    const git = Layer.mock(GitVcsDriver.GitVcsDriver)({
      readConfigValue: () => Effect.succeed("main"),
      execute: (input) => {
        if (options?.initFailure && input.args[0] === "init")
          return Effect.fail(
            new GitCommandError({
              operation: input.operation,
              command: "git",
              cwd: input.cwd,
              detail: "test init failure",
            }),
          );
        if (options?.commitFailure && input.args[0] === "commit")
          return Effect.succeed({
            exitCode: ChildProcessSpawner.ExitCode(128),
            stdout: "",
            stderr: "Author identity unknown",
            stdoutTruncated: false,
            stderrTruncated: false,
          });
        return process
          .run({
            operation: input.operation,
            cwd: input.cwd,
            args: input.args,
            ...(input.allowNonZeroExit === undefined
              ? {}
              : { allowNonZeroExit: input.allowNonZeroExit }),
            command: "git",
            env: {
              GIT_CONFIG_GLOBAL: "/dev/null",
              GIT_CONFIG_NOSYSTEM: "1",
              GIT_AUTHOR_NAME: "Test Rig",
              GIT_AUTHOR_EMAIL: "test@example.invalid",
              GIT_COMMITTER_NAME: "Test Rig",
              GIT_COMMITTER_EMAIL: "test@example.invalid",
            },
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new GitCommandError({
                  operation: input.operation,
                  command: "git",
                  cwd: input.cwd,
                  detail: cause.message,
                  cause,
                }),
            ),
          );
      },
    });
    const project = Layer.mock(ProjectService.ProjectService)({
      create: (input) =>
        options?.createFailure
          ? Effect.fail(
              new ProjectService.ProjectOperationError({
                operation: "dispatch-project-command",
                cause: "test create failure",
              }),
            )
          : Effect.succeed({ id: input.projectId } as Project),
      getByWorkspaceRoot: () =>
        Effect.succeed(options?.owned ? Option.some({ id: "owner" } as Project) : Option.none()),
    });
    return yield* makeNamedProjectFolders.pipe(
      Effect.flatMap((folders) => body(folders, baseDir)),
      Effect.provide(Layer.mergeAll(git, project, ServerConfig.layerTest(baseDir, baseDir))),
    );
  }).pipe(
    Effect.scoped,
    Effect.provide(
      VcsProcess.layer.pipe(
        Layer.provide(ProcessRunner.layer),
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
  );

it.effect("creates a local repository with starter files and a first commit", () =>
  withFolders((folders, baseDir) =>
    Effect.gen(function* () {
      const result = yield* folders.createNamedProject({ name: "Pinball Stats" });
      const fs = yield* FileSystem.FileSystem;
      assert.equal(result.workspaceRoot, `${baseDir}/projects/pinball-stats`);
      assert.isUndefined(result.commitError);
      assert.include(
        yield* fs.readFileString(`${result.workspaceRoot}/README.md`),
        "# Pinball Stats",
      );
      assert.include(
        yield* fs.readFileString(`${result.workspaceRoot}/assets/icon.svg`),
        ">PS</text>",
      );
      assert.isTrue(yield* fs.exists(`${result.workspaceRoot}/.git/refs/heads/main`));
      assert.isFalse(yield* fs.exists(`${result.workspaceRoot}/.git/config.lock`));
    }),
  ),
);

it.effect("concurrent names claim separate folders without modifying an existing folder", () =>
  withFolders((folders) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      yield* fs.makeDirectory(folders.namedProjectsRoot, { recursive: true });
      yield* fs.makeDirectory(`${folders.namedProjectsRoot}/pinball`);
      yield* fs.writeFileString(`${folders.namedProjectsRoot}/pinball/keep`, "existing");
      const results = yield* Effect.all(
        [
          folders.createNamedProject({ name: "Pinball" }),
          folders.createNamedProject({ name: "Pinball" }),
        ],
        { concurrency: 2 },
      );
      assert.deepEqual(results.map((result) => result.workspaceRoot).sort(), [
        `${folders.namedProjectsRoot}/pinball-2`,
        `${folders.namedProjectsRoot}/pinball-3`,
      ]);
      assert.equal(
        yield* fs.readFileString(`${folders.namedProjectsRoot}/pinball/keep`),
        "existing",
      );
    }),
  ),
);

it.effect("keeps the created project and files when Git cannot make the first commit", () =>
  withFolders(
    (folders) =>
      Effect.gen(function* () {
        const result = yield* folders.createNamedProject({ name: "No Identity" });
        const fs = yield* FileSystem.FileSystem;
        assert.include(result.commitError ?? "", "Git has no name or email");
        assert.isTrue(yield* fs.exists(`${result.workspaceRoot}/README.md`));
        assert.isTrue(yield* fs.exists(`${result.workspaceRoot}/.git`));
      }),
    { commitFailure: true },
  ),
);

it.effect("removes only its unused folder when repository setup fails", () =>
  withFolders(
    (folders) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const result = yield* Effect.result(folders.createNamedProject({ name: "Setup failure" }));
        assert.equal(result._tag, "Failure");
        assert.isFalse(yield* fs.exists(`${folders.namedProjectsRoot}/setup-failure`));
      }),
    { initFailure: true },
  ),
);

it.effect.each([false, true])(
  "a rejected project create preserves the folder only when another project owns it: %s",
  (owned) =>
    withFolders(
      (folders) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const result = yield* Effect.result(
            folders.createNamedProject({ name: "Create failure" }),
          );
          assert.equal(result._tag, "Failure");
          assert.equal(yield* fs.exists(`${folders.namedProjectsRoot}/create-failure`), owned);
        }),
      { createFailure: true, owned },
    ),
);
