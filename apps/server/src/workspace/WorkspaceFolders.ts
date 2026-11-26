// @effect-diagnostics nodeBuiltinImport:off
/**
 * WorkspaceFolders - the folders a project works in besides its own.
 *
 * Repositories inside the project folder are read from disk each time, so a clone shows up at once
 * and a deleted one is gone. Folders outside it are the project's `addedFolders`, since reaching
 * one grants agents a place they could not reach before.
 *
 * @module WorkspaceFolders
 */
import {
  type ProjectAddedFolder,
  type ProjectId,
  T3_PROJECT_FILE_NAME,
  type WorkspaceFolder,
  WorkspaceFoldersError,
  type WorkspaceListFoldersInput,
  type WorkspaceListFoldersResult,
} from "@t3tools/contracts";
import { fromLenientJson } from "@t3tools/shared/schemaJson";
import { parseT3ProjectFile } from "@t3tools/shared/t3ProjectFile";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as NodeFSP from "node:fs/promises";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import { findTaskFolder } from "./taskFolderRecord.ts";

/** A folder a thread works in besides its own cwd. */
export interface ThreadFolder {
  readonly name: string;
  readonly path: string;
  readonly isGitRepository: boolean;
  /** The project's folder `path` is a checkout of. Absent when `path` is that folder. */
  readonly repositoryPath?: string;
}

export interface ThreadWorkspace {
  readonly folders: ReadonlyArray<ThreadFolder>;
  /** Paths of the folders outside the thread's cwd, which an agent needs granted to reach. */
  readonly extraRoots: ReadonlyArray<string>;
}

export const EMPTY_THREAD_WORKSPACE: ThreadWorkspace = { folders: [], extraRoots: [] };

const DETECTION_CONCURRENCY = 8;
// Each one costs a status per turn.
const THREAD_SUBMODULES_MAX = 32;
const FOLDER_NAME_MAX = 128;
const CODE_WORKSPACE_EXTENSION = ".code-workspace";

/** Folder names come from disk and users; keep them within what contracts allow. */
export const boundedFolderName = (name: string) =>
  Array.from(name.trim()).slice(0, FOLDER_NAME_MAX).join("").trim() || "folder";

/** Whether `target` is `root` or inside it. */
export const isWithinRoot = (path: Path.Path, root: string, target: string) => {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

const isSearchedName = (name: string) => !name.startsWith(".") && name !== "node_modules";

/** Submodule paths a `.gitmodules` file declares, relative to its folder with `/` separators. */
export const parseGitmodulesPaths = (text: string): ReadonlyArray<string> =>
  text.split(/\r?\n/).flatMap((line) => {
    const value = /^\s*path\s*=\s*(.*?)\s*$/i.exec(line)?.[1];
    if (value === undefined) return [];
    const normalized = value.replaceAll('"', "").replaceAll("\\", "/").replace(/\/+$/, "");
    return normalized === "" ? [] : [normalized];
  });

const decodeCodeWorkspace = Schema.decodeUnknownEffect(
  fromLenientJson(
    Schema.Struct({
      folders: Schema.optional(
        Schema.Array(
          Schema.Struct({
            path: Schema.optional(Schema.String),
            name: Schema.optional(Schema.String),
          }),
        ),
      ),
    }),
  ),
);

export class WorkspaceFolders extends Context.Service<
  WorkspaceFolders,
  {
    /**
     * The folders a thread reaches besides its cwd. A thread in the project folder reaches the
     * repositories inside it and the added folders; one in a single worktree reaches none.
     */
    readonly forThread: (input: {
      readonly projectId: ProjectId;
      readonly worktreePath: string | null;
    }) => Effect.Effect<ThreadWorkspace, WorkspaceFoldersError>;
    /**
     * Submodules checked out inside the thread's cwd or its folders. Their parent repository owns
     * where they are, so they are reviewed like folders but never granted or announced.
     */
    readonly submodules: (input: {
      readonly cwd: string;
      /** The thread's `forThread` folders; passed in so the project is walked once. */
      readonly folders: ReadonlyArray<ThreadFolder>;
    }) => Effect.Effect<ReadonlyArray<ThreadFolder>>;
    readonly list: (
      input: WorkspaceListFoldersInput,
    ) => Effect.Effect<WorkspaceListFoldersResult, WorkspaceFoldersError>;
  }
>()("t3/workspace/WorkspaceFolders") {}

/** The file-system probes discovery needs, bound to the caller's services. */
const folderProbes = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const exists = (target: string) =>
    fileSystem.exists(target).pipe(Effect.orElseSucceed(() => false));

  // Containment checks work on what a path resolves to, not on a symlink's name.
  const realPath = (target: string) =>
    fileSystem.realPath(target).pipe(Effect.orElseSucceed(() => target));

  // A linked worktree and a submodule keep `.git` as a file; both follow another repository.
  const ownsHistory = (folder: string) =>
    fileSystem.stat(path.join(folder, ".git")).pipe(
      Effect.map((info) => info.type === "Directory"),
      Effect.orElseSucceed(() => false),
    );

  const classify = Effect.fnUntraced(function* (folderPath: string) {
    if (yield* exists(path.join(folderPath, ".git"))) return "git" as const;
    const isFolder = yield* fileSystem.stat(folderPath).pipe(
      Effect.map((info) => info.type === "Directory"),
      Effect.orElseSucceed(() => false),
    );
    return isFolder ? ("plain" as const) : ("missing" as const);
  });

  const readNames = (folder: string) =>
    fileSystem.readDirectory(folder).pipe(
      Effect.orElseSucceed((): ReadonlyArray<string> => []),
      Effect.map((names) => names.toSorted()),
    );

  // Only folders (and links, which may lead to one) can hold a repository, so a folder full of
  // generated files costs one read rather than a probe per file.
  const readFolderNames = (folder: string) =>
    Effect.tryPromise(() => NodeFSP.readdir(folder, { withFileTypes: true })).pipe(
      Effect.map((entries) =>
        entries
          .filter(
            (entry) =>
              (entry.isDirectory() || entry.isSymbolicLink()) && isSearchedName(entry.name),
          )
          .map((entry) => entry.name)
          .toSorted(),
      ),
      Effect.orElseSucceed((): ReadonlyArray<string> => []),
    );

  return { fileSystem, path, exists, realPath, ownsHistory, classify, readNames, readFolderNames };
});

/**
 * The repositories inside a project folder, read from disk: each child with its own history, and
 * each grandchild under a child that is not a repository (wrappers such as `src` or `packages`).
 * Hidden folders and `node_modules` are skipped, as are submodules and whatever the project's
 * `t3.json` lists under `ignoreRepositories`.
 */
export const discoverRepositories = Effect.fn("WorkspaceFolders.discoverRepositories")(function* (
  workspaceRoot: string,
): Effect.fn.Return<ReadonlyArray<ProjectAddedFolder>, never, FileSystem.FileSystem | Path.Path> {
  const { fileSystem, path, exists, realPath, ownsHistory, readFolderNames } = yield* folderProbes;
  const root = path.resolve(workspaceRoot);
  const ignored = (
    parseT3ProjectFile(
      yield* fileSystem
        .readFileString(path.join(root, T3_PROJECT_FILE_NAME))
        .pipe(Effect.orElseSucceed(() => "")),
    )?.ignoreRepositories ?? []
  ).map((entry) => path.resolve(root, entry));
  // Everything the walk could find would be dropped.
  if (ignored.some((entry) => isWithinRoot(path, entry, root))) return [];
  const submodules = new Set(
    parseGitmodulesPaths(
      yield* fileSystem
        .readFileString(path.join(root, ".gitmodules"))
        .pipe(Effect.orElseSucceed(() => "")),
    ).map((relative) => path.resolve(root, relative)),
  );
  const isIgnored = (folderPath: string) =>
    submodules.has(folderPath) || ignored.some((entry) => isWithinRoot(path, entry, folderPath));
  const children = yield* Effect.forEach(
    yield* readFolderNames(root),
    (name) =>
      Effect.gen(function* () {
        const folderPath = path.join(root, name);
        if (isIgnored(folderPath)) return [];
        if (yield* ownsHistory(folderPath)) return [folderPath];
        // A worktree or submodule: it follows another repository, and so does what it holds.
        if (yield* exists(path.join(folderPath, ".git"))) return [];
        return yield* Effect.filter(
          (yield* readFolderNames(folderPath))
            .map((child) => path.join(folderPath, child))
            .filter((child) => !isIgnored(child)),
          ownsHistory,
          { concurrency: DETECTION_CONCURRENCY },
        );
      }),
    { concurrency: DETECTION_CONCURRENCY },
  );
  const realRoot = yield* realPath(root);
  const found = yield* Effect.filter(
    children.flat(),
    // A link to a repository elsewhere is not inside the project, whatever its name says.
    (folderPath) =>
      realPath(folderPath).pipe(
        Effect.map((real) => real !== realRoot && isWithinRoot(path, realRoot, real)),
      ),
    { concurrency: DETECTION_CONCURRENCY },
  );
  // Concurrent filters can finish in any order; keep the list stable for clients.
  return found.toSorted().map((folderPath) => ({
    path: folderPath,
    name: boundedFolderName(path.relative(root, folderPath).split(path.sep).join("/")),
  }));
});

/** The folders a `.code-workspace` file in the project folder lists, resolved against it. */
const readCodeWorkspaceFolders = Effect.fn("WorkspaceFolders.readCodeWorkspaceFolders")(function* (
  root: string,
) {
  const { fileSystem, path, readNames } = yield* folderProbes;
  const fileName = (yield* readNames(root)).find((name) => name.endsWith(CODE_WORKSPACE_EXTENSION));
  if (fileName === undefined) return null;
  const document = yield* fileSystem
    .readFileString(path.join(root, fileName))
    .pipe(Effect.flatMap(decodeCodeWorkspace), Effect.option);
  if (Option.isNone(document)) return null;
  return {
    file: path.join(root, fileName),
    folders: (document.value.folders ?? []).flatMap((folder) => {
      const folderPath = folder.path?.trim();
      if (folderPath === undefined || folderPath === "") return [];
      const resolved = path.resolve(root, folderPath);
      return [
        {
          path: resolved,
          name: boundedFolderName(folder.name?.trim() || path.basename(resolved)),
        },
      ];
    }),
  };
});

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const provide = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
    effect.pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );
  const probes = yield* provide(folderProbes);

  const readProject = Effect.fn("WorkspaceFolders.readProject")(function* (projectId: ProjectId) {
    const row = yield* projects
      .get(projectId)
      .pipe(
        Effect.mapError(
          () => new WorkspaceFoldersError({ operation: "list", detail: "Failed to read project." }),
        ),
      );
    if (Option.isNone(row)) {
      return yield* new WorkspaceFoldersError({
        operation: "list",
        detail: `Project ${projectId} was not found.`,
      });
    }
    return row.value;
  });

  // A turn reads the folders several times (its policy, its baseline, its capture), so one walk
  // serves them for a moment. A clone shows up within that moment.
  const DISCOVERY_CACHE_MS = 3_000;
  const discoveryCache = new Map<
    string,
    { readonly at: number; readonly folders: ReadonlyArray<ProjectAddedFolder> }
  >();
  const discoverCached = Effect.fnUntraced(function* (workspaceRoot: string) {
    const now = yield* Clock.currentTimeMillis;
    const cached = discoveryCache.get(workspaceRoot);
    if (cached !== undefined && now - cached.at < DISCOVERY_CACHE_MS) return cached.folders;
    const folders = yield* provide(discoverRepositories(workspaceRoot));
    discoveryCache.set(workspaceRoot, { at: now, folders });
    return folders;
  });

  const classified = Effect.fnUntraced(function* (project: ProjectStore.ProjectRow) {
    const discovered = yield* discoverCached(project.workspaceRoot);
    const found = new Set(discovered.map((folder) => folder.path));
    const folders = [
      ...discovered.map((folder) => ({ ...folder, discovered: true })),
      ...project.addedFolders
        .filter((folder) => !found.has(folder.path))
        .map((folder) => ({ ...folder, discovered: false })),
    ];
    return yield* Effect.forEach(
      folders,
      (folder) =>
        probes
          .classify(folder.path)
          .pipe(Effect.map((state): WorkspaceFolder => ({ ...folder, state }))),
      { concurrency: DETECTION_CONCURRENCY },
    );
  });

  const forThread: WorkspaceFolders["Service"]["forThread"] = Effect.fn(
    "WorkspaceFolders.forThread",
  )(function* (input) {
    if (input.worktreePath !== null) {
      // A task folder's worktrees stand in for the project's repositories: the thread is told
      // about, granted and checkpoints only those. A single worktree reaches none, since the
      // project's other checkouts are shared.
      const taskFolder = yield* provide(findTaskFolder(input.worktreePath));
      if (Option.isNone(taskFolder)) return EMPTY_THREAD_WORKSPACE;
      const cwd = path.resolve(input.worktreePath);
      const folders = taskFolder.value.repositories.map((repository) => ({
        name: repository.name,
        path: repository.worktreePath,
        isGitRepository: true,
        repositoryPath: repository.repositoryPath,
      }));
      const outside = folders
        .filter((folder) => !isWithinRoot(path, cwd, folder.path))
        .map((folder) => folder.path);
      // A sandbox may compare resolved paths, so a worktrees folder behind a link is granted both.
      const resolved = yield* Effect.forEach(outside, (folder) =>
        probes.realPath(folder).pipe(Effect.orElseSucceed(() => folder)),
      );
      return { folders, extraRoots: [...new Set([...outside, ...resolved])] };
    }
    const project = yield* readProject(input.projectId);
    const present = (yield* classified(project)).filter((folder) => folder.state !== "missing");
    if (present.length === 0) return EMPTY_THREAD_WORKSPACE;
    // Added folders are stored as the real path someone approved. One that now resolves elsewhere
    // (it was replaced by a link) is left out rather than granting wherever it leads.
    const approved = yield* Effect.filter(
      present,
      (folder) =>
        folder.discovered
          ? Effect.succeed(true)
          : probes.realPath(folder.path).pipe(Effect.map((real) => real === folder.path)),
      { concurrency: DETECTION_CONCURRENCY },
    );
    const folders = approved.map((folder) => ({
      name: folder.name,
      path: folder.path,
      isGitRepository: folder.state === "git",
    }));
    if (folders.length === 0) return EMPTY_THREAD_WORKSPACE;
    // Only added folders are granted: repositories inside the project are reached through it.
    return {
      folders,
      extraRoots: approved.filter((folder) => !folder.discovered).map((folder) => folder.path),
    };
  });

  // `budget` is shared by one listing: a `.gitmodules` file is untrusted, and one that repeats a
  // path or links back to its parent would otherwise be walked without end.
  const submodulesBelow = (
    root: { readonly path: string; readonly identity: string },
    budget: { left: number; readonly visited: Set<string> },
  ): Effect.Effect<ReadonlyArray<ThreadFolder>> =>
    fileSystem.readFileString(path.join(root.path, ".gitmodules")).pipe(
      Effect.orElseSucceed(() => ""),
      Effect.flatMap((text) =>
        Effect.forEach(
          [...new Set(parseGitmodulesPaths(text))],
          Effect.fnUntraced(function* (relative) {
            const folder = path.resolve(root.path, relative);
            const identity = path.resolve(root.identity, relative);
            if (folder === root.path || !isWithinRoot(path, root.path, folder)) return [];
            // One that was never initialized is an empty folder.
            if (budget.left <= 0 || !(yield* probes.exists(path.join(folder, ".git")))) return [];
            const real = yield* probes.realPath(folder);
            // A committed symlink on the way must not lead out of the repository.
            if (!isWithinRoot(path, yield* probes.realPath(root.path), real)) return [];
            if (budget.left <= 0 || budget.visited.has(real)) return [];
            budget.visited.add(real);
            budget.left -= 1;
            return [
              {
                name: boundedFolderName(path.basename(folder)),
                path: folder,
                isGitRepository: true,
                ...(identity === folder ? {} : { repositoryPath: identity }),
              },
              ...(yield* submodulesBelow({ path: folder, identity }, budget)),
            ];
          }),
          { concurrency: DETECTION_CONCURRENCY },
        ),
      ),
      Effect.map((found) => found.flat()),
    );

  const submodules: WorkspaceFolders["Service"]["submodules"] = Effect.fn(
    "WorkspaceFolders.submodules",
  )(function* (input) {
    const roots = [
      { path: path.resolve(input.cwd), identity: path.resolve(input.cwd) },
      ...input.folders.flatMap((folder) =>
        folder.isGitRepository
          ? [{ path: folder.path, identity: folder.repositoryPath ?? folder.path }]
          : [],
      ),
    ];
    const budget = {
      left: THREAD_SUBMODULES_MAX,
      visited: new Set(
        yield* Effect.forEach(roots, (root) => probes.realPath(root.path), {
          concurrency: DETECTION_CONCURRENCY,
        }),
      ),
    };
    const found = yield* Effect.forEach(roots, (root) => submodulesBelow(root, budget), {
      concurrency: DETECTION_CONCURRENCY,
    });
    const taken = new Set(roots.map((root) => root.path));
    return found.flat().filter((folder) => !taken.has(folder.path));
  });

  const list: WorkspaceFolders["Service"]["list"] = Effect.fn("WorkspaceFolders.list")(
    function* (input) {
      if (input.worktreePath !== undefined) {
        const taskFolder = yield* provide(findTaskFolder(input.worktreePath));
        return {
          projectIsGitRepository: Option.match(taskFolder, {
            onNone: () => true,
            onSome: (found) => found.projectIsWorktree,
          }),
          folders: Option.isNone(taskFolder)
            ? []
            : yield* Effect.forEach(
                taskFolder.value.repositories,
                (repository) =>
                  probes.classify(repository.worktreePath).pipe(
                    Effect.map((state): WorkspaceFolder => ({
                      name: repository.name,
                      path: repository.worktreePath,
                      state,
                      discovered: false,
                      repositoryPath: repository.repositoryPath,
                    })),
                  ),
                { concurrency: DETECTION_CONCURRENCY },
              ),
          suggestions: [],
          codeWorkspaceFile: null,
          isTaskFolder: Option.isSome(taskFolder),
        };
      }
      const project = yield* readProject(input.projectId);
      const folders = yield* classified(project);
      const root = path.resolve(project.workspaceRoot);
      const realRoot = yield* probes.realPath(root);
      const codeWorkspace = yield* provide(readCodeWorkspaceFolders(root));
      const taken = new Set(folders.map((folder) => folder.path));
      const suggestions = yield* Effect.forEach(
        codeWorkspace?.folders ?? [],
        Effect.fnUntraced(function* (folder) {
          if (taken.has(folder.path)) return [];
          const real = yield* probes.realPath(folder.path);
          // Inside the project, its repositories are found on their own.
          if (isWithinRoot(path, realRoot, real) || isWithinRoot(path, real, realRoot)) return [];
          const state = yield* probes.classify(folder.path);
          return state === "missing" ? [] : [{ ...folder, isGitRepository: state === "git" }];
        }),
        { concurrency: DETECTION_CONCURRENCY },
      );
      return {
        projectIsGitRepository: yield* probes.exists(path.join(root, ".git")),
        folders,
        suggestions: suggestions.flat(),
        codeWorkspaceFile: codeWorkspace?.file ?? null,
      };
    },
  );

  return WorkspaceFolders.of({ forThread, submodules, list });
});

export const layer = Layer.effect(WorkspaceFolders, make);

/** For tests of single-folder threads: no other folders, no submodules. */
export const layerTest = Layer.succeed(
  WorkspaceFolders,
  WorkspaceFolders.of({
    forThread: () => Effect.succeed(EMPTY_THREAD_WORKSPACE),
    submodules: () => Effect.succeed([]),
    list: () =>
      Effect.fail(
        new WorkspaceFoldersError({ operation: "list", detail: "Not available in tests." }),
      ),
  }),
);
