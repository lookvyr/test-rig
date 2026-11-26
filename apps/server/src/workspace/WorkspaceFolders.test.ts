// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { describe, expect } from "vite-plus/test";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as WorkspaceFolders from "./WorkspaceFolders.ts";

const projectId = ProjectId.make("project-folders");

const makeTmpDir = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  // Resolved, so paths compare equal to what discovery reports on macOS's /private/var.
  return yield* fileSystem.realPath(
    yield* fileSystem.makeTempDirectoryScoped({ prefix: "workspace-folders-" }),
  );
});

/** A folder with its own `.git` directory, which is all discovery looks for. */
const makeRepository = (folder: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    yield* fileSystem.makeDirectory(NodePath.join(folder, ".git"), { recursive: true });
  });

const makeFolder = (folder: string) =>
  FileSystem.FileSystem.pipe(
    Effect.flatMap((fileSystem) => fileSystem.makeDirectory(folder, { recursive: true })),
  );

const writeFile = (file: string, contents: string) =>
  FileSystem.FileSystem.pipe(
    Effect.flatMap((fileSystem) => fileSystem.writeFileString(file, contents)),
  );

const discover = (root: string) =>
  WorkspaceFolders.discoverRepositories(root).pipe(
    Effect.map((folders) => folders.map((folder) => NodePath.relative(root, folder.path))),
  );

const serviceFor = (project: { workspaceRoot: string; addedFolders?: ReadonlyArray<never> }) =>
  WorkspaceFolders.WorkspaceFolders.pipe(
    Effect.provide(
      WorkspaceFolders.layer.pipe(
        Layer.provide(
          Layer.mock(ProjectStore.ProjectStoreV2)({
            get: () =>
              Effect.succeed(
                Option.some({
                  projectId,
                  title: "Project",
                  workspaceRoot: project.workspaceRoot,
                  defaultModelSelection: null,
                  defaultThreadEnvMode: null,
                  autoPull: false,
                  faviconPath: null,
                  projectIcon: null,
                  scripts: [],
                  addedFolders: project.addedFolders ?? [],
                  createdAt: "2026-11-25T00:00:00.000Z",
                  updatedAt: "2026-11-25T00:00:00.000Z",
                  deletedAt: null,
                }),
              ),
          }),
        ),
      ),
    ),
  );

it.layer(NodeServices.layer)("WorkspaceFolders", (it) => {
  describe("discoverRepositories", () => {
    it.effect("finds child repositories and repositories one level inside plain folders", () =>
      Effect.gen(function* () {
        const root = yield* makeTmpDir;
        yield* makeRepository(NodePath.join(root, "api"));
        yield* makeRepository(NodePath.join(root, "packages", "web"));
        yield* makeFolder(NodePath.join(root, "docs"));
        // Too deep: only one level inside a plain folder is looked at.
        yield* makeRepository(NodePath.join(root, "src", "deep", "lib"));

        expect(yield* discover(root)).toEqual(["api", "packages/web"]);
      }),
    );

    it.effect("skips hidden folders, node_modules, and what a repository holds", () =>
      Effect.gen(function* () {
        const root = yield* makeTmpDir;
        yield* makeRepository(NodePath.join(root, ".cache", "clone"));
        yield* makeRepository(NodePath.join(root, "node_modules", "pkg"));
        yield* makeRepository(NodePath.join(root, "api"));
        yield* makeRepository(NodePath.join(root, "api", "vendor"));

        expect(yield* discover(root)).toEqual(["api"]);
      }),
    );

    it.effect("leaves out worktrees, submodules, and ignored repositories", () =>
      Effect.gen(function* () {
        const root = yield* makeTmpDir;
        yield* makeRepository(NodePath.join(root, "api"));
        yield* makeRepository(NodePath.join(root, "vendor", "big"));
        yield* makeRepository(NodePath.join(root, "lib"));
        // A worktree keeps `.git` as a file.
        yield* makeFolder(NodePath.join(root, "api-feature"));
        yield* writeFile(NodePath.join(root, "api-feature", ".git"), "gitdir: ../api/.git\n");
        yield* writeFile(NodePath.join(root, ".gitmodules"), '[submodule "lib"]\n\tpath = lib\n');
        yield* writeFile(
          NodePath.join(root, "t3.json"),
          '{ "ignoreRepositories": ["vendor/big"] }',
        );

        expect(yield* discover(root)).toEqual(["api"]);
      }),
    );
  });

  describe("forThread", () => {
    it.effect("is empty for a project folder with no other repositories", () =>
      Effect.gen(function* () {
        const root = yield* makeTmpDir;
        yield* makeRepository(root);
        const service = yield* serviceFor({ workspaceRoot: root });

        expect(yield* service.forThread({ projectId, worktreePath: null })).toEqual(
          WorkspaceFolders.EMPTY_THREAD_WORKSPACE,
        );
      }),
    );

    it.effect("grants added folders outside the project but not repositories inside it", () =>
      Effect.gen(function* () {
        const parent = yield* makeTmpDir;
        const root = NodePath.join(parent, "shop");
        const outside = NodePath.join(parent, "shared-lib");
        yield* makeRepository(NodePath.join(root, "api"));
        yield* makeRepository(outside);
        const service = yield* serviceFor({
          workspaceRoot: root,
          addedFolders: [{ path: outside, name: "shared-lib" }] as never,
        });

        const workspace = yield* service.forThread({ projectId, worktreePath: null });
        expect(workspace.folders.map((folder) => folder.name)).toEqual(["api", "shared-lib"]);
        expect(workspace.extraRoots).toEqual([outside]);
      }),
    );

    it.effect("leaves out an added folder that now leads somewhere else", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const parent = yield* makeTmpDir;
        const root = NodePath.join(parent, "shop");
        const outside = NodePath.join(parent, "shared-lib");
        yield* makeFolder(root);
        // Approved as a folder, later replaced by a link to the project's parent.
        yield* fileSystem.symlink(parent, outside);
        const service = yield* serviceFor({
          workspaceRoot: root,
          addedFolders: [{ path: outside, name: "shared-lib" }] as never,
        });

        expect(yield* service.forThread({ projectId, worktreePath: null })).toEqual(
          WorkspaceFolders.EMPTY_THREAD_WORKSPACE,
        );
      }),
    );

    it.effect("is empty for a thread in its own worktree", () =>
      Effect.gen(function* () {
        const root = yield* makeTmpDir;
        yield* makeRepository(NodePath.join(root, "api"));
        const service = yield* serviceFor({ workspaceRoot: root });

        expect(
          yield* service.forThread({ projectId, worktreePath: NodePath.join(root, "wt") }),
        ).toEqual(WorkspaceFolders.EMPTY_THREAD_WORKSPACE);
      }),
    );
  });

  describe("list", () => {
    it.effect("offers .code-workspace folders outside the project that are not added", () =>
      Effect.gen(function* () {
        const parent = yield* makeTmpDir;
        const root = NodePath.join(parent, "shop");
        yield* makeRepository(NodePath.join(root, "api"));
        yield* makeRepository(NodePath.join(parent, "infra"));
        yield* writeFile(
          NodePath.join(root, "shop.code-workspace"),
          // Lenient JSON, as VS Code writes it.
          `{ "folders": [ { "path": "api" }, { "path": "../infra", "name": "Infra" }, { "path": "../gone" }, ], }`,
        );
        const service = yield* serviceFor({ workspaceRoot: root });

        const listed = yield* service.list({ projectId });
        expect(listed.projectIsGitRepository).toBe(false);
        expect(listed.folders.map((folder) => [folder.name, folder.state])).toEqual([
          ["api", "git"],
        ]);
        expect(listed.suggestions).toEqual([
          { name: "Infra", path: NodePath.join(parent, "infra"), isGitRepository: true },
        ]);
        expect(listed.codeWorkspaceFile).toBe(NodePath.join(root, "shop.code-workspace"));
      }),
    );
  });
});
