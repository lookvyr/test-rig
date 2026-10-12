import {
  ToolsScopeError,
  ToolsScopeId,
  type ProjectId,
  type ToolsProjectScopesResult,
  type ToolsUnavailableProject,
} from "@t3tools/contracts";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ProjectStoreV2 } from "../orchestration-v2/ProjectStore.ts";
import { ProcessRunner } from "../processRunner.ts";

const isToolsScopeError = Schema.is(ToolsScopeError);

export class ToolsProjectScopesService extends Context.Service<
  ToolsProjectScopesService,
  {
    readonly list: (
      projectIds: ReadonlyArray<ProjectId>,
    ) => Effect.Effect<ToolsProjectScopesResult, ToolsScopeError>;
    readonly resolve: (
      projectId: ProjectId,
    ) => Effect.Effect<
      { readonly scopeId: ToolsScopeId; readonly projectIds: ReadonlyArray<ProjectId> },
      ToolsScopeError
    >;
  }
>()("t3/skills/ToolsProjectScopes/ToolsProjectScopesService") {}

export const layer = Layer.effect(
  ToolsProjectScopesService,
  Effect.gen(function* () {
    const projects = yield* ProjectStoreV2;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const crypto = yield* Crypto.Crypto;
    const runner = yield* ProcessRunner;
    const protect = <A, E>(effect: Effect.Effect<A, E>) =>
      effect.pipe(
        Effect.mapError((cause) =>
          isToolsScopeError(cause)
            ? cause
            : new ToolsScopeError({ message: "Could not load this project's tools scope." }),
        ),
      );
    const repositoryScopes = yield* Cache.makeWith(
      (workspaceRoot: string) =>
        protect(
          Effect.gen(function* () {
            const result = yield* runner
              .run({
                command: "git",
                args: [
                  "-C",
                  workspaceRoot,
                  "rev-parse",
                  "--path-format=absolute",
                  "--git-common-dir",
                ],
                timeout: Duration.seconds(5),
                maxOutputBytes: 16_384,
              })
              .pipe(
                Effect.mapError(
                  () =>
                    new ToolsScopeError({
                      message: "Could not inspect this workspace's Git repository.",
                    }),
                ),
              );
            if (result.code !== 0) {
              if (result.stderr.includes("not a git repository")) return null;
              return yield* new ToolsScopeError({
                message: "Could not inspect this workspace's Git repository.",
              });
            }
            const commonDirectory = result.stdout.trim();
            if (!commonDirectory)
              return yield* new ToolsScopeError({
                message: "Git returned an empty shared repository directory.",
              });
            const canonicalDirectory = yield* fs.realPath(
              path.resolve(workspaceRoot, commonDirectory),
            );
            const digest = yield* crypto.digest(
              "SHA-256",
              new TextEncoder().encode(canonicalDirectory),
            );
            return ToolsScopeId.make(`git:${Buffer.from(digest).toString("hex")}`);
          }),
        ),
      {
        capacity: 1_024,
        timeToLive: (exit) => (Exit.isSuccess(exit) ? Duration.minutes(1) : Duration.zero),
      },
    );
    const scopeOf = Effect.fn("ToolsProjectScopes.scopeOf")(function* (project: {
      projectId: ProjectId;
      workspaceRoot: string;
    }) {
      yield* protect(
        Effect.gen(function* () {
          const info = yield* fs.stat(project.workspaceRoot).pipe(
            Effect.mapError(
              () =>
                new ToolsScopeError({
                  message: "The workspace folder is missing or unreadable.",
                }),
            ),
          );
          if (info.type !== "Directory")
            return yield* new ToolsScopeError({
              message: "The registered workspace is not a directory.",
            });
          yield* fs.access(project.workspaceRoot, { readable: true }).pipe(
            Effect.mapError(
              () =>
                new ToolsScopeError({
                  message: "The workspace folder is missing or unreadable.",
                }),
            ),
          );
        }),
      ).pipe(
        Effect.catch((error) =>
          Cache.invalidate(repositoryScopes, project.workspaceRoot).pipe(
            Effect.andThen(Effect.fail(error)),
          ),
        ),
      );
      return (
        (yield* Cache.get(repositoryScopes, project.workspaceRoot)) ??
        ToolsScopeId.make(`project:${project.projectId}`)
      );
    });
    const list = Effect.fn("ToolsProjectScopes.list")(function* (
      projectIds: ReadonlyArray<ProjectId>,
    ) {
      const rows = yield* projects.list({ projectIds });
      const resolved = yield* Effect.forEach(
        rows,
        (project) =>
          scopeOf(project).pipe(
            Effect.map((scopeId) => ({ project, scopeId })),
            Effect.catch((error) => Effect.succeed({ project, error })),
          ),
        { concurrency: 4 },
      );
      const groups = new Map<
        ToolsScopeId,
        { id: ToolsScopeId; label: string; memberProjectIds: ProjectId[]; workspaceRoot: string }
      >();
      const unavailableProjects: ToolsUnavailableProject[] = [];
      for (const entry of resolved) {
        const { project } = entry;
        if ("error" in entry) {
          unavailableProjects.push({
            projectId: project.projectId,
            title: project.title,
            workspaceRoot: project.workspaceRoot,
            message: entry.error.message,
          });
          continue;
        }
        const { scopeId } = entry;
        const existing = groups.get(scopeId);
        if (existing) existing.memberProjectIds.push(project.projectId);
        else
          groups.set(scopeId, {
            id: scopeId,
            label: project.title,
            memberProjectIds: [project.projectId],
            workspaceRoot: project.workspaceRoot,
          });
      }
      return {
        scopes: [...groups.values()].sort(
          (left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id),
        ),
        ...(unavailableProjects.length ? { unavailableProjects } : {}),
      };
    });
    return ToolsProjectScopesService.of({
      list: (ids) => protect(list(ids)),
      resolve: (projectId) =>
        protect(
          Effect.gen(function* () {
            const project = yield* projects.get(projectId);
            if (Option.isNone(project))
              return yield* new ToolsScopeError({
                message: "The tools project's workspace no longer exists.",
              });
            const scopeId = yield* scopeOf(project.value);
            const rows = yield* projects.list();
            const members = yield* Effect.forEach(
              rows,
              (row) =>
                scopeOf(row).pipe(
                  Effect.map((id) => (id === scopeId ? row.projectId : null)),
                  Effect.orElseSucceed(() => null),
                ),
              { concurrency: 4 },
            );
            return { scopeId, projectIds: members.filter((id): id is ProjectId => id !== null) };
          }),
        ),
    });
  }),
);
