import type {
  CheckpointId,
  CheckpointRef,
  CheckpointScopeId,
  MessageId,
  OrchestrationV2CheckpointFileTotals,
  OrchestrationV2ThreadProjection,
  RunId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

export interface ThreadCheckpointSummary {
  readonly checkpointId?: CheckpointId;
  readonly scopeId?: CheckpointScopeId;
  readonly runId: RunId;
  readonly checkpointTurnCount: number;
  readonly checkpointRef: CheckpointRef;
  readonly status: "ready" | "missing" | "error" | "stale";
  /** A prefix of the changed files when `filesTotal` is set; see `checkpointFileTotals`. */
  readonly files: ReadonlyArray<{
    readonly path: string;
    readonly kind: string;
    readonly additions: number;
    readonly deletions: number;
  }>;
  readonly filesTotal?: OrchestrationV2CheckpointFileTotals;
  readonly assistantMessageId: MessageId | null;
  readonly completedAt: string;
}

/**
 * Derives the checkpoint/diff rows needed by review UIs from native V2 entities. A turn's files
 * include the other repositories it changed, each under the folder it sits in, so `api/src/x.ts`
 * and `web/src/x.ts` stay apart and match the paths in the turn's patch.
 */
export function deriveThreadCheckpointSummaries(
  projection: Pick<
    OrchestrationV2ThreadProjection,
    "checkpoints" | "checkpointScopes" | "messages"
  >,
): ReadonlyArray<ThreadCheckpointSummary> {
  const repositoryFilesByRun = deriveRepositoryFilesByRun(projection);
  return projection.checkpoints.flatMap((checkpoint) => {
    if (checkpoint.appRunOrdinal === null || checkpoint.runId === null) return [];
    const assistantMessageId =
      projection.messages.findLast(
        (message) => message.runId === checkpoint.runId && message.role === "assistant",
      )?.id ?? null;
    const repositories = repositoryFilesByRun.get(checkpoint.runId);
    if (repositories === undefined) {
      return [
        {
          checkpointId: checkpoint.id,
          scopeId: checkpoint.scopeId,
          runId: checkpoint.runId,
          checkpointTurnCount: checkpoint.appRunOrdinal,
          checkpointRef: checkpoint.ref,
          status: checkpoint.status,
          files: checkpoint.files,
          ...(checkpoint.filesTotal === undefined ? {} : { filesTotal: checkpoint.filesTotal }),
          assistantMessageId,
          completedAt: DateTime.formatIso(checkpoint.capturedAt),
        },
      ];
    }
    const own = checkpointFileTotals(checkpoint);
    const added = repositories.totals;
    return [
      {
        checkpointId: checkpoint.id,
        scopeId: checkpoint.scopeId,
        runId: checkpoint.runId,
        checkpointTurnCount: checkpoint.appRunOrdinal,
        checkpointRef: checkpoint.ref,
        // A plain folder has no snapshots of its own; its repositories' changes still show.
        status: "ready",
        files: [...checkpoint.files, ...repositories.files],
        filesTotal: {
          count: own.count + added.count,
          additions: own.additions + added.additions,
          deletions: own.deletions + added.deletions,
        },
        assistantMessageId,
        completedAt: DateTime.formatIso(checkpoint.capturedAt),
      },
    ];
  });
}

interface RunRepositoryFiles {
  readonly files: Array<ThreadCheckpointSummary["files"][number]>;
  readonly totals: { count: number; additions: number; deletions: number };
}

/** Each run's changed files in the thread's other repositories, prefixed by their folder. */
function deriveRepositoryFilesByRun(
  projection: Pick<OrchestrationV2ThreadProjection, "checkpoints" | "checkpointScopes">,
): ReadonlyMap<RunId, RunRepositoryFiles> {
  const prefixes = new Map<CheckpointScopeId, string>();
  for (const scope of projection.checkpointScopes) {
    if (scope.kind === "repository" && scope.relativePath !== undefined) {
      prefixes.set(scope.id, scope.relativePath);
    }
  }
  const byRun = new Map<RunId, RunRepositoryFiles>();
  if (prefixes.size === 0) return byRun;
  for (const checkpoint of projection.checkpoints) {
    const prefix = prefixes.get(checkpoint.scopeId);
    if (prefix === undefined || checkpoint.runId === null || checkpoint.files.length === 0) {
      continue;
    }
    const entry = byRun.get(checkpoint.runId) ?? {
      files: [],
      totals: { count: 0, additions: 0, deletions: 0 },
    };
    for (const file of checkpoint.files)
      entry.files.push({ ...file, path: `${prefix}/${file.path}` });
    // Long lists arrive capped, with their totals alongside.
    const totals = checkpointFileTotals(checkpoint);
    entry.totals.count += totals.count;
    entry.totals.additions += totals.additions;
    entry.totals.deletions += totals.deletions;
    byRun.set(checkpoint.runId, entry);
  }
  return byRun;
}

export function checkpointFileTotals(
  checkpoint: Pick<ThreadCheckpointSummary, "files" | "filesTotal">,
): OrchestrationV2CheckpointFileTotals {
  if (checkpoint.filesTotal !== undefined) return checkpoint.filesTotal;
  let additions = 0;
  let deletions = 0;
  for (const file of checkpoint.files) {
    additions += file.additions;
    deletions += file.deletions;
  }
  return { count: checkpoint.files.length, additions, deletions };
}
