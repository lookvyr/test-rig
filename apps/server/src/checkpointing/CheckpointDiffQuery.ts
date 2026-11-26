/**
 * CheckpointDiffQuery - Query interface for computed checkpoint diffs.
 *
 * Provides read-only diff operations across checkpoint snapshots used by
 * orchestration APIs.
 *
 * @module CheckpointDiffQuery
 */
import {
  OrchestrationGetTurnDiffResult,
  type OrchestrationGetFullThreadDiffInput,
  type OrchestrationGetFullThreadDiffResult,
  type OrchestrationGetTurnDiffInput,
  type OrchestrationGetTurnDiffResult as OrchestrationGetTurnDiffResultType,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { checkpointRefForScopeOrdinal } from "../orchestration-v2/CheckpointService.ts";
import type { ProjectionCheckpointContext } from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import {
  CheckpointDiffResultInvalidError,
  CheckpointRefUnavailableError,
  CheckpointThreadNotFoundError,
  CheckpointTurnRangeUnavailableError,
  CheckpointWorkspacePathMissingError,
  type CheckpointServiceError,
} from "./Errors.ts";
import * as CheckpointStore from "./CheckpointStore.ts";

/** Service tag for checkpoint diff queries. */
export class CheckpointDiffQuery extends Context.Service<
  CheckpointDiffQuery,
  {
    /**
     * Read the patch diff for a single turn checkpoint transition.
     *
     * Verifies checkpoint availability in both projection state and filesystem.
     */
    readonly getTurnDiff: (
      input: OrchestrationGetTurnDiffInput,
    ) => Effect.Effect<OrchestrationGetTurnDiffResultType, CheckpointServiceError>;

    /**
     * Read the full patch diff across a thread range of checkpoints.
     *
     * Uses turn-diff semantics with `fromTurnCount = 0`.
     */
    readonly getFullThreadDiff: (
      input: OrchestrationGetFullThreadDiffInput,
    ) => Effect.Effect<OrchestrationGetFullThreadDiffResult, CheckpointServiceError>;
  }
>()("t3/checkpointing/CheckpointDiffQuery") {}

const isTurnDiffResult = Schema.is(OrchestrationGetTurnDiffResult);
// What one repository's patch is capped at; several repositories share it.
const TURN_PATCH_MAX_LENGTH = 10_000_000;

function buildTurnDiffResult(
  input: {
    readonly threadId: ThreadId;
    readonly fromTurnCount: number;
    readonly toTurnCount: number;
  },
  diff: string,
): OrchestrationGetTurnDiffResultType {
  return {
    threadId: input.threadId,
    fromTurnCount: input.fromTurnCount,
    toTurnCount: input.toTurnCount,
    diff,
  };
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const threads = yield* ThreadManagement.ThreadManagementService;
  const checkpointStore = yield* CheckpointStore.CheckpointStore;

  /**
   * The patches of the thread's other repositories over a turn range, each under the folder it
   * sits in. Their records are sparse: a repository shows only when a run in the range changed
   * it, diffed from its state before the first such run to its state after the last.
   */
  const repositoryDiffs = Effect.fn("CheckpointDiffQuery.repositoryDiffs")(function* (
    projection: ProjectionCheckpointContext,
    range: { readonly fromTurnCount: number; readonly toTurnCount: number },
    ignoreWhitespace: boolean,
  ) {
    const scopes = projection.checkpointScopes.filter(
      (scope) => scope.kind === "repository" && typeof scope.relativePath === "string",
    );
    const patches = yield* Effect.forEach(
      scopes,
      (scope) => {
        const records = projection.checkpoints
          .filter(
            (checkpoint) =>
              checkpoint.scopeId === scope.id &&
              checkpoint.status === "ready" &&
              checkpoint.ordinalWithinScope >= range.fromTurnCount &&
              checkpoint.ordinalWithinScope <= range.toTurnCount,
          )
          .toSorted((left, right) => left.ordinalWithinScope - right.ordinalWithinScope);
        const changed = records.some(
          (checkpoint) =>
            checkpoint.runId !== null && checkpoint.ordinalWithinScope > range.fromTurnCount,
        );
        const from = records[0];
        // The state after the last run in the range that changed it: a later run's baseline can
        // share the range's last ordinal, and it may hold edits made after the range.
        const to = records.findLast((checkpoint) => checkpoint.runId !== null);
        // The earliest record must be the state the range starts from: the start itself, or the
        // baseline taken before the first run in the range that changed the repository.
        if (
          !changed ||
          from === undefined ||
          to === undefined ||
          from === to ||
          (from.runId !== null && from.ordinalWithinScope !== range.fromTurnCount)
        ) {
          return Effect.succeed("");
        }
        return checkpointStore
          .diffCheckpoints({
            cwd: scope.cwd,
            fromCheckpointRef: from.ref,
            toCheckpointRef: to.ref,
            fallbackFromToHead: false,
            ignoreWhitespace,
            pathPrefix: scope.relativePath as string,
          })
          .pipe(
            Effect.catch((cause) =>
              Effect.logWarning("Could not diff a repository's checkpoints.", {
                scopeId: scope.id,
                cause: String(cause),
              }).pipe(Effect.as("")),
            ),
          );
      },
      { concurrency: 4 },
    );
    // Each repository's patch is already capped; the whole turn keeps the same bound.
    let budget = TURN_PATCH_MAX_LENGTH;
    return patches.filter((patch) => {
      if (patch === "" || budget <= 0) return false;
      budget -= patch.length;
      return true;
    });
  });

  const joinPatches = (patches: ReadonlyArray<string>) =>
    patches
      .filter((patch) => patch !== "")
      .map((patch) => (patch.endsWith("\n") ? patch : `${patch}\n`))
      .join("");

  const getTurnDiff: CheckpointDiffQuery["Service"]["getTurnDiff"] = Effect.fn("getTurnDiff")(
    function* (input) {
      const operation = "CheckpointDiffQuery.getTurnDiff";
      const ignoreWhitespace = input.ignoreWhitespace ?? true;
      yield* Effect.annotateCurrentSpan({
        "checkpoint.thread_id": input.threadId,
        "checkpoint.from_turn_count": input.fromTurnCount,
        "checkpoint.to_turn_count": input.toTurnCount,
        "checkpoint.ignore_whitespace": ignoreWhitespace,
      });

      if (input.fromTurnCount === input.toTurnCount) {
        const emptyDiff = buildTurnDiffResult(input, "");
        if (!isTurnDiffResult(emptyDiff)) {
          return yield* new CheckpointDiffResultInvalidError({
            operation,
            threadId: input.threadId,
          });
        }
        return emptyDiff;
      }

      const projection = yield* threads.getCheckpointContext(input.threadId).pipe(
        Effect.mapError(
          () =>
            new CheckpointThreadNotFoundError({
              operation,
              threadId: input.threadId,
            }),
        ),
        Effect.withSpan("checkpoint.turnDiff.lookupContext"),
      );
      const completedRunIds = new Set(
        projection.runs.filter((run) => run.status === "completed").map((run) => run.id),
      );
      // A thread that reaches other repositories may have no snapshots of its own folder (a plain
      // folder of repositories), so its turns are the completed runs and its folder's patch is
      // added when there is one.
      if (projection.checkpointScopes.some((scope) => scope.kind === "repository")) {
        const maxRunOrdinal = projection.runs.reduce(
          (max, run) => (run.status === "completed" ? Math.max(max, run.ordinal) : max),
          0,
        );
        if (input.toTurnCount > maxRunOrdinal) {
          return yield* new CheckpointTurnRangeUnavailableError({
            operation,
            threadId: input.threadId,
            requestedTurnCount: input.toTurnCount,
            availableTurnCount: maxRunOrdinal,
          });
        }
        const [rootPatch, repositoryPatches] = yield* Effect.all(
          [
            rootDiff(projection, completedRunIds, input, ignoreWhitespace).pipe(
              Effect.orElseSucceed(() => ""),
            ),
            repositoryDiffs(projection, input, ignoreWhitespace),
          ],
          { concurrency: 2 },
        );
        const combined = buildTurnDiffResult(input, joinPatches([rootPatch, ...repositoryPatches]));
        if (!isTurnDiffResult(combined)) {
          return yield* new CheckpointDiffResultInvalidError({
            operation,
            threadId: input.threadId,
          });
        }
        return combined;
      }
      const diff = yield* rootDiff(projection, completedRunIds, input, ignoreWhitespace);
      const turnDiff = buildTurnDiffResult(input, diff);
      if (!isTurnDiffResult(turnDiff)) {
        return yield* new CheckpointDiffResultInvalidError({
          operation,
          threadId: input.threadId,
        });
      }

      return turnDiff;
    },
  );

  /** The thread folder's own patch over a turn range, from its root scope's snapshots. */
  const rootDiff = Effect.fn("CheckpointDiffQuery.rootDiff")(function* (
    projection: ProjectionCheckpointContext,
    completedRunIds: ReadonlySet<string>,
    input: OrchestrationGetTurnDiffInput,
    ignoreWhitespace: boolean,
  ) {
    const operation = "CheckpointDiffQuery.getTurnDiff";
    const readyCheckpoints = projection.checkpoints.filter(
      (checkpoint) =>
        checkpoint.status === "ready" &&
        checkpoint.appRunOrdinal !== null &&
        checkpoint.runId !== null &&
        completedRunIds.has(checkpoint.runId),
    );
    const maxTurnCount = readyCheckpoints.reduce(
      (max, checkpoint) => Math.max(max, checkpoint.appRunOrdinal ?? 0),
      0,
    );
    if (input.toTurnCount > maxTurnCount) {
      return yield* new CheckpointTurnRangeUnavailableError({
        operation,
        threadId: input.threadId,
        requestedTurnCount: input.toTurnCount,
        availableTurnCount: maxTurnCount,
      });
    }

    const toCheckpoint = readyCheckpoints.find(
      (checkpoint) => checkpoint.appRunOrdinal === input.toTurnCount,
    );
    if (toCheckpoint === undefined) {
      return yield* new CheckpointRefUnavailableError({
        operation,
        threadId: input.threadId,
        turnCount: input.toTurnCount,
        checkpoint: "to",
      });
    }

    const toScope = projection.checkpointScopes.find((scope) => scope.id === toCheckpoint.scopeId);
    if (toScope === undefined) {
      return yield* new CheckpointWorkspacePathMissingError({
        operation,
        threadId: input.threadId,
      });
    }

    const fromCheckpointRef =
      input.fromTurnCount === 0
        ? (() => {
            // The root scope is shared by every run in this thread. Its
            // runId tracks the latest owner, while ordinal zero stays the baseline.
            const firstScope = projection.checkpointScopes.find(
              (scope) => scope.kind === "root_run",
            );
            return firstScope === undefined
              ? undefined
              : checkpointRefForScopeOrdinal({
                  scopeId: firstScope.id,
                  ordinalWithinScope: 0,
                });
          })()
        : readyCheckpoints.find((checkpoint) => checkpoint.appRunOrdinal === input.fromTurnCount)
            ?.ref;
    if (fromCheckpointRef === undefined) {
      return yield* new CheckpointRefUnavailableError({
        operation,
        threadId: input.threadId,
        turnCount: input.fromTurnCount,
        checkpoint: "from",
      });
    }

    return yield* checkpointStore
      .diffCheckpoints({
        cwd: toScope.cwd,
        fromCheckpointRef,
        toCheckpointRef: toCheckpoint.ref,
        fallbackFromToHead: false,
        ignoreWhitespace,
      })
      .pipe(Effect.withSpan("checkpoint.turnDiff.diffCheckpoints"));
  });

  const getFullThreadDiff: CheckpointDiffQuery["Service"]["getFullThreadDiff"] = Effect.fn(
    "CheckpointDiffQuery.getFullThreadDiff",
  )(function* (input) {
    const operation = "CheckpointDiffQuery.getFullThreadDiff";
    const ignoreWhitespace = input.ignoreWhitespace ?? true;
    yield* Effect.annotateCurrentSpan({
      "checkpoint.thread_id": input.threadId,
      "checkpoint.from_turn_count": 0,
      "checkpoint.to_turn_count": input.toTurnCount,
      "checkpoint.ignore_whitespace": ignoreWhitespace,
      "checkpoint.diff_kind": "full-thread",
    });

    if (input.toTurnCount === 0) {
      const emptyDiff = buildTurnDiffResult(
        {
          threadId: input.threadId,
          fromTurnCount: 0,
          toTurnCount: 0,
        },
        "",
      );
      if (!isTurnDiffResult(emptyDiff)) {
        return yield* new CheckpointDiffResultInvalidError({
          operation,
          threadId: input.threadId,
        });
      }
      return emptyDiff satisfies OrchestrationGetFullThreadDiffResult;
    }

    const turnDiff = yield* getTurnDiff({
      threadId: input.threadId,
      fromTurnCount: 0,
      toTurnCount: input.toTurnCount,
      ignoreWhitespace,
    });
    if (!isTurnDiffResult(turnDiff)) {
      return yield* new CheckpointDiffResultInvalidError({
        operation,
        threadId: input.threadId,
      });
    }

    return turnDiff satisfies OrchestrationGetFullThreadDiffResult;
  });

  return CheckpointDiffQuery.of({
    getTurnDiff,
    getFullThreadDiff,
  });
});

export const layer = Layer.effect(CheckpointDiffQuery, make);
