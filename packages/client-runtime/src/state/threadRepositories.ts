import type {
  OrchestrationV2CheckpointScope,
  OrchestrationV2ThreadProjection,
  WorkspaceListFoldersResult,
} from "@t3tools/contracts";

/** One repository listed in a thread's details, with its own Git state and actions. */
export interface ThreadRepository {
  /** The project's path for the repository; stable when the checkout moves. */
  readonly key: string;
  readonly name: string;
  /** Where the thread's checkout of it is. */
  readonly cwd: string;
}

/** How many repositories show before "Show more". */
export const THREAD_REPOSITORIES_VISIBLE = 3;

/**
 * The thread's other repositories that its turns changed, most recently changed first. Read from
 * its sparse repository checkpoints, so one a turn left alone is not listed.
 */
export function threadChangedRepositories(
  projection: Pick<OrchestrationV2ThreadProjection, "checkpoints" | "checkpointScopes">,
): ReadonlyArray<ThreadRepository> {
  const lastChanged = new Map<string, number>();
  for (const checkpoint of projection.checkpoints) {
    if (checkpoint.runId === null || checkpoint.files.length === 0) continue;
    const previous = lastChanged.get(checkpoint.scopeId) ?? -1;
    if (checkpoint.ordinalWithinScope > previous) {
      lastChanged.set(checkpoint.scopeId, checkpoint.ordinalWithinScope);
    }
  }
  return projection.checkpointScopes
    .filter((scope) => scope.kind === "repository" && lastChanged.has(scope.id))
    .toSorted((left, right) => (lastChanged.get(right.id) ?? 0) - (lastChanged.get(left.id) ?? 0))
    .map((scope) => ({
      key: scope.repositoryPath ?? scope.cwd,
      name: scope.label ?? scope.cwd,
      cwd: scope.cwd,
    }));
}

/**
 * The repositories a thread's details list: the ones it changed, then the ones someone picked,
 * without repeats. The thread's own folder has its own controls, so it is never listed here.
 */
export function threadRepositorySections(input: {
  readonly changed: ReadonlyArray<ThreadRepository>;
  readonly picked: ReadonlyArray<ThreadRepository>;
  readonly threadCwd: string | null;
  readonly showAll: boolean;
}): {
  readonly visible: ReadonlyArray<ThreadRepository>;
  readonly hidden: ReadonlyArray<ThreadRepository>;
} {
  const seen = new Set<string>();
  const all = [...input.changed, ...input.picked].filter((repository) => {
    if (repository.cwd === input.threadCwd || seen.has(repository.key)) return false;
    seen.add(repository.key);
    return true;
  });
  return input.showAll
    ? { visible: all, hidden: [] }
    : {
        visible: all.slice(0, THREAD_REPOSITORIES_VISIBLE),
        hidden: all.slice(THREAD_REPOSITORIES_VISIBLE),
      };
}

/** A worktree thread's task folder repositories, each bound to the thread's own worktree. */
export function taskFolderRepositories(
  folders: WorkspaceListFoldersResult,
): ReadonlyArray<ThreadRepository> {
  return folders.folders
    .filter((folder) => folder.state === "git")
    .map((folder) => ({
      key: folder.repositoryPath ?? folder.path,
      name: folder.name,
      cwd: folder.path,
    }));
}

/** The project's repositories a thread's details do not list yet, for "Other repositories...". */
export function otherThreadRepositories(input: {
  readonly folders: WorkspaceListFoldersResult;
  readonly listed: ReadonlyArray<ThreadRepository>;
  readonly threadCwd: string | null;
}): ReadonlyArray<ThreadRepository> {
  const listed = new Set(input.listed.map((repository) => repository.key));
  return input.folders.folders
    .filter(
      (folder) =>
        folder.state === "git" && !listed.has(folder.path) && folder.path !== input.threadCwd,
    )
    .map((folder) => ({ key: folder.path, name: folder.name, cwd: folder.path }));
}

/** Where a file of one of the thread's other repositories is on disk. */
export interface ThreadRepositoryFile {
  /** The thread's checkout of the repository. */
  readonly cwd: string;
  /** The file's path inside the repository. */
  readonly path: string;
  /** False for a repository outside the thread's folder, such as an added folder. */
  readonly insideThreadFolder: boolean;
}

/**
 * The repository a turn file belongs to, for a path as turn diffs name it: from the thread's
 * folder, under the repository's folder (`../lib/src/x.ts`). Null for the thread's own files, and
 * for a path no repository scope of the thread claims, so `..` never reaches an unknown folder.
 */
export function threadRepositoryFile(
  scopes: ReadonlyArray<Pick<OrchestrationV2CheckpointScope, "kind" | "cwd" | "relativePath">>,
  filePath: string,
): ThreadRepositoryFile | null {
  let match: { readonly relativePath: string; readonly cwd: string } | null = null;
  for (const scope of scopes) {
    if (scope.kind !== "repository" || scope.relativePath === undefined) continue;
    if (!filePath.startsWith(`${scope.relativePath}/`)) continue;
    if (match === null || scope.relativePath.length > match.relativePath.length) {
      match = { relativePath: scope.relativePath, cwd: scope.cwd };
    }
  }
  if (match === null) return null;
  const path = filePath.slice(match.relativePath.length + 1);
  if (path.split("/").some((segment) => segment === "..")) return null;
  return {
    cwd: match.cwd,
    path,
    insideThreadFolder: match.relativePath !== ".." && !match.relativePath.startsWith("../"),
  };
}
