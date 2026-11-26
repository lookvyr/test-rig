import * as Schema from "effect/Schema";

import { ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/** `git` folders are repositories with their own history; `plain` folders are only files. */
export const WorkspaceFolderState = Schema.Literals(["git", "plain", "missing"]);
export type WorkspaceFolderState = typeof WorkspaceFolderState.Type;

export const WorkspaceFolder = Schema.Struct({
  name: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
  state: WorkspaceFolderState,
  /** Found inside the project folder by the server, not added by someone. */
  discovered: Schema.Boolean,
  /** A task folder's worktree: the project's path for the repository it checks out. */
  repositoryPath: Schema.optional(TrimmedNonEmptyString),
});
export type WorkspaceFolder = typeof WorkspaceFolder.Type;

export const WorkspaceListFoldersInput = Schema.Struct({
  projectId: ProjectId,
  /**
   * A thread's own worktree. Its task folder's repositories are then listed instead of the
   * project's checkouts; a single worktree lists none.
   */
  worktreePath: Schema.optional(TrimmedNonEmptyString),
});
export type WorkspaceListFoldersInput = typeof WorkspaceListFoldersInput.Type;

export const WorkspaceListFoldersResult = Schema.Struct({
  /** Whether the project folder itself is a Git repository. */
  projectIsGitRepository: Schema.Boolean,
  /** The repositories found inside the project folder now, then the folders someone added. */
  folders: Schema.Array(WorkspaceFolder),
  /**
   * Folders the project folder's `.code-workspace` file lists outside the project that are not
   * added yet. Offered, never added on their own: adding one grants agents a new place.
   */
  suggestions: Schema.Array(
    Schema.Struct({
      name: TrimmedNonEmptyString,
      path: TrimmedNonEmptyString,
      isGitRepository: Schema.Boolean,
    }),
  ),
  /** The `.code-workspace` file the suggestions came from, when one was read. */
  codeWorkspaceFile: Schema.NullOr(TrimmedNonEmptyString),
  /** Set when the listed `worktreePath` is a task folder, even one with no repositories yet. */
  isTaskFolder: Schema.optional(Schema.Boolean),
});
export type WorkspaceListFoldersResult = typeof WorkspaceListFoldersResult.Type;

export class WorkspaceFoldersError extends Schema.TaggedError<WorkspaceFoldersError>()(
  "WorkspaceFoldersError",
  {
    operation: Schema.Literals(["list"]),
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

/** A new worktree thread gives every repository a worktree by default only up to this many. */
export const TASK_FOLDER_DEFAULT_REPOSITORIES_MAX = 8;

/** One repository's worktree inside a thread's task folder. */
export const TaskFolderRepository = Schema.Struct({
  /** The project's path for the repository. */
  repositoryPath: TrimmedNonEmptyString,
  worktreePath: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
});
export type TaskFolderRepository = typeof TaskFolderRepository.Type;

/**
 * The folder a worktree thread of a project with several repositories works in: the project
 * folder and each chosen repository at the same relative places, every repository on the
 * thread's branch.
 */
export const TaskFolder = Schema.Struct({
  root: TrimmedNonEmptyString,
  projectId: ProjectId,
  /** The project folder it was laid out from. */
  projectRoot: TrimmedNonEmptyString,
  /** The folder `root` stands in for: a path below it sits at the same place below `root`. */
  anchor: TrimmedNonEmptyString,
  /** Where the project folder sits inside `root`: the thread's `worktreePath`. */
  projectPath: TrimmedNonEmptyString,
  /** False when the project folder is not a repository: its other entries are then links. */
  projectIsWorktree: Schema.Boolean,
  repositories: Schema.Array(TaskFolderRepository),
  /** The base the thread was launched from; repositories added later start from it too. */
  baseRef: Schema.optional(TrimmedNonEmptyString),
});
export type TaskFolder = typeof TaskFolder.Type;

export const WorkspaceAddTaskFolderRepositoryInput = Schema.Struct({
  threadId: ThreadId,
  /** One of the project's Git repositories. */
  repositoryPath: TrimmedNonEmptyString,
});
export type WorkspaceAddTaskFolderRepositoryInput =
  typeof WorkspaceAddTaskFolderRepositoryInput.Type;

export class TaskFolderError extends Schema.TaggedError<TaskFolderError>()("TaskFolderError", {
  operation: Schema.Literals(["create", "add-repository", "remove"]),
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.detail;
  }
}
