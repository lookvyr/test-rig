import {
  CheckpointId,
  CheckpointRef,
  CheckpointScopeId,
  NodeId,
  OrchestrationV2Checkpoint,
  OrchestrationV2CheckpointScope,
  type ProjectId,
  ProviderThreadId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as NodeCrypto from "node:crypto";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import { parseTurnDiffFilesFromNumstat } from "../checkpointing/Diffs.ts";
import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import * as IdAllocator from "./IdAllocator.ts";
import * as WorkspaceFolders from "../workspace/WorkspaceFolders.ts";

const CHECKPOINT_REFS_PREFIX = "refs/t3/orchestration-v2/checkpoints";
const ROOT_CHECKPOINT_SCOPE_NAME = "root";

export class CheckpointRootScopePrepareError extends Schema.TaggedError<CheckpointRootScopePrepareError>()(
  "CheckpointRootScopePrepareError",
  {
    threadId: ThreadId,
    runId: RunId,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to prepare root checkpoint scope for run ${this.runId}.`;
  }
}

export class CheckpointScopeEnsureError extends Schema.TaggedError<CheckpointScopeEnsureError>()(
  "CheckpointScopeEnsureError",
  {
    scopeId: CheckpointScopeId,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to ensure checkpoint scope ${this.scopeId}.`;
  }
}

export class CheckpointBaselineCaptureError extends Schema.TaggedError<CheckpointBaselineCaptureError>()(
  "CheckpointBaselineCaptureError",
  {
    scopeId: CheckpointScopeId,
    ordinalWithinScope: Schema.Number,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to capture checkpoint baseline ${this.ordinalWithinScope} for scope ${this.scopeId}.`;
  }
}

export class CheckpointCaptureError extends Schema.TaggedError<CheckpointCaptureError>()(
  "CheckpointCaptureError",
  {
    scopeId: CheckpointScopeId,
    parentCheckpointId: Schema.optional(CheckpointId),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to capture checkpoint for scope ${this.scopeId}.`;
  }
}

export const CheckpointServiceV2Error = Schema.Union([
  CheckpointRootScopePrepareError,
  CheckpointScopeEnsureError,
  CheckpointBaselineCaptureError,
  CheckpointCaptureError,
]);
export type CheckpointServiceV2Error = typeof CheckpointServiceV2Error.Type;

export interface CheckpointServiceV2Shape {
  readonly prepareRootRunScope: (input: {
    readonly threadId: ThreadId;
    readonly runId: RunId;
    readonly rootNodeId: NodeId;
    readonly providerThreadId: ProviderThreadId;
    readonly cwd: string;
    readonly createdAt: DateTime.Utc;
  }) => Effect.Effect<OrchestrationV2CheckpointScope, CheckpointServiceV2Error>;
  readonly ensureScope: (
    scope: OrchestrationV2CheckpointScope,
  ) => Effect.Effect<OrchestrationV2CheckpointScope, CheckpointServiceV2Error>;
  readonly captureBaseline: (input: {
    readonly scope: OrchestrationV2CheckpointScope;
    readonly ordinalWithinScope: number;
    /** Nested repositories with scopes of their own, relative to the scope's folder. */
    readonly excludePaths?: ReadonlyArray<string>;
  }) => Effect.Effect<void, CheckpointServiceV2Error>;
  readonly materializeBaselineCheckpoint: (input: {
    readonly scope: OrchestrationV2CheckpointScope;
    readonly ordinalWithinScope: number;
    /** The run materializing the baseline: its root node, and when it was requested. */
    readonly nodeId: NodeId;
    readonly capturedAt: DateTime.Utc;
  }) => Effect.Effect<OrchestrationV2Checkpoint, CheckpointServiceV2Error>;
  readonly capture: (input: {
    readonly scope: OrchestrationV2CheckpointScope;
    readonly runId: RunId | null;
    readonly nodeId: NodeId;
    readonly ordinalWithinScope: number;
    readonly appRunOrdinal: number | null;
    readonly capturedAt: DateTime.Utc;
    /** Nested repositories with scopes of their own, relative to the scope's folder. */
    readonly excludePaths?: ReadonlyArray<string>;
  }) => Effect.Effect<OrchestrationV2Checkpoint, CheckpointServiceV2Error>;
  /**
   * One scope per Git repository the thread reaches besides its own folder, under its root scope:
   * the project's other repositories and the submodules checked out in any of them. Ids depend
   * only on the thread and the repository, so every run names the same scope. Empty for a
   * single-repository thread, or when the folders cannot be read.
   */
  readonly repositoryScopes: (input: {
    readonly rootScope: OrchestrationV2CheckpointScope;
    readonly projectId: ProjectId;
    readonly worktreePath: string | null;
  }) => Effect.Effect<RepositoryScopes>;
  /**
   * Notes a repository's state before a run. A clean checkout costs one status and is only
   * remembered; one with uncommitted work is snapshotted, since the run may change it.
   */
  readonly captureRepositoryBaseline: (input: {
    readonly scope: OrchestrationV2CheckpointScope;
    readonly ordinalWithinScope: number;
  }) => Effect.Effect<void>;
  /**
   * A repository's checkpoint for a run, with the baseline before it when that is not recorded
   * yet. None when the run left the repository as it found it, which costs one status and writes
   * nothing, or when its state before the run is unknown.
   */
  readonly captureRepository: (input: {
    readonly scope: OrchestrationV2CheckpointScope;
    readonly runId: RunId;
    readonly nodeId: NodeId;
    readonly ordinalWithinScope: number;
    readonly capturedAt: DateTime.Utc;
    readonly baselineCapturedAt: DateTime.Utc;
    readonly baselineRecorded: boolean;
  }) => Effect.Effect<
    Option.Option<{
      readonly baseline: OrchestrationV2Checkpoint | null;
      readonly checkpoint: OrchestrationV2Checkpoint;
    }>
  >;
}

export interface RepositoryScopes {
  readonly scopes: ReadonlyArray<OrchestrationV2CheckpointScope>;
  /**
   * The repositories inside the root scope's folder that are not its submodules, relative to it:
   * the root capture leaves them to their own scopes. A submodule stays, since its pinned commit
   * belongs to the parent's changes.
   */
  readonly rootExcludePaths: ReadonlyArray<string>;
}

const EMPTY_REPOSITORY_SCOPES: RepositoryScopes = { scopes: [], rootExcludePaths: [] };

/** The repository methods of a thread that reaches no other repositories, for test doubles. */
export const singleFolderRepositories = {
  repositoryScopes: () => Effect.succeed(EMPTY_REPOSITORY_SCOPES),
  captureRepositoryBaseline: () => Effect.void,
  captureRepository: () => Effect.succeed(Option.none()),
} satisfies Pick<
  CheckpointServiceV2Shape,
  "repositoryScopes" | "captureRepositoryBaseline" | "captureRepository"
>;
// Git processes are already capped server-wide; this keeps one thread from taking every slot.
export const REPOSITORY_CAPTURE_CONCURRENCY = 4;

export class CheckpointServiceV2 extends Context.Service<
  CheckpointServiceV2,
  CheckpointServiceV2Shape
>()("t3/orchestration-v2/CheckpointService/CheckpointServiceV2") {}

export function checkpointRefForScopeOrdinal(input: {
  readonly scopeId: CheckpointScopeId;
  readonly ordinalWithinScope: number;
}): CheckpointRef {
  const scopeKey = NodeCrypto.createHash("sha256").update(input.scopeId).digest("hex").slice(0, 32);
  return CheckpointRef.make(
    `${CHECKPOINT_REFS_PREFIX}/${Encoding.encodeBase64Url(scopeKey)}/ordinal/${input.ordinalWithinScope}`,
  );
}

function checkpointIdForScopeOrdinal(
  idAllocator: IdAllocator.IdAllocatorV2Shape,
  input: {
    readonly scopeId: CheckpointScopeId;
    readonly ordinalWithinScope: number;
  },
) {
  return idAllocator.allocate.checkpoint({
    checkpointScopeId: input.scopeId,
    name: String(input.ordinalWithinScope),
  });
}

function makeRootRunScope(input: {
  readonly idAllocator: IdAllocator.IdAllocatorV2Shape;
  readonly threadId: ThreadId;
  readonly runId: RunId;
  readonly rootNodeId: NodeId;
  readonly providerThreadId: ProviderThreadId;
  readonly cwd: string;
  readonly createdAt: DateTime.Utc;
}) {
  return Effect.gen(function* () {
    const scopeId = yield* input.idAllocator.allocate.checkpointScope({
      threadId: input.threadId,
      name: ROOT_CHECKPOINT_SCOPE_NAME,
    });
    return {
      id: scopeId,
      threadId: input.threadId,
      runId: input.runId,
      nodeId: input.rootNodeId,
      parentScopeId: null,
      providerThreadId: input.providerThreadId,
      kind: "root_run",
      ordinalWithinParent: 0,
      advancesAppRunCount: true,
      cwd: input.cwd,
      createdAt: input.createdAt,
    } satisfies OrchestrationV2CheckpointScope;
  });
}

function makeCheckpoint(input: {
  readonly id: CheckpointId;
  readonly scope: OrchestrationV2CheckpointScope;
  readonly runId: RunId | null;
  readonly nodeId: NodeId;
  readonly parentCheckpointId: CheckpointId | null;
  readonly ordinalWithinScope: number;
  readonly appRunOrdinal: number | null;
  readonly ref: CheckpointRef;
  readonly status: OrchestrationV2Checkpoint["status"];
  readonly files: OrchestrationV2Checkpoint["files"];
  readonly capturedAt: DateTime.Utc;
}): OrchestrationV2Checkpoint {
  return {
    id: input.id,
    threadId: input.scope.threadId,
    scopeId: input.scope.id,
    runId: input.runId,
    nodeId: input.nodeId,
    parentCheckpointId: input.parentCheckpointId,
    ordinalWithinScope: input.ordinalWithinScope,
    appRunOrdinal: input.appRunOrdinal,
    ref: input.ref,
    status: input.status,
    files: input.files,
    capturedAt: input.capturedAt,
  };
}

export const layer: Layer.Layer<
  CheckpointServiceV2,
  never,
  | CheckpointStore.CheckpointStore
  | IdAllocator.IdAllocatorV2
  | WorkspaceFolders.WorkspaceFolders
  | Path.Path
> = Layer.effect(
  CheckpointServiceV2,
  Effect.gen(function* () {
    const checkpointStore = yield* CheckpointStore.CheckpointStore;
    const idAllocator = yield* IdAllocator.IdAllocatorV2;
    const workspaceFolders = yield* WorkspaceFolders.WorkspaceFolders;
    const path = yield* Path.Path;
    // A clean repository's HEAD before a run, by scope. Only this process knows it: after a
    // restart, a run that began clean shows no changes for that repository.
    const cleanBaselines = new Map<CheckpointScopeId, { ordinal: number; head: string }>();
    const workspaceSemaphores = yield* Ref.make(new Map<string, Semaphore.Semaphore>());

    const getWorkspaceSemaphore = (cwd: string) =>
      Effect.gen(function* () {
        const existing = (yield* Ref.get(workspaceSemaphores)).get(cwd);
        if (existing !== undefined) {
          return existing;
        }

        const created = yield* Semaphore.make(1);
        return yield* Ref.modify(workspaceSemaphores, (current) => {
          const concurrent = current.get(cwd);
          if (concurrent !== undefined) {
            return [concurrent, current];
          }
          const updated = new Map(current);
          updated.set(cwd, created);
          return [created, updated];
        });
      });

    const withWorkspaceLock = <A, E, R>(cwd: string, effect: Effect.Effect<A, E, R>) =>
      Effect.flatMap(getWorkspaceSemaphore(cwd), (semaphore) => semaphore.withPermits(1)(effect));

    const isGitCheckpointable = (cwd: string) =>
      checkpointStore.isGitRepository(cwd).pipe(Effect.orElseSucceed(() => false));

    const ensureScope: CheckpointServiceV2Shape["ensureScope"] = (scope) => Effect.succeed(scope);

    const captureBaseline: CheckpointServiceV2Shape["captureBaseline"] = (input) =>
      withWorkspaceLock(
        input.scope.cwd,
        Effect.gen(function* () {
          if (!(yield* isGitCheckpointable(input.scope.cwd))) {
            return;
          }

          const checkpointRef = checkpointRefForScopeOrdinal({
            scopeId: input.scope.id,
            ordinalWithinScope: input.ordinalWithinScope,
          });
          const exists = yield* checkpointStore.hasCheckpointRef({
            cwd: input.scope.cwd,
            checkpointRef,
          });
          if (exists) {
            return;
          }

          yield* checkpointStore.captureCheckpoint({
            cwd: input.scope.cwd,
            checkpointRef,
            ...(input.excludePaths === undefined || input.excludePaths.length === 0
              ? {}
              : { excludePaths: input.excludePaths }),
          });
        }),
      ).pipe(
        Effect.mapError(
          (cause) =>
            new CheckpointBaselineCaptureError({
              scopeId: input.scope.id,
              ordinalWithinScope: input.ordinalWithinScope,
              cause,
            }),
        ),
      );

    const materializeBaselineCheckpoint: CheckpointServiceV2Shape["materializeBaselineCheckpoint"] =
      (input) =>
        withWorkspaceLock(
          input.scope.cwd,
          Effect.gen(function* () {
            const checkpointRef = checkpointRefForScopeOrdinal({
              scopeId: input.scope.id,
              ordinalWithinScope: input.ordinalWithinScope,
            });
            const checkpointId = yield* checkpointIdForScopeOrdinal(idAllocator, {
              scopeId: input.scope.id,
              ordinalWithinScope: input.ordinalWithinScope,
            });
            const checkpointable = yield* isGitCheckpointable(input.scope.cwd);
            const available = checkpointable
              ? yield* checkpointStore
                  .hasCheckpointRef({
                    cwd: input.scope.cwd,
                    checkpointRef,
                  })
                  .pipe(
                    Effect.catch((cause) =>
                      Effect.logWarning("orchestration V2 baseline ref lookup failed", {
                        scopeId: input.scope.id,
                        checkpointRef,
                        cause: String(cause),
                      }).pipe(Effect.as(false)),
                    ),
                  )
              : false;
            return makeCheckpoint({
              id: checkpointId,
              scope: input.scope,
              runId: null,
              nodeId: input.nodeId,
              parentCheckpointId: null,
              ordinalWithinScope: input.ordinalWithinScope,
              appRunOrdinal: null,
              ref: checkpointRef,
              status: available ? "ready" : "missing",
              files: [],
              capturedAt: input.capturedAt,
            });
          }),
        ).pipe(
          Effect.mapError(
            (cause) =>
              new CheckpointCaptureError({
                scopeId: input.scope.id,
                cause,
              }),
          ),
        );

    const capture: CheckpointServiceV2Shape["capture"] = (input) =>
      withWorkspaceLock(
        input.scope.cwd,
        Effect.gen(function* () {
          const checkpointId = yield* checkpointIdForScopeOrdinal(idAllocator, {
            scopeId: input.scope.id,
            ordinalWithinScope: input.ordinalWithinScope,
          });
          const parentCheckpointId =
            input.ordinalWithinScope > 0
              ? yield* checkpointIdForScopeOrdinal(idAllocator, {
                  scopeId: input.scope.id,
                  ordinalWithinScope: input.ordinalWithinScope - 1,
                })
              : null;
          const checkpointRef = checkpointRefForScopeOrdinal({
            scopeId: input.scope.id,
            ordinalWithinScope: input.ordinalWithinScope,
          });
          const previousCheckpointRef = checkpointRefForScopeOrdinal({
            scopeId: input.scope.id,
            ordinalWithinScope: Math.max(0, input.ordinalWithinScope - 1),
          });

          if (!(yield* isGitCheckpointable(input.scope.cwd))) {
            return makeCheckpoint({
              id: checkpointId,
              scope: input.scope,
              runId: input.runId,
              nodeId: input.nodeId,
              parentCheckpointId,
              ordinalWithinScope: input.ordinalWithinScope,
              appRunOrdinal: input.appRunOrdinal,
              ref: checkpointRef,
              status: "missing",
              files: [],
              capturedAt: input.capturedAt,
            });
          }

          const captured = yield* checkpointStore
            .captureCheckpoint({
              cwd: input.scope.cwd,
              checkpointRef,
              ...(input.excludePaths === undefined || input.excludePaths.length === 0
                ? {}
                : { excludePaths: input.excludePaths }),
            })
            .pipe(
              Effect.as(true),
              Effect.catch((cause) =>
                Effect.logWarning("orchestration V2 checkpoint capture failed", {
                  scopeId: input.scope.id,
                  checkpointRef,
                  cause: String(cause),
                }).pipe(Effect.as(false)),
              ),
            );

          if (!captured) {
            return makeCheckpoint({
              id: checkpointId,
              scope: input.scope,
              runId: input.runId,
              nodeId: input.nodeId,
              parentCheckpointId,
              ordinalWithinScope: input.ordinalWithinScope,
              appRunOrdinal: input.appRunOrdinal,
              ref: checkpointRef,
              status: "error",
              files: [],
              capturedAt: input.capturedAt,
            });
          }

          const previousExists = yield* checkpointStore
            .hasCheckpointRef({
              cwd: input.scope.cwd,
              checkpointRef: previousCheckpointRef,
            })
            .pipe(
              Effect.catch((cause) =>
                Effect.logWarning("orchestration V2 previous checkpoint ref lookup failed", {
                  scopeId: input.scope.id,
                  checkpointRef: previousCheckpointRef,
                  cause: String(cause),
                }).pipe(Effect.as(false)),
              ),
            );
          const files = previousExists
            ? yield* checkpointStore
                .diffCheckpoints({
                  cwd: input.scope.cwd,
                  fromCheckpointRef: previousCheckpointRef,
                  toCheckpointRef: checkpointRef,
                  fallbackFromToHead: false,
                  ignoreWhitespace: false,
                  format: "numstat",
                })
                .pipe(
                  Effect.map((diff) =>
                    parseTurnDiffFilesFromNumstat(diff).map((file) => ({
                      path: file.path,
                      kind: "modified",
                      additions: file.additions,
                      deletions: file.deletions,
                    })),
                  ),
                  Effect.catch((cause) =>
                    Effect.logWarning("orchestration V2 checkpoint diff summary failed", {
                      scopeId: input.scope.id,
                      checkpointRef,
                      cause: String(cause),
                    }).pipe(Effect.as([])),
                  ),
                )
            : [];

          return makeCheckpoint({
            id: checkpointId,
            scope: input.scope,
            runId: input.runId,
            nodeId: input.nodeId,
            parentCheckpointId,
            ordinalWithinScope: input.ordinalWithinScope,
            appRunOrdinal: input.appRunOrdinal,
            ref: checkpointRef,
            status: "ready",
            files,
            capturedAt: input.capturedAt,
          });
        }),
      ).pipe(
        Effect.mapError(
          (cause) =>
            new CheckpointCaptureError({
              scopeId: input.scope.id,
              cause,
            }),
        ),
      );

    const repositoryScopes: CheckpointServiceV2Shape["repositoryScopes"] = Effect.fn(
      "CheckpointServiceV2.repositoryScopes",
    )(
      function* (input) {
        const workspace = yield* workspaceFolders.forThread({
          projectId: input.projectId,
          worktreePath: input.worktreePath,
        });
        const repositories = workspace.folders.filter((folder) => folder.isGitRepository);
        const submodules = yield* workspaceFolders.submodules({
          cwd: input.rootScope.cwd,
          folders: repositories,
        });
        const toRelative = (folderPath: string) =>
          path.relative(input.rootScope.cwd, folderPath).split(path.sep).join("/");
        const scopes = yield* Effect.forEach([...repositories, ...submodules], (folder, index) =>
          Effect.map(
            idAllocator.allocate.checkpointScope({
              threadId: input.rootScope.threadId,
              name: `repository:${folder.repositoryPath ?? folder.path}`,
            }),
            (id): OrchestrationV2CheckpointScope => ({
              id,
              threadId: input.rootScope.threadId,
              runId: input.rootScope.runId,
              nodeId: input.rootScope.nodeId,
              parentScopeId: input.rootScope.id,
              providerThreadId: input.rootScope.providerThreadId,
              kind: "repository",
              ordinalWithinParent: index + 1,
              advancesAppRunCount: false,
              cwd: folder.path,
              label: folder.name,
              repositoryPath: folder.repositoryPath ?? folder.path,
              relativePath: toRelative(folder.path),
              createdAt: input.rootScope.createdAt,
            }),
          ),
        );
        const rootExcludePaths = repositories
          .map((folder) => toRelative(folder.path))
          .filter((relative) => relative !== "" && !relative.startsWith(".."));
        return { scopes, rootExcludePaths };
      },
      Effect.catchCause((cause) =>
        Effect.logWarning("Could not resolve the thread's repositories.", cause).pipe(
          Effect.as(EMPTY_REPOSITORY_SCOPES),
        ),
      ),
    );

    const captureRepositoryBaseline: CheckpointServiceV2Shape["captureRepositoryBaseline"] = (
      input,
    ) =>
      withWorkspaceLock(
        input.scope.cwd,
        Effect.gen(function* () {
          const checkpointRef = checkpointRefForScopeOrdinal({
            scopeId: input.scope.id,
            ordinalWithinScope: input.ordinalWithinScope,
          });
          // The previous run left the repository clean and wrote no ref, so only the status is
          // needed: the common case for a repository turns leave alone.
          const remembered = cleanBaselines.get(input.scope.id);
          if (
            remembered?.ordinal !== input.ordinalWithinScope &&
            (yield* checkpointStore.hasCheckpointRef({ cwd: input.scope.cwd, checkpointRef }))
          ) {
            return;
          }
          const state = yield* checkpointStore.readWorkingState(input.scope.cwd);
          if (state.clean && state.head !== null) {
            cleanBaselines.set(input.scope.id, {
              ordinal: input.ordinalWithinScope,
              head: state.head,
            });
            return;
          }
          cleanBaselines.delete(input.scope.id);
          yield* checkpointStore.captureCheckpoint({ cwd: input.scope.cwd, checkpointRef });
        }),
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("orchestration V2 repository baseline failed", {
            scopeId: input.scope.id,
            cause: String(cause),
          }),
        ),
      );

    const captureRepository: CheckpointServiceV2Shape["captureRepository"] = (input) =>
      withWorkspaceLock(
        input.scope.cwd,
        Effect.gen(function* () {
          const baselineOrdinal = Math.max(0, input.ordinalWithinScope - 1);
          const baselineRef = checkpointRefForScopeOrdinal({
            scopeId: input.scope.id,
            ordinalWithinScope: baselineOrdinal,
          });
          const checkpointRef = checkpointRefForScopeOrdinal({
            scopeId: input.scope.id,
            ordinalWithinScope: input.ordinalWithinScope,
          });
          const state = yield* checkpointStore.readWorkingState(input.scope.cwd);
          const remembered = cleanBaselines.get(input.scope.id);
          const cleanHead =
            remembered !== undefined && remembered.ordinal === baselineOrdinal
              ? remembered.head
              : null;
          // Began clean and still is, at the same commit: nothing to record, one status spent.
          if (cleanHead !== null && state.clean && state.head === cleanHead) {
            cleanBaselines.set(input.scope.id, {
              ordinal: input.ordinalWithinScope,
              head: cleanHead,
            });
            return Option.none();
          }
          const baselineSnapshotted =
            cleanHead === null &&
            (yield* checkpointStore.hasCheckpointRef({
              cwd: input.scope.cwd,
              checkpointRef: baselineRef,
            }));
          // Its state before the run was never seen: there is nothing to compare with.
          if (!baselineSnapshotted && cleanHead === null) return Option.none();
          if (state.clean && state.head !== null) {
            const unchanged = baselineSnapshotted
              ? yield* checkpointStore.checkpointMatchesHead({
                  cwd: input.scope.cwd,
                  checkpointRef: baselineRef,
                })
              : state.head === cleanHead;
            if (unchanged) {
              // The next run starts from here, so remember it as that run's baseline.
              cleanBaselines.set(input.scope.id, {
                ordinal: input.ordinalWithinScope,
                head: state.head,
              });
              return Option.none();
            }
          }
          if (!baselineSnapshotted && cleanHead !== null) {
            yield* checkpointStore.pointCheckpointRef({
              cwd: input.scope.cwd,
              checkpointRef: baselineRef,
              commit: cleanHead,
            });
          }
          yield* checkpointStore.captureCheckpoint({ cwd: input.scope.cwd, checkpointRef });
          const files = yield* checkpointStore
            .diffCheckpoints({
              cwd: input.scope.cwd,
              fromCheckpointRef: baselineRef,
              toCheckpointRef: checkpointRef,
              fallbackFromToHead: false,
              ignoreWhitespace: false,
              format: "numstat",
            })
            .pipe(
              Effect.map((diff) =>
                parseTurnDiffFilesFromNumstat(diff).map((file) => ({
                  path: file.path,
                  kind: "modified",
                  additions: file.additions,
                  deletions: file.deletions,
                })),
              ),
            );
          cleanBaselines.delete(input.scope.id);
          if (files.length === 0) return Option.none();
          const baseline = input.baselineRecorded
            ? null
            : makeCheckpoint({
                id: yield* checkpointIdForScopeOrdinal(idAllocator, {
                  scopeId: input.scope.id,
                  ordinalWithinScope: baselineOrdinal,
                }),
                scope: input.scope,
                runId: null,
                nodeId: input.nodeId,
                parentCheckpointId: null,
                ordinalWithinScope: baselineOrdinal,
                appRunOrdinal: null,
                ref: baselineRef,
                status: "ready",
                files: [],
                capturedAt: input.baselineCapturedAt,
              });
          const checkpoint = makeCheckpoint({
            id: yield* checkpointIdForScopeOrdinal(idAllocator, {
              scopeId: input.scope.id,
              ordinalWithinScope: input.ordinalWithinScope,
            }),
            scope: input.scope,
            runId: input.runId,
            nodeId: input.nodeId,
            parentCheckpointId: null,
            ordinalWithinScope: input.ordinalWithinScope,
            // Repository checkpoints never stand for a turn of the thread on their own.
            appRunOrdinal: null,
            ref: checkpointRef,
            status: "ready",
            files,
            capturedAt: input.capturedAt,
          });
          return Option.some({ baseline, checkpoint });
        }),
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("orchestration V2 repository checkpoint failed", {
            scopeId: input.scope.id,
            cause: String(cause),
          }).pipe(Effect.as(Option.none())),
        ),
      );

    return CheckpointServiceV2.of({
      repositoryScopes,
      captureRepositoryBaseline,
      captureRepository,
      prepareRootRunScope: (input) =>
        makeRootRunScope({ ...input, idAllocator }).pipe(
          Effect.mapError(
            (cause) =>
              new CheckpointRootScopePrepareError({
                threadId: input.threadId,
                runId: input.runId,
                cause,
              }),
          ),
        ),
      ensureScope,
      captureBaseline,
      materializeBaselineCheckpoint,
      capture,
    } satisfies CheckpointServiceV2Shape);
  }),
);
