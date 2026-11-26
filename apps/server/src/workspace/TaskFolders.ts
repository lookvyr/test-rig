// @effect-diagnostics nodeBuiltinImport:off
/**
 * TaskFolders - the folder a worktree thread works in when its project covers several
 * repositories.
 *
 * A task folder lays the project out again under the worktrees folder: the project folder sits at
 * `projectPath`, and every chosen repository gets a Git worktree at the same place relative to it,
 * all on the thread's branch. When the project folder is a repository it is a worktree too; when
 * it is a plain folder, its other entries are links to the originals, so they stay shared. A
 * record beside the project folder says what was made, so the thread's folders, its checkpoints
 * and its removal all read the same layout.
 *
 * @module TaskFolders
 */
import {
  type ProjectId,
  TASK_FOLDER_DEFAULT_REPOSITORIES_MAX,
  type TaskFolder,
  TaskFolderError,
  TaskFolder as TaskFolderSchema,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as NodeFSP from "node:fs/promises";

import { ServerConfig } from "../config.ts";
import * as GitWorkflow from "../git/GitWorkflowService.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ServerSettings from "../serverSettings.ts";
import { managedWorktreesDirectories, resolveWorktreesDirectory } from "../worktreesDirectory.ts";
import { discoverRepositories, isWithinRoot } from "./WorkspaceFolders.ts";
import { findTaskFolder, forgetTaskFolder, TASK_FOLDER_RECORD_NAME } from "./taskFolderRecord.ts";

const isTaskFolderError = Schema.is(TaskFolderError);
const BRANCH_NAME_ATTEMPTS = 50;

/** Git stores branches as files, so a name also collides with one it nests under or contains. */
const branchNameCollides = (existing: string, candidate: string) =>
  existing === candidate ||
  existing.startsWith(`${candidate}/`) ||
  candidate.startsWith(`${existing}/`);

/**
 * `branch`, else `branch-2`, `branch-3`, ...: the first name free in every list of branch names,
 * one list per repository. Null when none of the attempts is free, or `branch` is taken and only
 * the exact name will do.
 */
export const freeBranchName = (
  branch: string,
  names: ReadonlyArray<ReadonlyArray<string>>,
  exactName = false,
): string | null => {
  for (let attempt = 1; attempt <= (exactName ? 1 : BRANCH_NAME_ATTEMPTS); attempt++) {
    const candidate = attempt === 1 ? branch : `${branch}-${attempt}`;
    if (!names.some((list) => list.some((existing) => branchNameCollides(existing, candidate))))
      return candidate;
  }
  return null;
};
const encodeRecord = Schema.encodeEffect(Schema.fromJsonString(TaskFolderSchema));

export interface TaskFolderRepositoryChoice {
  readonly path: string;
}

export class TaskFolders extends Context.Service<
  TaskFolders,
  {
    /** Whether a project's new worktree threads get a task folder: it covers other repositories. */
    readonly covers: (project: {
      readonly workspaceRoot: string;
      readonly addedFolders: ReadonlyArray<{ readonly path: string }>;
    }) => Effect.Effect<boolean>;
    /** The task folder a path belongs to, read from its record; none for a single worktree. */
    readonly find: (worktreePath: string) => Effect.Effect<Option.Option<TaskFolder>>;
    /**
     * Lays out a new task folder on `branch`, or on `branch-2` and so on when a repository has a
     * branch of that name already; the result says which. Each repository starts from `baseRef`
     * where it has a branch of that name, locally or on origin, and from its default branch
     * otherwise. A failure, or the launch being stopped, removes what was made.
     */
    readonly create: (input: {
      readonly projectId: ProjectId;
      readonly branch: string;
      readonly baseRef: string;
      /** The project folder's own start point, when it is a repository. */
      readonly projectStartRef: string;
      readonly repositories: ReadonlyArray<TaskFolderRepositoryChoice> | undefined;
      /** Each repository starts from origin's commit of its start branch, fetched first. */
      readonly startFromOrigin?: boolean;
    }) => Effect.Effect<TaskFolder & { readonly branch: string }, TaskFolderError>;
    /** Gives a running thread's task folder a worktree of one more repository. */
    readonly addRepository: (input: {
      readonly worktreePath: string;
      readonly branch: string;
      readonly repositoryPath: string;
    }) => Effect.Effect<TaskFolder, TaskFolderError>;
    /**
     * Removes a task folder: each repository's worktree through Git, then its links and the
     * folders left empty. A file outside every repository stays, and the folder with it, unless
     * the removal is forced; links are never followed, so the originals always stay.
     *
     * Without `inspect`, a checkout with changes stops a removal that is not forced before
     * anything is removed. With it, each checkout is decided on its own: one it keeps stays with
     * the folders around it, and the others go. `keepRecord` leaves the record so the folder can
     * be restored when its thread resumes; otherwise the record goes with the folder.
     */
    readonly remove: (input: {
      readonly taskFolder: TaskFolder;
      readonly force: boolean;
      readonly keepRecord?: boolean;
      /** Why a checkout stays, or null when it may go. */
      readonly inspect?: (checkout: TaskFolderCheckout) => Effect.Effect<string | null>;
    }) => Effect.Effect<TaskFolderRemoval, TaskFolderError>;
    /**
     * Puts back what is missing from a task folder: the project folder, laid out as it was made,
     * and each repository's worktree on `branch`. True when anything was recreated.
     */
    readonly restore: (input: {
      readonly taskFolder: TaskFolder;
      readonly branch: string;
    }) => Effect.Effect<boolean, TaskFolderError>;
  }
>()("t3/workspace/TaskFolders") {}

/** One Git checkout of a task folder: a repository's worktree, or the project folder's. */
export interface TaskFolderCheckout {
  readonly name: string;
  readonly repositoryPath: string;
  readonly worktreePath: string;
}

export interface TaskFolderRemoval {
  /** Checkouts and folders that were removed. */
  readonly removed: ReadonlyArray<string>;
  /** What stayed, and why. */
  readonly kept: ReadonlyArray<{ readonly path: string; readonly reason: string }>;
}

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const git = yield* GitWorkflow.GitWorkflowService;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const settings = yield* ServerSettings.ServerSettingsService;
  const config = yield* ServerConfig;

  // One change at a time per task folder: concurrent additions would each write their own record.
  const locks = new Map<string, Semaphore.Semaphore>();
  const withLock = <A, E, R>(root: string, effect: Effect.Effect<A, E, R>) =>
    Effect.suspend(() => {
      let lock = locks.get(root);
      if (lock === undefined) {
        lock = Semaphore.makeUnsafe(1);
        locks.set(root, lock);
      }
      return lock.withPermits(1)(effect);
    });

  /** Only a folder under a worktrees folder Test Rig manages is ever taken apart. */
  const isManaged = Effect.fnUntraced(function* (root: string) {
    const current = yield* settings.getSettings.pipe(Effect.orElseSucceed(() => null));
    const managed =
      current === null
        ? [config.worktreesDir]
        : managedWorktreesDirectories(current, config.worktreesDir, path);
    return managed.some((directory) => root !== directory && isWithinRoot(path, directory, root));
  });

  const failure = (operation: TaskFolderError["operation"], detail: string, cause?: unknown) =>
    new TaskFolderError({ operation, detail, ...(cause === undefined ? {} : { cause }) });

  const discovered = (workspaceRoot: string) =>
    discoverRepositories(workspaceRoot).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );

  const isGitRepository = (folder: string) =>
    fileSystem.exists(path.join(folder, ".git")).pipe(Effect.orElseSucceed(() => false));

  /** The project's other Git repositories: the ones inside it, then the added ones. */
  const projectRepositories = Effect.fnUntraced(function* (project: ProjectStore.ProjectRow) {
    const inside = yield* discovered(project.workspaceRoot);
    const taken = new Set(inside.map((folder) => folder.path));
    const added = yield* Effect.filter(
      project.addedFolders.filter((folder) => !taken.has(folder.path)),
      (folder) => isGitRepository(folder.path),
    );
    return [...inside, ...added];
  });

  const covers: TaskFolders["Service"]["covers"] = (project) =>
    discovered(project.workspaceRoot).pipe(
      Effect.flatMap((inside) =>
        inside.length > 0
          ? Effect.succeed(true)
          : Effect.map(
              Effect.filter(project.addedFolders, (folder) => isGitRepository(folder.path)),
              (added) => added.length > 0,
            ),
      ),
    );

  const find: TaskFolders["Service"]["find"] = (worktreePath) =>
    findTaskFolder(worktreePath).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );

  const writeRecord = (taskFolder: TaskFolder) =>
    encodeRecord(taskFolder).pipe(
      Effect.flatMap((json) =>
        fileSystem.writeFileString(path.join(taskFolder.root, TASK_FOLDER_RECORD_NAME), json),
      ),
      Effect.tap(() => Effect.sync(() => forgetTaskFolder(taskFolder.root))),
    );

  /**
   * Where a folder goes: under `root`, the anchor keeps its own name, so the project folder is
   * never `root` itself and the record beside it stays outside every repository.
   */
  const placeOf = (taskFolder: Pick<TaskFolder, "root" | "anchor">, folder: string) =>
    path.join(
      taskFolder.root,
      path.basename(taskFolder.anchor) || "root",
      path.relative(taskFolder.anchor, folder),
    );

  /** The deepest folder holding the project folder and every repository. */
  const commonAnchor = (folders: ReadonlyArray<string>) => {
    let anchor = path.resolve(folders[0]!);
    for (const folder of folders.slice(1)) {
      while (!isWithinRoot(path, anchor, path.resolve(folder))) {
        const parent = path.dirname(anchor);
        if (parent === anchor) break;
        anchor = parent;
      }
    }
    return anchor;
  };

  const branchExists = (cwd: string, branch: string) =>
    git.hasCommit({ cwd, refName: `refs/heads/${branch}` }).pipe(Effect.orElseSucceed(() => false));

  /**
   * Where a repository's new branch starts: `baseRef` when the repository has a branch of that
   * name, locally or on origin, else origin's default branch, else its current checkout. With
   * `startFromOrigin`, origin's commit of that branch, fetched first.
   */
  const repositoryStart = Effect.fnUntraced(function* (
    cwd: string,
    baseRef: string,
    startFromOrigin: boolean,
  ) {
    const has = (refName: string) =>
      git.hasCommit({ cwd, refName }).pipe(Effect.orElseSucceed(() => false));
    // Clients send `HEAD` when no base was chosen; as a name it would match `origin/HEAD`.
    const wanted = baseRef.replace(/^refs\/heads\//, "").replace(/^origin\//, "");
    const named = wanted !== "" && wanted !== "HEAD";
    if (named && (yield* has(`refs/heads/${wanted}`))) {
      if (startFromOrigin) {
        const remote = yield* git.fetchRemote({ cwd, remoteName: "origin", refName: wanted }).pipe(
          Effect.andThen(
            git.resolveRemoteTrackingCommit({
              cwd,
              refName: wanted,
              fallbackRemoteName: "origin",
            }),
          ),
          Effect.option,
        );
        if (Option.isSome(remote))
          return { refName: remote.value.commitSha, baseRefName: wanted } as const;
      }
      return { refName: wanted, baseRefName: wanted } as const;
    }
    if (named && (yield* has(`refs/remotes/origin/${wanted}`))) {
      if (startFromOrigin) {
        yield* git.fetchRemote({ cwd, remoteName: "origin", refName: wanted }).pipe(Effect.ignore);
      }
      return { refName: `origin/${wanted}`, baseRefName: `origin/${wanted}` } as const;
    }
    // Started from the commit, so the thread's branch does not track the default branch.
    if (startFromOrigin) {
      yield* git.fetchRemote({ cwd, remoteName: "origin" }).pipe(Effect.ignore);
    }
    if (yield* has("refs/remotes/origin/HEAD")) {
      const remoteHead = yield* git
        .resolveRemoteTrackingCommit({ cwd, refName: "HEAD", fallbackRemoteName: "origin" })
        .pipe(Effect.option);
      if (Option.isSome(remoteHead))
        return { refName: remoteHead.value.commitSha, baseRefName: undefined } as const;
    }
    return { refName: "HEAD", baseRefName: undefined } as const;
  });

  /** A worktree of `repositoryPath` at `place` on `branch`, started as `repositoryStart` says. */
  const addWorktree = Effect.fnUntraced(function* (input: {
    readonly repositoryPath: string;
    readonly place: string;
    readonly branch: string;
    readonly baseRef: string;
    readonly startFromOrigin?: boolean;
    /** A new thread's branch: Git refuses one that appeared meanwhile instead of adopting it. */
    readonly newBranch?: boolean;
  }) {
    yield* fileSystem.makeDirectory(path.dirname(input.place), { recursive: true });
    if (input.newBranch !== true && (yield* branchExists(input.repositoryPath, input.branch))) {
      yield* git.createWorktree({
        cwd: input.repositoryPath,
        refName: input.branch,
        path: input.place,
      });
      return;
    }
    const start = yield* repositoryStart(
      input.repositoryPath,
      input.baseRef,
      input.startFromOrigin === true,
    );
    yield* git.createWorktree({
      cwd: input.repositoryPath,
      refName: start.refName,
      newRefName: input.branch,
      ...(start.baseRefName === undefined ? {} : { baseRefName: start.baseRefName }),
      path: input.place,
    });
  });

  /**
   * Fills a plain project folder's copy: entries holding any repository become folders, so no
   * link leads into a checkout the thread must not change; repositories not chosen are left out;
   * everything else links to the original.
   */
  const linkEntries = Effect.fnUntraced(function* (input: {
    readonly source: string;
    readonly target: string;
    readonly chosen: ReadonlyArray<string>;
    readonly skipped: ReadonlyArray<string>;
  }): Effect.fn.Return<void, PlatformError.PlatformError> {
    yield* fileSystem.makeDirectory(input.target, { recursive: true });
    for (const name of yield* fileSystem.readDirectory(input.source)) {
      const entry = path.join(input.source, name);
      if (input.chosen.includes(entry) || input.skipped.includes(entry)) continue;
      if (
        [...input.chosen, ...input.skipped].some((repository) =>
          isWithinRoot(path, entry, repository),
        )
      ) {
        yield* linkEntries({ ...input, source: entry, target: path.join(input.target, name) });
        continue;
      }
      yield* fileSystem.symlink(entry, path.join(input.target, name));
    }
  });

  const exists = (target: string) =>
    fileSystem.exists(target).pipe(Effect.orElseSucceed(() => false));

  const depth = (target: string) => path.resolve(target).split(path.sep).length;

  /** Something is there already: a file, or a folder that is not empty. */
  const occupied = Effect.fnUntraced(function* (target: string) {
    if (!(yield* exists(target))) return false;
    const info = yield* fileSystem.stat(target).pipe(Effect.option);
    if (Option.isNone(info) || info.value.type !== "Directory") return true;
    return (
      (yield* fileSystem.readDirectory(target).pipe(Effect.orElseSucceed(() => [""]))).length > 0
    );
  });

  /** Every checkout, children before the checkouts that hold them, so each can go in order. */
  const checkoutsOf = (taskFolder: TaskFolder): ReadonlyArray<TaskFolderCheckout> => [
    ...taskFolder.repositories
      .toSorted((left, right) => depth(right.worktreePath) - depth(left.worktreePath))
      .map(({ name, repositoryPath, worktreePath }) => ({ name, repositoryPath, worktreePath })),
    ...(taskFolder.projectIsWorktree
      ? [
          {
            name: "the project folder",
            repositoryPath: taskFolder.projectRoot,
            worktreePath: taskFolder.projectPath,
          },
        ]
      : []),
  ];

  const removeCheckout = (checkout: TaskFolderCheckout, force: boolean) =>
    exists(checkout.worktreePath).pipe(
      Effect.flatMap((present) =>
        present
          ? git.removeWorktree({
              cwd: checkout.repositoryPath,
              path: checkout.worktreePath,
              force,
            })
          : git.pruneWorktrees({ cwd: checkout.repositoryPath }),
      ),
    );

  /**
   * Whether a folder between the task folder's root and `place` is a link: a worktree made there
   * would land in the original checkout.
   */
  const throughLink = Effect.fnUntraced(function* (root: string, place: string) {
    let current = path.dirname(place);
    while (isWithinRoot(path, root, current)) {
      if (Option.isSome(yield* fileSystem.readLink(current).pipe(Effect.option))) return true;
      if (current === root) break;
      current = path.dirname(current);
    }
    return false;
  });

  /** The Git directory a repository's worktrees are registered in, also for a linked worktree. */
  const commonGitDir = Effect.fnUntraced(function* (repositoryPath: string) {
    const dotGit = path.join(repositoryPath, ".git");
    const pointer = yield* fileSystem.readFileString(dotGit).pipe(Effect.option);
    if (Option.isNone(pointer)) return yield* fileSystem.realPath(dotGit).pipe(Effect.option);
    const gitDir = /^gitdir:\s*(.+?)\s*$/m.exec(pointer.value)?.[1];
    if (gitDir === undefined) return Option.none<string>();
    const linked = path.resolve(repositoryPath, gitDir);
    const common = yield* fileSystem
      .readFileString(path.join(linked, "commondir"))
      .pipe(Effect.option);
    return yield* fileSystem
      .realPath(Option.isSome(common) ? path.resolve(linked, common.value.trim()) : linked)
      .pipe(Effect.option);
  });

  /**
   * Whether `checkout` is its repository's own linked worktree, reached without a link: never a
   * link to the original checkout or a clone someone put there. Anything else is not the thread's
   * to clean, remove or work in.
   */
  const isOwnCheckout = Effect.fnUntraced(function* (
    root: string,
    checkout: Pick<TaskFolderCheckout, "repositoryPath" | "worktreePath">,
  ) {
    if (Option.isSome(yield* fileSystem.readLink(checkout.worktreePath).pipe(Effect.option)))
      return false;
    if (yield* throughLink(root, checkout.worktreePath)) return false;
    // A directory `.git` fails to read as a file: a clone, not a worktree.
    const pointer = yield* fileSystem
      .readFileString(path.join(checkout.worktreePath, ".git"))
      .pipe(Effect.option);
    if (Option.isNone(pointer)) return false;
    const gitDir = /^gitdir:\s*(.+?)\s*$/m.exec(pointer.value)?.[1];
    if (gitDir === undefined) return false;
    const realGitDir = yield* fileSystem
      .realPath(path.resolve(checkout.worktreePath, gitDir))
      .pipe(Effect.option);
    const commonDir = yield* commonGitDir(checkout.repositoryPath);
    return (
      Option.isSome(realGitDir) &&
      Option.isSome(commonDir) &&
      isWithinRoot(path, path.join(commonDir.value, "worktrees"), realGitDir.value)
    );
  });

  const hasChanges = (cwd: string) =>
    exists(cwd).pipe(
      Effect.flatMap((present) =>
        present
          ? git.localStatus({ cwd }).pipe(Effect.map((status) => status.hasWorkingTreeChanges))
          : Effect.succeed(false),
      ),
    );

  /**
   * Takes apart what is left once the worktrees are gone: links are unlinked (their originals
   * stay), folders are removed only once empty, and any other file stays where it is. Never
   * follows a link. True when nothing but the record was left.
   */
  const teardown = (folder: string): Effect.Effect<boolean> =>
    Effect.tryPromise(async () => {
      // Looked at first: a folder that stays keeps its links, so it can still be worked in.
      const onlyLinks = async (current: string): Promise<boolean> => {
        for (const entry of await NodeFSP.readdir(current, { withFileTypes: true })) {
          if (entry.isSymbolicLink()) continue;
          if (entry.isDirectory()) {
            if (!(await onlyLinks(path.join(current, entry.name)))) return false;
          } else if (!(current === folder && entry.name === TASK_FOLDER_RECORD_NAME)) {
            return false;
          }
        }
        return true;
      };
      if (!(await onlyLinks(folder))) return false;
      const sweep = async (current: string): Promise<boolean> => {
        let empty = true;
        for (const entry of await NodeFSP.readdir(current, { withFileTypes: true })) {
          const target = path.join(current, entry.name);
          if (entry.isSymbolicLink()) {
            await NodeFSP.unlink(target);
          } else if (entry.isDirectory()) {
            if (await sweep(target)) await NodeFSP.rmdir(target);
            else empty = false;
          } else if (!(current === folder && entry.name === TASK_FOLDER_RECORD_NAME)) {
            empty = false;
          }
        }
        return empty;
      };
      return await sweep(folder);
    }).pipe(Effect.orElseSucceed(() => false));

  const removeUnlocked = Effect.fnUntraced(function* (
    input: Parameters<TaskFolders["Service"]["remove"]>[0],
  ) {
    const { taskFolder, force, inspect } = input;
    if (!(yield* isManaged(taskFolder.root))) {
      return yield* failure("remove", `${taskFolder.root} is not in a worktree folder.`);
    }
    const checkouts = checkoutsOf(taskFolder);
    const foreign = new Set<string>();
    for (const checkout of checkouts) {
      if (!(yield* exists(checkout.worktreePath))) continue;
      if (!(yield* isOwnCheckout(taskFolder.root, checkout))) foreign.add(checkout.worktreePath);
    }
    if (inspect === undefined && foreign.size > 0) {
      return yield* failure(
        "remove",
        `${[...foreign][0]} is not this thread's worktree any more, so the folder was left as it is.`,
      );
    }
    if (inspect === undefined && !force) {
      // Checked before anything is removed, so a refusal leaves the whole folder as it was.
      for (const checkout of checkouts) {
        if (yield* hasChanges(checkout.worktreePath).pipe(Effect.orElseSucceed(() => true))) {
          return yield* failure("remove", `${checkout.name} has uncommitted changes.`);
        }
      }
    }
    const removed: string[] = [];
    const kept: Array<{ path: string; reason: string }> = [];
    for (const checkout of checkouts) {
      // A checkout holding one that stays cannot go without it.
      if (kept.some((entry) => isWithinRoot(path, checkout.worktreePath, entry.path))) {
        kept.push({ path: checkout.worktreePath, reason: "holds a repository that was kept" });
        continue;
      }
      if (!(yield* exists(checkout.worktreePath))) {
        yield* git.pruneWorktrees({ cwd: checkout.repositoryPath }).pipe(Effect.ignore);
        continue;
      }
      // Checked again here: what was missing a moment ago may be a link by now.
      if (
        foreign.has(checkout.worktreePath) ||
        !(yield* isOwnCheckout(taskFolder.root, checkout))
      ) {
        kept.push({ path: checkout.worktreePath, reason: "not this thread's worktree" });
        continue;
      }
      if (inspect === undefined) {
        yield* removeCheckout(checkout, force).pipe(
          Effect.mapError((cause) =>
            failure("remove", `Could not remove the worktree of ${checkout.name}.`, cause),
          ),
        );
      } else {
        const reason = yield* inspect(checkout);
        if (reason !== null) {
          kept.push({ path: checkout.worktreePath, reason });
          continue;
        }
        // Not forced: Git still refuses a checkout that gained changes since the inspection.
        const gone = yield* removeCheckout(checkout, false).pipe(
          Effect.as(true),
          Effect.catch(() => Effect.succeed(false)),
        );
        if (!gone) {
          kept.push({ path: checkout.worktreePath, reason: "Git could not remove it" });
          continue;
        }
      }
      removed.push(checkout.worktreePath);
    }
    // What stays keeps its folder and links, so it can still be worked in.
    if (kept.length > 0) return { removed, kept } satisfies TaskFolderRemoval;
    forgetTaskFolder(taskFolder.root);
    if (yield* teardown(taskFolder.root)) {
      if (input.keepRecord !== true) {
        yield* fileSystem
          .remove(path.join(taskFolder.root, TASK_FOLDER_RECORD_NAME))
          .pipe(Effect.ignore);
        yield* Effect.tryPromise(() => NodeFSP.rmdir(taskFolder.root)).pipe(Effect.ignore);
      }
      return { removed, kept } satisfies TaskFolderRemoval;
    }
    if (inspect === undefined && force) {
      // Forced, as for a single worktree: what is left are files the thread wrote beside the
      // links. Removal never follows a link, so the originals stay.
      forgetTaskFolder(taskFolder.root);
      yield* fileSystem
        .remove(taskFolder.root, { recursive: true })
        .pipe(
          Effect.mapError((cause) =>
            failure("remove", `Could not remove ${taskFolder.root}.`, cause),
          ),
        );
      return { removed: [...removed, taskFolder.root], kept } satisfies TaskFolderRemoval;
    }
    yield* Effect.logWarning("task folder kept files outside its repositories", {
      root: taskFolder.root,
    });
    if (inspect === undefined && !force) {
      return yield* failure(
        "remove",
        `The repositories' worktrees were removed; files outside them remain at ${taskFolder.root}.`,
      );
    }
    kept.push({ path: taskFolder.root, reason: "has files that exist only in this folder" });
    return { removed, kept } satisfies TaskFolderRemoval;
  });

  const remove: TaskFolders["Service"]["remove"] = (input) =>
    withLock(input.taskFolder.root, removeUnlocked(input)).pipe(
      Effect.mapError((cause) =>
        isTaskFolderError(cause)
          ? cause
          : failure("remove", "Could not remove the task folder.", cause),
      ),
      Effect.withSpan("TaskFolders.remove"),
    );

  const create: TaskFolders["Service"]["create"] = Effect.fn("TaskFolders.create")(
    function* (input) {
      const project = Option.getOrUndefined(
        yield* projects.get(input.projectId).pipe(Effect.orElseSucceed(() => Option.none())),
      );
      if (project === undefined) return yield* failure("create", "The project no longer exists.");
      // Every repository stays out of the links, but one with no commit yet has nothing to
      // branch from, so it gets no worktree either.
      const covered = yield* projectRepositories(project);
      const all = yield* Effect.filter(covered, (repository) =>
        git
          .hasCommit({ cwd: repository.path, refName: "HEAD" })
          .pipe(Effect.orElseSucceed(() => false)),
      );
      const unknown = (input.repositories ?? []).find(
        (choice) => !covered.some((repository) => repository.path === path.resolve(choice.path)),
      );
      if (unknown !== undefined) {
        return yield* failure(
          "create",
          `${unknown.path} is not one of the project's repositories.`,
        );
      }
      const chosen =
        input.repositories === undefined
          ? all.length <= TASK_FOLDER_DEFAULT_REPOSITORIES_MAX
            ? all
            : []
          : all.filter((repository) =>
              input.repositories!.some((choice) => path.resolve(choice.path) === repository.path),
            );
      const projectRoot = path.resolve(project.workspaceRoot);
      const projectIsWorktree = yield* isGitRepository(projectRoot);
      // A new thread's branch is new everywhere: an existing one would carry someone else's work,
      // so the name is one no checkout of the folder has yet.
      const branchNames = yield* Effect.forEach(
        [
          ...chosen.map((repository) => repository.path),
          ...(projectIsWorktree ? [projectRoot] : []),
        ],
        (cwd) => git.listLocalBranchNames(cwd).pipe(Effect.orElseSucceed(() => [])),
      );
      const branch = freeBranchName(input.branch, branchNames);
      if (branch === null) {
        return yield* failure(
          "create",
          `No branch name based on "${input.branch}" is free in every repository.`,
        );
      }
      // Laid out around every repository, so one added later still has a place.
      const anchor = commonAnchor([projectRoot, ...covered.map((repository) => repository.path)]);
      const parentDir = resolveWorktreesDirectory(
        (yield* settings.getSettings.pipe(Effect.orElseSucceed(() => null)))?.worktreesDirectory ??
          "",
        config.worktreesDir,
        path,
      );
      if (parentDir === null) {
        return yield* failure(
          "create",
          "The worktree location is not usable. Change it in Settings → Worktrees.",
        );
      }
      const root = path.join(parentDir, path.basename(projectRoot), branch.replaceAll("/", "-"));
      // Claimed with an exclusive create, so two launches can never share (or roll back) one.
      yield* fileSystem
        .makeDirectory(path.dirname(root), { recursive: true })
        .pipe(
          Effect.mapError((cause) =>
            failure("create", "Could not create the worktree folder.", cause),
          ),
        );
      yield* Effect.tryPromise(() => NodeFSP.mkdir(root)).pipe(
        Effect.mapError((cause) => failure("create", `A folder already exists at ${root}.`, cause)),
      );
      const taskFolder: TaskFolder = {
        root,
        projectId: project.projectId,
        projectRoot,
        anchor,
        projectPath: placeOf({ root, anchor }, projectRoot),
        projectIsWorktree,
        repositories: chosen.map((repository) => ({
          repositoryPath: repository.path,
          worktreePath: placeOf({ root, anchor }, repository.path),
          name: repository.name,
        })),
        baseRef: input.baseRef,
      };
      const made: Array<TaskFolder["repositories"][number]> = [];
      let projectMade = false;
      const build = Effect.gen(function* () {
        if (projectIsWorktree) {
          yield* fileSystem.makeDirectory(path.dirname(taskFolder.projectPath), {
            recursive: true,
          });
          yield* git.createWorktree({
            cwd: projectRoot,
            refName: input.projectStartRef,
            newRefName: branch,
            baseRefName: input.baseRef,
            path: taskFolder.projectPath,
          });
          projectMade = true;
        } else {
          yield* linkEntries({
            source: projectRoot,
            target: taskFolder.projectPath,
            chosen: chosen.map((repository) => repository.path),
            skipped: covered.map((repository) => repository.path),
          });
        }
        // Whatever the project's own checkout put at a repository's place (a post-checkout hook,
        // say) stands for it and for the repositories inside it; a link counts even when empty.
        const provided: string[] = [];
        for (const repository of taskFolder.repositories.toSorted(
          (left, right) => depth(left.worktreePath) - depth(right.worktreePath),
        )) {
          if (
            provided.some((place) => isWithinRoot(path, place, repository.worktreePath)) ||
            Option.isSome(
              yield* fileSystem.readLink(repository.worktreePath).pipe(Effect.option),
            ) ||
            (yield* occupied(repository.worktreePath))
          ) {
            provided.push(repository.worktreePath);
            continue;
          }
          yield* addWorktree({
            repositoryPath: repository.repositoryPath,
            place: repository.worktreePath,
            branch,
            baseRef: input.baseRef,
            startFromOrigin: input.startFromOrigin === true,
            newBranch: true,
          });
          made.push(repository);
        }
        const laidOut: TaskFolder = { ...taskFolder, repositories: made };
        yield* writeRecord(laidOut);
        return { ...laidOut, branch };
      });
      return yield* build.pipe(
        // Roll back what was made, also when the launch is stopped midway.
        Effect.onError(() =>
          remove({
            taskFolder: { ...taskFolder, projectIsWorktree: projectMade, repositories: made },
            force: true,
          }).pipe(Effect.ignore),
        ),
        Effect.mapError((cause) =>
          failure("create", "Could not lay out the thread's folder.", cause),
        ),
      );
    },
  );

  const addRepositoryUnlocked = Effect.fnUntraced(function* (input: {
    readonly root: string;
    readonly worktreePath: string;
    readonly branch: string;
    readonly repositoryPath: string;
  }) {
    // Read again under the lock: another addition may have changed the record meanwhile.
    forgetTaskFolder(input.root);
    const found = yield* find(input.worktreePath);
    if (Option.isNone(found)) {
      return yield* failure("add-repository", "This thread's folder is a single worktree.");
    }
    const taskFolder = found.value;
    const repositoryPath = path.resolve(input.repositoryPath);
    if (
      taskFolder.repositories.some((repository) => repository.repositoryPath === repositoryPath)
    ) {
      return taskFolder;
    }
    const project = Option.getOrUndefined(
      yield* projects.get(taskFolder.projectId).pipe(Effect.orElseSucceed(() => Option.none())),
    );
    const repository =
      project === undefined
        ? undefined
        : (yield* projectRepositories(project)).find((folder) => folder.path === repositoryPath);
    if (repository === undefined) {
      return yield* failure(
        "add-repository",
        "That folder is not one of the project's repositories.",
      );
    }
    // Outside the folder the task folder was laid out around, it has no place to go.
    if (!isWithinRoot(path, taskFolder.anchor, repositoryPath)) {
      return yield* failure(
        "add-repository",
        `${repository.name} sits outside this thread's folder; start a new worktree thread to include it.`,
      );
    }
    const place = placeOf(taskFolder, repositoryPath);
    // Every folder on the way must be a real folder inside the task folder: a link there would
    // put the worktree in the original checkout.
    if (yield* throughLink(taskFolder.root, place)) {
      return yield* failure(
        "add-repository",
        `${repository.name} sits in a folder this thread shares with the project; start a new worktree thread to include it.`,
      );
    }
    // In a plain project folder the place itself may be a link to the original.
    const existing = yield* fileSystem.readLink(place).pipe(Effect.option);
    if (Option.isSome(existing)) yield* fileSystem.remove(place);
    yield* addWorktree({
      repositoryPath,
      place,
      branch: input.branch,
      baseRef: taskFolder.baseRef ?? input.branch,
    });
    const updated: TaskFolder = {
      ...taskFolder,
      repositories: [
        ...taskFolder.repositories,
        { repositoryPath, worktreePath: place, name: repository.name },
      ],
    };
    yield* writeRecord(updated);
    return updated;
  });

  const addRepository: TaskFolders["Service"]["addRepository"] = (input) =>
    find(input.worktreePath).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(failure("add-repository", "This thread's folder is a single worktree.")),
          onSome: (taskFolder) =>
            withLock(taskFolder.root, addRepositoryUnlocked({ ...input, root: taskFolder.root })),
        }),
      ),
      Effect.mapError((cause) =>
        isTaskFolderError(cause)
          ? cause
          : failure("add-repository", "Could not add the repository's worktree.", cause),
      ),
      Effect.withSpan("TaskFolders.addRepository"),
    );

  const restoreUnlocked = Effect.fnUntraced(function* (input: {
    readonly taskFolder: TaskFolder;
    readonly branch: string;
  }) {
    const { taskFolder, branch } = input;
    if (!(yield* isManaged(taskFolder.root))) return false;
    // A branch deleted meanwhile starts again where the folder first did.
    const baseRef = taskFolder.baseRef ?? branch;
    let restored = false;
    const notOwn = (name: string) =>
      failure(
        "create",
        `${name} in this thread's folder is not the thread's worktree. Move it away to continue the thread.`,
      );
    if (yield* throughLink(taskFolder.root, taskFolder.projectPath)) {
      return yield* notOwn("The project folder");
    }
    if (taskFolder.projectIsWorktree) {
      if (yield* exists(taskFolder.projectPath)) {
        if (
          !(yield* isOwnCheckout(taskFolder.root, {
            repositoryPath: taskFolder.projectRoot,
            worktreePath: taskFolder.projectPath,
          }))
        ) {
          return yield* notOwn("The project folder");
        }
      } else {
        yield* git.pruneWorktrees({ cwd: taskFolder.projectRoot }).pipe(Effect.ignore);
        yield* addWorktree({
          repositoryPath: taskFolder.projectRoot,
          place: taskFolder.projectPath,
          branch,
          baseRef,
        });
        restored = true;
      }
    } else if (
      Option.isSome(yield* fileSystem.readLink(taskFolder.projectPath).pipe(Effect.option))
    ) {
      return yield* notOwn("The project folder");
    } else if (!(yield* exists(taskFolder.projectPath))) {
      const project = Option.getOrUndefined(
        yield* projects.get(taskFolder.projectId).pipe(Effect.orElseSucceed(() => Option.none())),
      );
      const recorded = taskFolder.repositories.map((repository) => repository.repositoryPath);
      const current =
        project === undefined
          ? []
          : (yield* projectRepositories(project)).map((repository) => repository.path);
      yield* linkEntries({
        source: taskFolder.projectRoot,
        target: taskFolder.projectPath,
        chosen: recorded,
        skipped: [...current, ...recorded],
      });
      restored = true;
    }
    for (const repository of taskFolder.repositories.toSorted(
      (left, right) => depth(left.worktreePath) - depth(right.worktreePath),
    )) {
      if (yield* exists(repository.worktreePath)) {
        if (!(yield* isOwnCheckout(taskFolder.root, repository))) {
          return yield* notOwn(repository.name);
        }
        continue;
      }
      if (
        Option.isSome(yield* fileSystem.readLink(repository.worktreePath).pipe(Effect.option)) ||
        (yield* throughLink(taskFolder.root, repository.worktreePath))
      ) {
        return yield* failure(
          "create",
          `${repository.name} sits in a folder this thread shares with the project, so its worktree was not recreated.`,
        );
      }
      yield* git.pruneWorktrees({ cwd: repository.repositoryPath }).pipe(Effect.ignore);
      yield* addWorktree({
        repositoryPath: repository.repositoryPath,
        place: repository.worktreePath,
        branch,
        baseRef,
      });
      restored = true;
    }
    return restored;
  });

  const restore: TaskFolders["Service"]["restore"] = (input) =>
    withLock(input.taskFolder.root, restoreUnlocked(input)).pipe(
      Effect.mapError((cause) =>
        isTaskFolderError(cause)
          ? cause
          : failure("create", "Could not recreate the thread's folder.", cause),
      ),
      Effect.withSpan("TaskFolders.restore"),
    );

  return TaskFolders.of({ covers, find, create, addRepository, remove, restore });
});

export const layer = Layer.effect(TaskFolders, make);

/** For tests of single-repository projects: none covers other repositories. */
export const layerTest = Layer.succeed(
  TaskFolders,
  TaskFolders.of({
    covers: () => Effect.succeed(false),
    find: () => Effect.succeed(Option.none()),
    create: () => Effect.die("TaskFolders.create is not available in tests."),
    addRepository: () => Effect.die("TaskFolders.addRepository is not available in tests."),
    remove: () => Effect.succeed({ removed: [], kept: [] }),
    restore: () => Effect.succeed(false),
  }),
);
