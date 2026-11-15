import * as Schema from "effect/Schema";
import { ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Environment-local repository identity; distinct from physical workspace project IDs. */
export const ToolsScopeId = TrimmedNonEmptyString.check(
  Schema.isPattern(/^(?:git:[a-f0-9]{64}|project:.+)$/),
).pipe(Schema.brand("ToolsScopeId"));
export type ToolsScopeId = typeof ToolsScopeId.Type;

export const ToolsProjectScope = Schema.Struct({
  id: ToolsScopeId,
  label: TrimmedNonEmptyString,
  memberProjectIds: Schema.Array(ProjectId),
  workspaceRoot: TrimmedNonEmptyString,
});
export type ToolsProjectScope = typeof ToolsProjectScope.Type;

export const ToolsProjectScopesInput = Schema.Struct({
  projectIds: Schema.Array(ProjectId).check(Schema.isMaxLength(10_000)),
});
export type ToolsProjectScopesInput = typeof ToolsProjectScopesInput.Type;
export const ToolsUnavailableProject = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  message: Schema.String,
});
export type ToolsUnavailableProject = typeof ToolsUnavailableProject.Type;
export const ToolsProjectScopesResult = Schema.Struct({
  scopes: Schema.Array(ToolsProjectScope),
  unavailableProjects: Schema.optionalKey(Schema.Array(ToolsUnavailableProject)),
});
export type ToolsProjectScopesResult = typeof ToolsProjectScopesResult.Type;

/**
 * Which projects a skill or MCP server applies to. With `allProjects` it
 * reaches every project, including ones added later, except disabled ones;
 * otherwise only the listed ones. Project ID lists predate tools scopes and
 * are still honoured for saved skills.
 */
export const ToolsAssignment = Schema.Struct({
  allProjects: Schema.Boolean,
  projectIds: Schema.Array(ProjectId).check(Schema.isMaxLength(1_000)),
  disabledProjectIds: Schema.Array(ProjectId).check(Schema.isMaxLength(1_000)),
  scopeIds: Schema.optionalKey(Schema.Array(ToolsScopeId).check(Schema.isMaxLength(1_000))),
  disabledScopeIds: Schema.optionalKey(Schema.Array(ToolsScopeId).check(Schema.isMaxLength(1_000))),
});
export type ToolsAssignment = typeof ToolsAssignment.Type;

export const ALL_PROJECTS_TOOLS_ASSIGNMENT: ToolsAssignment = {
  allProjects: true,
  projectIds: [],
  disabledProjectIds: [],
};

/** Whether an assignment reaches a project, identified by its scope and member project IDs. */
export function isToolsAssignmentAvailable(
  assignment: ToolsAssignment,
  scopeId: ToolsScopeId | null | undefined,
  memberProjectIds: ReadonlyArray<ProjectId>,
): boolean {
  if (scopeId != null) {
    if (assignment.disabledScopeIds?.includes(scopeId)) return false;
    if (assignment.scopeIds?.includes(scopeId)) return true;
  }
  return (
    !memberProjectIds.some((id) => assignment.disabledProjectIds.includes(id)) &&
    (assignment.allProjects || memberProjectIds.some((id) => assignment.projectIds.includes(id)))
  );
}

export class ToolsScopeError extends Schema.TaggedError<ToolsScopeError>()("ToolsScopeError", {
  message: Schema.String,
}) {}
