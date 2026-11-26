import { type TaskFolder, TaskFolder as TaskFolderSchema } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

/** Beside the project folder, never inside it, so it is not part of any repository. */
export const TASK_FOLDER_RECORD_NAME = ".t3-task-folder.json";
// How far above a thread's folder its record can be: the project folder's depth below the anchor.
const RECORD_SEARCH_DEPTH = 12;

const decodeRecord = Schema.decodeUnknownEffect(Schema.fromJsonString(TaskFolderSchema));

const isWithin = (path: Path.Path, root: string, target: string) => {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

// Records change only when Test Rig lays out, extends or removes a task folder.
const cache = new Map<string, TaskFolder>();

/** Drops a cached record after its task folder changed. */
export const forgetTaskFolder = (root: string) => {
  cache.delete(root);
};

/**
 * The task folder a thread's folder belongs to, from the record at its root; none for a single
 * worktree. A record only names places inside its own folder, so it can never widen what agents
 * are granted.
 */
export const findTaskFolder = Effect.fn("findTaskFolder")(function* (worktreePath: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const target = path.resolve(worktreePath);
  let current = target;
  for (let depth = 0; depth < RECORD_SEARCH_DEPTH; depth++) {
    const cached = cache.get(current);
    if (cached !== undefined) {
      return cached.projectPath === target ? Option.some(cached) : Option.none<TaskFolder>();
    }
    const record = yield* fileSystem
      .readFileString(path.join(current, TASK_FOLDER_RECORD_NAME))
      .pipe(Effect.flatMap(decodeRecord), Effect.option);
    if (Option.isSome(record)) {
      const taskFolder = record.value;
      // The record must name exactly this thread's folder: a stray record further up never makes
      // an ordinary worktree part of a larger folder.
      const valid =
        taskFolder.root === current &&
        isWithin(path, current, taskFolder.projectPath) &&
        taskFolder.projectPath === target &&
        taskFolder.repositories.every((repository) =>
          isWithin(path, current, repository.worktreePath),
        );
      if (!valid) return Option.none<TaskFolder>();
      cache.set(current, taskFolder);
      return Option.some(taskFolder);
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return Option.none<TaskFolder>();
});
