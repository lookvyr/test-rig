import {
  MessageId,
  ThreadId,
  OrchestratorMcpFailure,
  ProjectId,
  type ProjectScript,
} from "@t3tools/contracts";
import { resolveProjectScripts } from "@t3tools/shared/projectScripts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as ThreadMessageIntake from "../../../orchestration-v2/ThreadMessageIntake.ts";
import * as Claims from "../../../orchestration-v2/AttachmentClaims.ts";
import * as Project from "../../../project/ProjectService.ts";
import * as ManagedProjectFolders from "../../../project/ManagedProjectFolders.ts";
import * as Repositories from "../../../sourceControl/SourceControlRepositoryService.ts";
import * as Settings from "../../../serverSettings.ts";
import * as OrchestrationMcp from "../../OrchestratorMcpService.ts";
import {
  assertUnattendedCaller,
  newCommandId,
  readCaller,
  readMutationCaller,
  unavailable,
} from "../../threadAccess.ts";
import { ProjectToolkit } from "./tools.ts";
import { assertPendingUploadOwnership } from "../attachment/handlers.ts";

function projectFailure(error: Project.ProjectServiceError) {
  if (error._tag === "ProjectOperationError") return unavailable();
  const message =
    error._tag === "ProjectNotFoundError"
      ? "The project was not found."
      : error._tag === "ProjectConflictError"
        ? "The workspace is already registered to a project."
        : "The project is not empty; force=true is required to delete it.";
  return new OrchestratorMcpFailure({ code: "invalid_request", message });
}

const access = Effect.gen(function* () {
  yield* readCaller();
  return yield* Project.ProjectService;
});
const mutation = Effect.gen(function* () {
  const { caller } = yield* readMutationCaller();
  yield* assertUnattendedCaller(caller, "Project changes");
  return yield* Project.ProjectService;
});
/** Saves an agent's action list as the project's settings override, where the app reads it. */
const saveProjectScripts = (projectId: ProjectId, scripts: ReadonlyArray<ProjectScript>) =>
  Effect.gen(function* () {
    const settings = yield* Settings.ServerSettingsService;
    yield* settings
      .updateSettings({ projectScriptOverrides: { [projectId]: scripts } })
      .pipe(Effect.mapError(unavailable));
  });

/** Reports the actions the app actually uses for the project. */
const withResolvedScripts = <
  P extends { readonly id: ProjectId; readonly scripts: ReadonlyArray<ProjectScript> },
>(
  project: P,
) =>
  Effect.gen(function* () {
    const settings = yield* Settings.ServerSettingsService;
    const current = yield* settings.getSettings.pipe(Effect.orElseSucceed(() => null));
    return current === null
      ? project
      : { ...project, scripts: resolveProjectScripts(current, project) };
  });

export const ProjectHandlersLive = ProjectToolkit.toLayer({
  t3_thread_launch: (input) =>
    Effect.gen(function* () {
      const { caller, scope } = yield* readMutationCaller();
      yield* assertUnattendedCaller(caller, "Project launches");
      const runtimeMode = yield* OrchestrationMcp.resolveSpawnRuntimeMode(
        caller.runtimeMode,
        input.runtimeMode,
      );
      const interactionMode = yield* OrchestrationMcp.resolveInteractionMode(
        caller.interactionMode,
        input.interactionMode,
      );
      const commandId = yield* newCommandId();
      const threadId = ThreadId.make(commandId);
      const messageId = MessageId.make(commandId);
      const attachments = input.attachments ?? [];
      if (attachments.some((attachment) => !Claims.attachmentIsPendingUpload(attachment)))
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: "A new thread accepts only pending attachment uploads.",
        });
      yield* assertPendingUploadOwnership(attachments, scope.threadId);
      if (
        input.scratch === true &&
        (input.projectId !== undefined || input.workspaceStrategy !== undefined)
      )
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message:
            "scratch:true picks its own project and folder; omit projectId and workspaceStrategy.",
        });
      const projectId =
        input.scratch === true
          ? (yield* ManagedProjectFolders.ManagedProjectFolders.pipe(
              Effect.flatMap((folders) => folders.ensureScratchProject),
              Effect.mapError(
                (error) =>
                  new OrchestratorMcpFailure({
                    code: "orchestration_error",
                    message: error.message,
                  }),
              ),
            )).projectId
          : (input.projectId ?? caller.projectId);
      const result = yield* ThreadMessageIntake.launchThread({
        commandId,
        threadId,
        projectId,
        title: input.title,
        modelSelection: input.modelSelection ?? caller.modelSelection,
        runtimeMode,
        interactionMode,
        workspaceStrategy: input.workspaceStrategy ?? { type: "root" },
        ...(input.message === undefined && attachments.length === 0
          ? {}
          : {
              initialMessage: {
                messageId,
                senderThreadId: scope.threadId,
                text: input.message ?? "",
                attachments,
              },
            }),
        createdBy: "agent",
        creationSource: "mcp",
      }).pipe(
        Effect.mapError((error) =>
          error._tag === "AttachmentClaimError"
            ? new OrchestratorMcpFailure({ code: "orchestration_error", message: error.message })
            : unavailable(),
        ),
      );
      const thread = result.projection.thread;
      const run = result.projection.runs.find((run) => run.userMessageId === messageId);
      return {
        threadId: thread.id,
        projectId: thread.projectId,
        modelSelection: thread.modelSelection,
        runId: run?.id ?? null,
        status: run?.status ?? null,
      };
    }),
  t3_project_list: (input) =>
    Effect.gen(function* () {
      const projects = yield* access;
      const snapshot = yield* projects.snapshot.pipe(Effect.mapError(unavailable));
      const rows = snapshot.projects.filter((project) => project.deletedAt === null);
      const start = input.cursor ?? 0,
        end = start + (input.limit ?? 20);
      return { projects: rows.slice(start, end), nextCursor: end < rows.length ? end : null };
    }),
  t3_project_read: (input) =>
    Effect.gen(function* () {
      const projects = yield* access;
      const result = yield* projects.getById(input.projectId).pipe(Effect.mapError(unavailable));
      if (Option.isNone(result))
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: "The project was not found.",
        });
      return yield* withResolvedScripts(result.value);
    }),
  t3_project_create: ({ workspaceRoot, ...input }) =>
    Effect.gen(function* () {
      const projects = yield* mutation;
      if (workspaceRoot === undefined) {
        // Project creation records no model default (only an update does), so
        // reject what this mode would otherwise drop silently.
        if (
          input.scripts !== undefined ||
          input.createWorkspaceRootIfMissing !== undefined ||
          input.defaultModelSelection !== undefined
        )
          return yield* new OrchestratorMcpFailure({
            code: "invalid_request",
            message:
              "A project started from its title takes only a title; set scripts or defaultModelSelection afterwards with t3_project_update.",
          });
        const folders = yield* ManagedProjectFolders.ManagedProjectFolders;
        const created = yield* folders
          .createNamedProject({ name: input.title })
          .pipe(
            Effect.mapError(
              (error) =>
                new OrchestratorMcpFailure({ code: "orchestration_error", message: error.message }),
            ),
          );
        const project = yield* projects
          .getById(created.projectId)
          .pipe(
            Effect.mapError(unavailable),
            Effect.flatMap(
              Option.match({ onNone: () => Effect.fail(unavailable()), onSome: Effect.succeed }),
            ),
          );
        return {
          ...project,
          ...(created.commitError === undefined ? {} : { commitError: created.commitError }),
        };
      }
      const commandId = yield* newCommandId();
      const { scripts, ...createInput } = input;
      const created = yield* projects
        .create({
          ...createInput,
          workspaceRoot,
          commandId,
          projectId: ProjectId.make(commandId),
        })
        .pipe(Effect.mapError(projectFailure));
      if (scripts !== undefined) yield* saveProjectScripts(created.id, scripts);
      return yield* withResolvedScripts(created);
    }),
  t3_project_update: ({ scripts, ...input }) =>
    Effect.gen(function* () {
      const projects = yield* mutation;
      // Actions live in settings now; the project's own list is no longer read.
      if (scripts !== undefined) yield* saveProjectScripts(input.projectId, scripts);
      const updated = yield* projects
        .update({ ...input, commandId: yield* newCommandId() })
        .pipe(Effect.mapError(projectFailure));
      return yield* withResolvedScripts(updated);
    }),
  t3_project_delete: (input) =>
    Effect.gen(function* () {
      const projects = yield* mutation;
      return yield* projects
        .delete({ ...input, commandId: yield* newCommandId() })
        .pipe(Effect.mapError(projectFailure));
    }),
  t3_project_clone: (input) =>
    Effect.gen(function* () {
      yield* mutation;
      const repositories = yield* Repositories.SourceControlRepositoryService;
      return yield* repositories.cloneRepository(input).pipe(
        Effect.mapError(
          (error) =>
            new OrchestratorMcpFailure({
              code: "orchestration_error",
              message: error.detail,
            }),
        ),
      );
    }),
});
