import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { IsoDateTime, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";
import { isToolsAssignmentAvailable, ToolsAssignment, type ToolsScopeId } from "./toolsScope.ts";

export const SKILL_LIBRARY_MAX_SKILLS = 256;
export const SKILL_LIBRARY_MAX_INSTRUCTIONS_LENGTH = 200_000;
export const SKILL_LIBRARY_MAX_SUPPORTING_FILES = 512;
export const SKILL_LIBRARY_MAX_IMPORT_BYTES = 20 * 1024 * 1024;

export const SkillLibraryId = Schema.String.check(
  Schema.isPattern(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/),
);
export type SkillLibraryId = typeof SkillLibraryId.Type;

export const SkillLibraryProvider = Schema.Literals(["codex", "claudeAgent"]);
export type SkillLibraryProvider = typeof SkillLibraryProvider.Type;

export const SkillLibraryAssignment = ToolsAssignment;
export type SkillLibraryAssignment = ToolsAssignment;

const editableFields = {
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  description: Schema.String.check(Schema.isMaxLength(2_000)),
  providers: Schema.Array(SkillLibraryProvider).check(Schema.isMaxLength(2)),
  assignment: SkillLibraryAssignment,
};

export const SkillLibrarySummary = Schema.Struct({
  id: SkillLibraryId,
  ...editableFields,
  // Read the former default assignment without dropping the saved skill.
  providers: Schema.Array(Schema.Union([SkillLibraryProvider, Schema.Literal("opencode")])).pipe(
    Schema.decodeTo(
      Schema.Array(SkillLibraryProvider),
      SchemaTransformation.transform({
        decode: (providers): ReadonlyArray<SkillLibraryProvider> =>
          providers.filter((provider) => provider !== "opencode"),
        encode: (providers) => providers,
      }),
    ),
  ),
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  path: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type SkillLibrarySummary = typeof SkillLibrarySummary.Type;

export const SkillLibraryDetail = Schema.Struct({
  ...SkillLibrarySummary.fields,
  instructions: Schema.String.check(Schema.isMaxLength(SKILL_LIBRARY_MAX_INSTRUCTIONS_LENGTH)),
  supportingFiles: Schema.Array(Schema.String),
});
export type SkillLibraryDetail = typeof SkillLibraryDetail.Type;

export const SkillLibraryListResult = Schema.Struct({ skills: Schema.Array(SkillLibrarySummary) });
export type SkillLibraryListResult = typeof SkillLibraryListResult.Type;

export const SkillLibraryReadInput = Schema.Struct({ id: SkillLibraryId });
export type SkillLibraryReadInput = typeof SkillLibraryReadInput.Type;

export const SkillLibraryUpsertInput = Schema.Struct({
  id: Schema.optionalKey(SkillLibraryId),
  ...editableFields,
  /** Omitted keeps the stored value; a new skill starts on. */
  enabled: Schema.optionalKey(Schema.Boolean),
  instructions: Schema.String.check(Schema.isMaxLength(SKILL_LIBRARY_MAX_INSTRUCTIONS_LENGTH)),
});
export type SkillLibraryUpsertInput = typeof SkillLibraryUpsertInput.Type;

export const SkillLibraryImportInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  cwd: TrimmedNonEmptyString,
  sourcePath: TrimmedNonEmptyString,
  name: Schema.optionalKey(editableFields.name),
  providers: editableFields.providers,
  assignment: SkillLibraryAssignment,
});
export type SkillLibraryImportInput = typeof SkillLibraryImportInput.Type;

export const SkillLibrarySourceReadInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  cwd: TrimmedNonEmptyString,
  sourcePath: TrimmedNonEmptyString,
});
export type SkillLibrarySourceReadInput = typeof SkillLibrarySourceReadInput.Type;
export const SkillLibrarySourceInput = SkillLibrarySourceReadInput;
export type SkillLibrarySourceInput = SkillLibrarySourceReadInput;

export const SkillLibrarySourceDetail = Schema.Struct({
  path: TrimmedNonEmptyString,
  name: editableFields.name,
  description: editableFields.description,
  instructions: Schema.String.check(Schema.isMaxLength(SKILL_LIBRARY_MAX_INSTRUCTIONS_LENGTH)),
  supportingFiles: Schema.Array(Schema.String),
});
export type SkillLibrarySourceDetail = typeof SkillLibrarySourceDetail.Type;

export class SkillLibraryError extends Schema.TaggedError<SkillLibraryError>()(
  "SkillLibraryError",
  { operation: Schema.String, message: Schema.String },
) {}

/** Assignment controls the catalogue, rather than filesystem permissions. */
export function isSkillLibrarySkillAvailable(
  skill: Pick<SkillLibrarySummary, "providers" | "assignment"> & { readonly enabled?: boolean },
  projectId: ProjectId | null | undefined,
  provider: string,
  scopeId?: ToolsScopeId | null,
  memberProjectIds: ReadonlyArray<ProjectId> = projectId == null ? [] : [projectId],
): boolean {
  if (skill.enabled === false || !skill.providers.some((entry) => entry === provider)) return false;
  if (projectId == null && scopeId == null) return false;
  return isToolsAssignmentAvailable(skill.assignment, scopeId, memberProjectIds);
}
