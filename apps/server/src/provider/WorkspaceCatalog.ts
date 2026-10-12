import {
  isSkillLibrarySkillAvailable,
  ProjectId,
  type ProviderInstanceId,
  type ServerProviderWorkspaceCatalog,
  type SkillLibrarySummary,
  type ToolsScopeId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { SkillLibraryService } from "../skills/SkillLibrary.ts";
import { ToolsProjectScopesService } from "../skills/ToolsProjectScopes.ts";

import type { ProviderInstance } from "./ProviderDriver.ts";

/** Match registered roots or persisted thread worktrees, never arbitrary path ancestry. */
const workspaceProjectIds = Effect.fn("workspaceProjectIds")(function* (cwd: string) {
  const path = yield* Path.Path;
  const normalizedCwd = path.resolve(cwd);
  const sql = yield* SqlClient.SqlClient;
  const findWorkspaceProjects = SqlSchema.findAll({
    Request: Schema.String,
    Result: Schema.Struct({ projectId: ProjectId }),
    execute: (workspacePath) => sql`
      SELECT project_id AS "projectId"
      FROM projection_projects
      WHERE deleted_at IS NULL AND workspace_root = ${workspacePath}
      UNION
      SELECT DISTINCT threads.project_id AS "projectId"
      FROM orchestration_v2_projection_threads AS threads
      INNER JOIN projection_projects AS projects ON projects.project_id = threads.project_id
      WHERE threads.deleted_at IS NULL AND projects.deleted_at IS NULL
        AND json_extract(threads.payload_json, '$.worktreePath') = ${workspacePath}
    `,
  });
  const matches = yield* findWorkspaceProjects(normalizedCwd);
  return matches.map((match) => match.projectId);
});

export const resolveLibraryWorkspaceScope = Effect.fn("resolveLibraryWorkspaceScope")(function* (
  cwd: string,
) {
  const ids = yield* workspaceProjectIds(cwd);
  if (ids.length === 0) return null;
  const toolsScopes = yield* ToolsProjectScopesService;
  const scopes = yield* Effect.forEach(ids, (id) => toolsScopes.resolve(id));
  if (new Set(scopes.map((scope) => scope.scopeId)).size !== 1) return null;
  return { projectId: ids[0]!, scopeId: scopes[0]!.scopeId, projectIds: scopes[0]!.projectIds };
});

export function mergeLibrarySkills(
  catalog: ServerProviderWorkspaceCatalog,
  skills: ReadonlyArray<SkillLibrarySummary>,
  projectId: ProjectId | null,
  provider: string,
  scopeId?: ToolsScopeId,
  memberProjectIds?: ReadonlyArray<ProjectId>,
): ServerProviderWorkspaceCatalog {
  return {
    ...catalog,
    skills: [
      ...catalog.skills,
      ...skills
        .filter((skill) =>
          isSkillLibrarySkillAvailable(skill, projectId, provider, scopeId, memberProjectIds),
        )
        .map((skill) => ({
          name: `test-rig:${skill.id}`,
          displayName: skill.name,
          ...(skill.description.trim() ? { description: skill.description } : {}),
          path: skill.path,
          scope: "app",
          source: "test-rig" as const,
          enabled: true,
          userInvocable: true,
        })),
    ],
  };
}

/** Read workspace inventory without refreshing or publishing environment health. */
export const readProviderWorkspaceCatalog = Effect.fn("readProviderWorkspaceCatalog")(function* (
  input: { readonly instanceId: ProviderInstanceId; readonly cwd: string },
  getInstance: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<
    Pick<ProviderInstance, "enabled" | "driverKind" | "getWorkspaceCatalog"> | undefined
  >,
) {
  const instance = yield* getInstance(input.instanceId);
  if (!instance?.enabled || input.cwd.trim().length === 0) {
    return { skills: [], slashCommands: [] };
  }
  const nativeCatalog: ServerProviderWorkspaceCatalog = instance.getWorkspaceCatalog
    ? yield* instance.getWorkspaceCatalog(input.cwd)
    : { skills: [], slashCommands: [] };
  const catalog = {
    ...nativeCatalog,
    skills: yield* resolveSkillSourcePaths(nativeCatalog.skills),
  };
  return yield* Effect.gen(function* () {
    const library = yield* SkillLibraryService;
    const workspace = yield* resolveLibraryWorkspaceScope(input.cwd);
    if (workspace === null) return catalog;
    const summaries = yield* library.list;
    return mergeLibrarySkills(
      catalog,
      summaries.skills,
      workspace.projectId,
      instance.driverKind,
      workspace.scopeId,
      workspace.projectIds,
    );
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed({
        ...catalog,
        errorMessage: catalog.errorMessage ?? `Unable to read the skill library: ${String(error)}`,
      }),
    ),
  );
});

/** Identify shared files without conflating independent skills with the same name. */
export const resolveSkillSourcePaths = Effect.fn("resolveSkillSourcePaths")(function* (
  skills: ServerProviderWorkspaceCatalog["skills"],
) {
  const fs = yield* FileSystem.FileSystem;
  return yield* Effect.forEach(
    skills,
    (skill) =>
      fs.realPath(skill.path).pipe(
        Effect.match({
          onSuccess: (canonicalPath) => ({ ...skill, canonicalPath }),
          onFailure: () => skill,
        }),
      ),
    { concurrency: 8 },
  );
});
