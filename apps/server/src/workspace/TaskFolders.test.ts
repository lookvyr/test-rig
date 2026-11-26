// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { GitCommandError, ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ServerConfig } from "../config.ts";
import * as GitWorkflow from "../git/GitWorkflowService.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as TaskFolders from "./TaskFolders.ts";

const projectId = ProjectId.make("project:task-folders");
const VcsProcessLayer = VcsProcess.layer.pipe(Layer.provide(NodeServices.layer));

const git = (cwd: string, args: ReadonlyArray<string>) =>
  VcsProcess.VcsProcess.pipe(
    Effect.flatMap((process) =>
      process.run({ operation: "test.git", command: "git", cwd, args, timeoutMs: 10_000 }),
    ),
    Effect.map((result) => result.stdout.trim()),
  );

const makeRepository = (cwd: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    yield* fileSystem.makeDirectory(cwd, { recursive: true });
    yield* git(cwd, ["init", "-q", "-b", "main"]);
    yield* git(cwd, ["config", "user.email", "test@test.com"]);
    yield* git(cwd, ["config", "user.name", "Test"]);
    yield* fileSystem.writeFileString(NodePath.join(cwd, "index.ts"), "export {};\n");
    yield* git(cwd, ["add", "."]);
    yield* git(cwd, ["commit", "-q", "-m", "init"]);
  });

/** The four Git operations task folders use, run directly. */
const gitWorkflowLayer = Layer.effect(
  GitWorkflow.GitWorkflowService,
  Effect.gen(function* () {
    const process = yield* VcsProcess.VcsProcess;
    const run = (cwd: string, args: ReadonlyArray<string>) =>
      process.run({ operation: "test.git", command: "git", cwd, args, timeoutMs: 10_000 }).pipe(
        Effect.mapError(
          (cause) =>
            new GitCommandError({
              operation: "test.git",
              command: `git ${args.join(" ")}`,
              cwd,
              detail: cause.message,
            }),
        ),
      );
    type Service = GitWorkflow.GitWorkflowService["Service"];
    const hasCommit: Service["hasCommit"] = (input) =>
      process
        .run({
          operation: "test.git",
          command: "git",
          cwd: input.cwd,
          args: ["rev-parse", "--verify", "--quiet", input.refName],
          allowNonZeroExit: true,
        })
        .pipe(
          Effect.map((result) => result.exitCode === 0),
          Effect.orDie,
        );
    const createWorktree: Service["createWorktree"] = (input) =>
      run(
        input.cwd,
        input.newRefName === undefined
          ? ["worktree", "add", input.path!, input.refName]
          : ["worktree", "add", "-b", input.newRefName, input.path!, input.refName],
      ).pipe(
        Effect.as({
          worktree: { path: input.path!, refName: input.newRefName ?? input.refName },
        }),
      );
    const removeWorktree: Service["removeWorktree"] = (input) =>
      run(input.cwd, ["worktree", "remove", ...(input.force ? ["--force"] : []), input.path]).pipe(
        Effect.asVoid,
      );
    const pruneWorktrees: Service["pruneWorktrees"] = (input) =>
      run(input.cwd, ["worktree", "prune"]).pipe(Effect.asVoid);
    const localStatus = (input: { readonly cwd: string }) =>
      run(input.cwd, ["status", "--porcelain"]).pipe(
        Effect.map((result) => ({ hasWorkingTreeChanges: result.stdout.trim() !== "" })),
      );
    const listLocalBranchNames = (cwd: string) =>
      run(cwd, ["branch", "--format=%(refname:short)"]).pipe(
        Effect.map((result) => result.stdout.split("\n").filter((name) => name !== "")),
      );
    return {
      listLocalBranchNames,
      hasCommit,
      createWorktree,
      removeWorktree,
      pruneWorktrees,
      localStatus,
    } as unknown as Service;
  }),
);

const setup = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const base = yield* fileSystem.realPath(
    yield* fileSystem.makeTempDirectoryScoped({ prefix: "task-folders-" }),
  );
  const shop = NodePath.join(base, "shop");
  const worktreesDir = NodePath.join(base, "worktrees");
  yield* makeRepository(NodePath.join(shop, "api"));
  yield* makeRepository(NodePath.join(shop, "packages", "web"));
  yield* makeRepository(NodePath.join(shop, "packages", "docs"));
  yield* fileSystem.writeFileString(NodePath.join(shop, "AGENTS.md"), "# Shop\n");
  const service = yield* TaskFolders.TaskFolders.pipe(
    Effect.provide(
      TaskFolders.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            gitWorkflowLayer,
            ServerSettings.layerTest(),
            Layer.succeed(ServerConfig, { worktreesDir } as ServerConfig["Service"]),
            Layer.mock(ProjectStore.ProjectStoreV2)({
              get: () =>
                Effect.succeed(
                  Option.some({
                    projectId,
                    title: "shop",
                    workspaceRoot: shop,
                    defaultModelSelection: null,
                    defaultThreadEnvMode: null,
                    autoPull: false,
                    faviconPath: null,
                    projectIcon: null,
                    scripts: [],
                    addedFolders: [],
                    createdAt: "2026-11-25T00:00:00.000Z",
                    updatedAt: "2026-11-25T00:00:00.000Z",
                    deletedAt: null,
                  }),
                ),
            }),
          ),
        ),
      ),
    ),
  );
  return { fileSystem, shop, service };
});

it.layer(Layer.merge(NodeServices.layer, VcsProcessLayer))("TaskFolders", (it) => {
  it.effect("lays a plain project folder out with a worktree of each chosen repository", () =>
    Effect.gen(function* () {
      const { fileSystem, shop, service } = yield* setup;
      assert.isTrue(yield* service.covers({ workspaceRoot: shop, addedFolders: [] }));
      const taskFolder = yield* service.create({
        projectId,
        branch: "feature/x",
        baseRef: "main",
        projectStartRef: "main",
        repositories: [
          { path: NodePath.join(shop, "api") },
          { path: NodePath.join(shop, "packages", "web") },
        ],
      });
      const projectPath = taskFolder.projectPath;
      assert.equal(NodePath.basename(projectPath), "shop");
      assert.isFalse(taskFolder.projectIsWorktree);
      // Each chosen repository is a worktree on the thread's branch, at the same place.
      for (const relative of ["api", "packages/web"]) {
        assert.equal(
          yield* git(NodePath.join(projectPath, relative), ["branch", "--show-current"]),
          "feature/x",
        );
      }
      // Other files link to the originals; an unchosen repository is left out.
      assert.equal(
        yield* fileSystem.readLink(NodePath.join(projectPath, "AGENTS.md")),
        NodePath.join(shop, "AGENTS.md"),
      );
      assert.isFalse(yield* fileSystem.exists(NodePath.join(projectPath, "packages", "docs")));
      // A folder holding repositories is a real folder, never a link into the originals.
      assert.isTrue(
        Option.isNone(
          yield* fileSystem.readLink(NodePath.join(projectPath, "packages")).pipe(Effect.option),
        ),
      );
      // The record is found from the thread's folder.
      const found = yield* service.find(projectPath);
      assert.deepEqual(
        Option.map(found, (entry) => entry.repositories.length),
        Option.some(2),
      );

      // A repository added later gets its worktree beside the others.
      const added = yield* service.addRepository({
        worktreePath: projectPath,
        branch: "feature/x",
        repositoryPath: NodePath.join(shop, "packages", "docs"),
      });
      assert.equal(added.repositories.length, 3);
      assert.equal(
        yield* git(NodePath.join(projectPath, "packages", "docs"), ["branch", "--show-current"]),
        "feature/x",
      );

      yield* service.remove({ taskFolder: added, force: false });
      assert.isFalse(yield* fileSystem.exists(taskFolder.root));
      // Removing links never touches the originals, and each branch stays for later.
      assert.isTrue(yield* fileSystem.exists(NodePath.join(shop, "AGENTS.md")));
      assert.equal(
        yield* git(NodePath.join(shop, "api"), ["branch", "--list", "feature/x"]),
        "feature/x",
      );
    }),
  );

  it.effect("deletes a file outside the repositories only when forced", () =>
    Effect.gen(function* () {
      const { fileSystem, shop, service } = yield* setup;
      const taskFolder = yield* service.create({
        projectId,
        branch: "feature/files",
        baseRef: "main",
        projectStartRef: "main",
        repositories: [{ path: NodePath.join(shop, "api") }],
      });
      const notes = NodePath.join(taskFolder.projectPath, "notes.md");
      yield* fileSystem.writeFileString(notes, "keep me\n");
      const refused = yield* service.remove({ taskFolder, force: false }).pipe(Effect.flip);
      assert.equal(refused._tag, "TaskFolderError");
      assert.equal(yield* fileSystem.readFileString(notes), "keep me\n");
      // A forced removal takes the whole folder, as for a single worktree, but never follows a
      // link: the originals stay.
      yield* service.remove({ taskFolder, force: true });
      assert.isFalse(yield* fileSystem.exists(taskFolder.root));
      assert.isTrue(yield* fileSystem.exists(NodePath.join(shop, "AGENTS.md")));
      assert.isTrue(yield* fileSystem.exists(NodePath.join(shop, "api", "index.ts")));
    }),
  );

  it.effect("ignores a record that names another folder", () =>
    Effect.gen(function* () {
      const { shop, service } = yield* setup;
      const taskFolder = yield* service.create({
        projectId,
        branch: "feature/record",
        baseRef: "main",
        projectStartRef: "main",
        repositories: [{ path: NodePath.join(shop, "api") }],
      });
      // A worktree inside the task folder is not the task folder's own thread folder.
      assert.isTrue(Option.isNone(yield* service.find(taskFolder.repositories[0]!.worktreePath)));
    }),
  );

  it.effect("keeps a repository with uncommitted work when removal is not forced", () =>
    Effect.gen(function* () {
      const { fileSystem, shop, service } = yield* setup;
      const taskFolder = yield* service.create({
        projectId,
        branch: "feature/y",
        baseRef: "main",
        projectStartRef: "main",
        repositories: [
          { path: NodePath.join(shop, "api") },
          { path: NodePath.join(shop, "packages", "web") },
        ],
      });
      const worktree = taskFolder.repositories[0]!.worktreePath;
      yield* fileSystem.writeFileString(
        NodePath.join(worktree, "index.ts"),
        "export const x = 1;\n",
      );
      const refused = yield* service.remove({ taskFolder, force: false }).pipe(Effect.flip);
      assert.equal(refused._tag, "TaskFolderError");
      assert.isTrue(yield* fileSystem.exists(NodePath.join(worktree, "index.ts")));
      // Refused before anything was removed: the clean checkout is still there too.
      assert.isTrue(yield* fileSystem.exists(taskFolder.repositories[1]!.worktreePath));
    }),
  );

  it.effect("starts a repository without the base branch from its own checkout", () =>
    Effect.gen(function* () {
      const { shop, service } = yield* setup;
      const taskFolder = yield* service.create({
        projectId,
        branch: "feature/z",
        baseRef: "release",
        projectStartRef: "release",
        repositories: undefined,
      });
      // With three repositories, all are included by default.
      assert.equal(taskFolder.repositories.length, 3);
      const api = taskFolder.repositories.find((repository) => repository.name === "api")!;
      assert.equal(
        yield* git(api.worktreePath, ["rev-parse", "HEAD"]),
        yield* git(NodePath.join(shop, "api"), ["rev-parse", "main"]),
      );
    }),
  );

  it.effect("removes what passes inspection, keeps the record, and restores the folder", () =>
    Effect.gen(function* () {
      const { fileSystem, shop, service } = yield* setup;
      const taskFolder = yield* service.create({
        projectId,
        branch: "feature/clean",
        baseRef: "main",
        projectStartRef: "main",
        repositories: [
          { path: NodePath.join(shop, "api") },
          { path: NodePath.join(shop, "packages", "web") },
        ],
      });
      const api = taskFolder.repositories.find((repository) => repository.name === "api")!;
      const web = taskFolder.repositories.find((repository) => repository.name !== "api")!;
      const marker = NodePath.join(web.worktreePath, "local.txt");
      yield* fileSystem.writeFileString(marker, "work\n");
      const inspect = (checkout: { readonly worktreePath: string }) =>
        fileSystem.exists(NodePath.join(checkout.worktreePath, "local.txt")).pipe(
          Effect.map((present) => (present ? "has local work" : null)),
          Effect.orElseSucceed(() => "unreadable"),
        );

      // A checkout with work stays with the folders and links around it; the others go.
      const partial = yield* service.remove({
        taskFolder,
        force: false,
        keepRecord: true,
        inspect,
      });
      assert.deepEqual(partial.removed, [api.worktreePath]);
      assert.deepEqual(
        partial.kept.map((entry) => entry.path),
        [web.worktreePath],
      );
      assert.isFalse(yield* fileSystem.exists(api.worktreePath));
      assert.isTrue(yield* fileSystem.exists(marker));
      assert.isTrue(yield* fileSystem.exists(NodePath.join(taskFolder.projectPath, "AGENTS.md")));

      // The next turn puts the missing checkout back on the thread's branch.
      assert.isTrue(yield* service.restore({ taskFolder, branch: "feature/clean" }));
      assert.equal(yield* git(api.worktreePath, ["branch", "--show-current"]), "feature/clean");

      // Once nothing holds it, the whole folder goes, but its record stays for the thread.
      yield* fileSystem.remove(marker);
      const full = yield* service.remove({ taskFolder, force: false, keepRecord: true, inspect });
      assert.equal(full.kept.length, 0);
      assert.isFalse(yield* fileSystem.exists(taskFolder.projectPath));
      assert.isTrue(Option.isSome(yield* service.find(taskFolder.projectPath)));

      // Restoring lays the folder out again: links to the originals and every worktree.
      assert.isTrue(yield* service.restore({ taskFolder, branch: "feature/clean" }));
      assert.equal(
        yield* fileSystem.readLink(NodePath.join(taskFolder.projectPath, "AGENTS.md")),
        NodePath.join(shop, "AGENTS.md"),
      );
      for (const repository of [api, web]) {
        assert.equal(
          yield* git(repository.worktreePath, ["branch", "--show-current"]),
          "feature/clean",
        );
      }
      assert.isFalse(
        yield* fileSystem.exists(NodePath.join(taskFolder.projectPath, "packages", "docs")),
      );
      assert.isFalse(yield* service.restore({ taskFolder, branch: "feature/clean" }));

      // Removing it for good takes the record too.
      yield* service.remove({ taskFolder, force: false });
      assert.isFalse(yield* fileSystem.exists(taskFolder.root));
    }),
  );

  it.effect("never cleans, removes or resumes a checkout replaced by a link", () =>
    Effect.gen(function* () {
      const { fileSystem, shop, service } = yield* setup;
      const taskFolder = yield* service.create({
        projectId,
        branch: "feature/linked",
        baseRef: "main",
        projectStartRef: "main",
        repositories: [{ path: NodePath.join(shop, "api") }],
      });
      const api = taskFolder.repositories[0]!;
      yield* git(api.repositoryPath, ["worktree", "remove", "--force", api.worktreePath]);
      yield* fileSystem.symlink(api.repositoryPath, api.worktreePath);
      let inspected = 0;
      const result = yield* service.remove({
        taskFolder,
        force: false,
        keepRecord: true,
        inspect: () => Effect.sync(() => (inspected += 1)).pipe(Effect.as(null)),
      });
      assert.equal(inspected, 0);
      assert.deepEqual(result.kept, [
        { path: api.worktreePath, reason: "not this thread's worktree" },
      ]);
      assert.isTrue(yield* fileSystem.exists(NodePath.join(api.repositoryPath, "index.ts")));
      const refused = yield* service
        .restore({ taskFolder, branch: "feature/linked" })
        .pipe(Effect.flip);
      assert.equal(refused._tag, "TaskFolderError");
      const forced = yield* service.remove({ taskFolder, force: true }).pipe(Effect.flip);
      assert.equal(forced._tag, "TaskFolderError");
    }),
  );

  it.effect("keeps a repository with no commit out of the links, and picks a free branch", () =>
    Effect.gen(function* () {
      const { fileSystem, shop, service } = yield* setup;
      const fresh = NodePath.join(shop, "fresh");
      yield* fileSystem.makeDirectory(fresh);
      yield* git(fresh, ["init", "-q", "-b", "main"]);
      const taskFolder = yield* service.create({
        projectId,
        branch: "feature/fresh",
        baseRef: "main",
        projectStartRef: "main",
        repositories: undefined,
      });
      assert.isFalse(taskFolder.repositories.some((repository) => repository.name === "fresh"));
      assert.isFalse(yield* fileSystem.exists(NodePath.join(taskFolder.projectPath, "fresh")));

      // A branch one repository has already gives the thread the next name free in all of them.
      yield* git(NodePath.join(shop, "api"), ["branch", "feature/taken"]);
      const taken = yield* service.create({
        projectId,
        branch: "feature/taken",
        baseRef: "main",
        projectStartRef: "main",
        repositories: [{ path: NodePath.join(shop, "api") }],
      });
      assert.equal(taken.branch, "feature/taken-2");
      assert.equal(
        yield* git(taken.repositories[0]!.worktreePath, ["branch", "--show-current"]),
        "feature/taken-2",
      );
      const unknown = yield* service
        .create({
          projectId,
          branch: "feature/unknown",
          baseRef: "main",
          projectStartRef: "main",
          repositories: [{ path: NodePath.join(shop, "nowhere") }],
        })
        .pipe(Effect.flip);
      assert.include(unknown.detail, "is not one of the project's repositories");
    }),
  );

  it.effect("keeps the links of a folder that stays for a file only it holds", () =>
    Effect.gen(function* () {
      const { fileSystem, shop, service } = yield* setup;
      const taskFolder = yield* service.create({
        projectId,
        branch: "feature/notes",
        baseRef: "main",
        projectStartRef: "main",
        repositories: [{ path: NodePath.join(shop, "api") }],
      });
      yield* fileSystem.writeFileString(NodePath.join(taskFolder.projectPath, "notes.md"), "x\n");
      const result = yield* service.remove({
        taskFolder,
        force: false,
        keepRecord: true,
        inspect: () => Effect.succeed(null),
      });
      assert.equal(result.kept.length, 1);
      assert.isTrue(yield* fileSystem.exists(NodePath.join(taskFolder.projectPath, "AGENTS.md")));
    }),
  );

  it.effect("never restores through a task folder whose root became a link", () =>
    Effect.gen(function* () {
      const { fileSystem, shop, service } = yield* setup;
      const taskFolder = yield* service.create({
        projectId,
        branch: "feature/moved",
        baseRef: "main",
        projectStartRef: "main",
        repositories: [{ path: NodePath.join(shop, "api") }],
      });
      const api = taskFolder.repositories[0]!;
      yield* git(api.repositoryPath, ["worktree", "remove", "--force", api.worktreePath]);
      const moved = `${taskFolder.root}-moved`;
      yield* fileSystem.rename(taskFolder.root, moved);
      yield* fileSystem.symlink(moved, taskFolder.root);
      const refused = yield* service
        .restore({ taskFolder, branch: "feature/moved" })
        .pipe(Effect.flip);
      assert.equal(refused._tag, "TaskFolderError");
      assert.isFalse(
        yield* fileSystem.exists(
          NodePath.join(moved, NodePath.relative(taskFolder.root, api.worktreePath)),
        ),
      );
    }),
  );

  it.effect("picks the first branch name free in every repository", () =>
    Effect.sync(() => {
      assert.equal(TaskFolders.freeBranchName("feature/x", [["main"], ["main"]]), "feature/x");
      assert.equal(
        TaskFolders.freeBranchName("feature/x", [["main"], ["feature/x", "feature/x-2"]]),
        "feature/x-3",
      );
      // Git keeps branches as files: a name cannot sit under, or contain, an existing one.
      assert.equal(TaskFolders.freeBranchName("feature", [["feature/y"]]), "feature-2");
      // Under an existing branch, no suffix helps.
      assert.isNull(TaskFolders.freeBranchName("feature/x/y", [["feature/x"]]));
      assert.isNull(TaskFolders.freeBranchName("feature/x", [["feature/x"]], true));
    }),
  );
});
