import * as FileSystem from "effect/FileSystem";
import * as ServerConfig from "../config.ts";
import {
  type EnvironmentAuthorizationError,
  ORCHESTRATION_V2_WS_METHODS,
  OrchestrationV2RpcGroup,
  OrchestrationV2DispatchCommandError,
  OrchestrationV2GetThreadProjectionError,
  OrchestrationV2ThreadLaunchError,
  OrchestrationGetTurnDiffError,
  OrchestrationGetFullThreadDiffError,
  OrchestrationSearchThreadsError,
  ProjectMutationError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProjectEnrichmentService from "../project/ProjectEnrichmentService.ts";
import * as CheckpointDiffQuery from "../checkpointing/CheckpointDiffQuery.ts";
import * as ServerRuntimeStartup from "../serverRuntimeStartup.ts";
import { readWorkflowScript } from "../orchestration/workflowScriptQuery.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";
import * as ThreadLaunch from "./ThreadLaunchService.ts";
import * as ThreadMessageIntake from "./ThreadMessageIntake.ts";
import * as ThreadSearch from "./ThreadSearch.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ApplicationEvents from "./Services/OrchestrationEventStore.ts";
import {
  makeArchivedShellStreams,
  subscribeOrchestrationV2Shell,
  subscribeOrchestrationV2Thread,
} from "./Streams.ts";
import {
  buildBoundedThreadProjection,
  THREAD_HISTORY_SNAPSHOT_ROW_LIMIT,
} from "./threadHistoryPaging.ts";
import { projectThreadProjectionForWire } from "./WireProjection.ts";
import { userFacingDispatchErrorMessage } from "./UserFacingErrors.ts";

interface RpcObservation {
  readonly effect: <A, E, R>(
    method: string,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | EnvironmentAuthorizationError, R>;
  readonly streamEffect: <A, E, R, E2, R2>(
    method: string,
    effect: Effect.Effect<Stream.Stream<A, E, R>, E2, R2>,
  ) => Stream.Stream<A, E | E2 | EnvironmentAuthorizationError, R | R2>;
}

/** The same authorized handlers serve the web and desktop clients. */
export const makeHandlers = Effect.fn("orchestrationV2.makeRpcHandlers")(function* (
  observe: RpcObservation,
) {
  const context = yield* Effect.context<
    | FileSystem.FileSystem
    | ServerConfig.ServerConfig
    | ThreadManagement.ThreadManagementService
    | ThreadLaunch.ThreadLaunchService
    | SqlClient.SqlClient
    | ProjectService.ProjectService
    | ProjectEnrichmentService.ProjectEnrichmentService
    | ProjectStore.ProjectStoreV2
    | ApplicationEvents.OrchestrationEventStore
  >();
  const threads = yield* ThreadManagement.ThreadManagementService;
  const projects = yield* ProjectService.ProjectService;
  const search = yield* ThreadSearch.ThreadSearch;
  const diffs = yield* CheckpointDiffQuery.CheckpointDiffQuery;
  const startup = yield* ServerRuntimeStartup.ServerRuntimeStartup;
  const archive = yield* makeArchivedShellStreams;
  return OrchestrationV2RpcGroup.of({
    [ORCHESTRATION_V2_WS_METHODS.dispatchCommand]: (command) =>
      observe.effect(
        ORCHESTRATION_V2_WS_METHODS.dispatchCommand,
        startup
          .enqueueCommand(
            ThreadMessageIntake.dispatchCommand(
              ThreadManagement.withCreationProvenance(command, {
                createdBy: "user",
                creationSource: "creationSource" in command ? command.creationSource : "web",
              }),
            ).pipe(Effect.provide(context)),
          )
          .pipe(
            Effect.map((result) => ({ sequence: result.sequence })),
            Effect.mapError((cause) => {
              const detail = userFacingDispatchErrorMessage(cause);
              return new OrchestrationV2DispatchCommandError({
                commandId: command.commandId,
                commandType: command.type,
                message: detail ?? "Failed to dispatch conversation command",
                ...(detail === undefined ? {} : { detail }),
                cause,
              });
            }),
          ),
      ),
    [ORCHESTRATION_V2_WS_METHODS.getWorkflowScript]: (input) =>
      observe.effect(ORCHESTRATION_V2_WS_METHODS.getWorkflowScript, readWorkflowScript(input)),
    [ORCHESTRATION_V2_WS_METHODS.getTurnDiff]: (input) =>
      observe.effect(
        ORCHESTRATION_V2_WS_METHODS.getTurnDiff,
        diffs
          .getTurnDiff(input)
          .pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationGetTurnDiffError({ message: "Failed to load turn diff", cause }),
            ),
          ),
      ),
    [ORCHESTRATION_V2_WS_METHODS.getFullThreadDiff]: (input) =>
      observe.effect(
        ORCHESTRATION_V2_WS_METHODS.getFullThreadDiff,
        diffs.getFullThreadDiff(input).pipe(
          Effect.mapError(
            (cause) =>
              new OrchestrationGetFullThreadDiffError({
                message: "Failed to load full thread diff",
                cause,
              }),
          ),
        ),
      ),
    [ORCHESTRATION_V2_WS_METHODS.searchThreads]: (input) =>
      observe.effect(
        ORCHESTRATION_V2_WS_METHODS.searchThreads,
        search
          .search(input)
          .pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationSearchThreadsError({ message: "Failed to search threads", cause }),
            ),
          ),
      ),
    [ORCHESTRATION_V2_WS_METHODS.getArchivedShellSnapshot]: () =>
      observe.effect(ORCHESTRATION_V2_WS_METHODS.getArchivedShellSnapshot, archive.snapshot),
    [ORCHESTRATION_V2_WS_METHODS.getThreadProjection]: (input) =>
      observe.effect(
        ORCHESTRATION_V2_WS_METHODS.getThreadProjection,
        threads
          .getThreadSnapshotWindow(input.threadId, { rowLimit: THREAD_HISTORY_SNAPSHOT_ROW_LIMIT })
          .pipe(
            Effect.map((snapshot) =>
              projectThreadProjectionForWire(buildBoundedThreadProjection(snapshot).projection),
            ),
            Effect.mapError(
              (cause) =>
                new OrchestrationV2GetThreadProjectionError({
                  threadId: input.threadId,
                  message: "Failed to load conversation",
                  cause,
                }),
            ),
          ),
      ),
    [ORCHESTRATION_V2_WS_METHODS.launchThread]: (input) =>
      observe.effect(
        ORCHESTRATION_V2_WS_METHODS.launchThread,
        startup
          .enqueueCommand(
            ThreadMessageIntake.launchThread({
              ...input,
              createdBy: "user",
              creationSource: input.creationSource ?? "web",
            }).pipe(Effect.provide(context)),
          )
          .pipe(
            Effect.map((result) => ({
              ...result,
              projection: projectThreadProjectionForWire(result.projection),
            })),
            Effect.mapError(
              (cause) =>
                new OrchestrationV2ThreadLaunchError({
                  commandId: input.commandId,
                  projectId: input.projectId,
                  message: "Failed to launch conversation",
                  cause,
                }),
            ),
          ),
      ),
    [ORCHESTRATION_V2_WS_METHODS.subscribeArchivedShell]: () =>
      observe.streamEffect(ORCHESTRATION_V2_WS_METHODS.subscribeArchivedShell, archive.subscribe()),
    [ORCHESTRATION_V2_WS_METHODS.subscribeShell]: (input) =>
      observe.streamEffect(
        ORCHESTRATION_V2_WS_METHODS.subscribeShell,
        subscribeOrchestrationV2Shell(input).pipe(Effect.provide(context)),
      ),
    [ORCHESTRATION_V2_WS_METHODS.subscribeThread]: (input) =>
      observe.streamEffect(
        ORCHESTRATION_V2_WS_METHODS.subscribeThread,
        subscribeOrchestrationV2Thread(input).pipe(Effect.provide(context)),
      ),
    "projects.mutate": (input) =>
      observe.effect(
        "projects.mutate",
        startup
          .enqueueCommand(
            input.type === "project.create"
              ? projects.create(input)
              : input.type === "project.update"
                ? projects.update(input)
                : projects.delete(input),
          )
          .pipe(
            Effect.mapError(
              (cause) =>
                new ProjectMutationError({
                  commandId: input.commandId,
                  message: cause.message,
                  cause,
                }),
            ),
          ),
      ),
  });
});
