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

export class ToolsScopeError extends Schema.TaggedError<ToolsScopeError>()("ToolsScopeError", {
  message: Schema.String,
}) {}
