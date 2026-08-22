import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { ProjectScriptIcon } from "./orchestration.ts";

/** File name of the checked-in T3 project file, resolved at the workspace root. */
export const T3_PROJECT_FILE_NAME = "t3.json";

const T3_PROJECT_FILE_PATH_MAX_LENGTH = 512;
const T3_PROJECT_FILE_MAX_SCRIPTS = 50;

const trimmedNonEmpty = (maxLength?: number) => {
  const encoded =
    maxLength === undefined
      ? Schema.String.check(Schema.isNonEmpty())
      : Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(maxLength));
  return encoded.pipe(Schema.decodeTo(encoded, SchemaTransformation.trim()));
};

export const T3ProjectFileScript = Schema.Struct({
  name: trimmedNonEmpty(),
  command: trimmedNonEmpty(),
  icon: Schema.optionalKey(ProjectScriptIcon),
  runOnWorktreeCreate: Schema.optionalKey(Schema.Boolean),
  previewUrl: Schema.optionalKey(trimmedNonEmpty()),
  autoOpenPreview: Schema.optionalKey(Schema.Boolean),
});
export type T3ProjectFileScript = typeof T3ProjectFileScript.Type;

export const T3ProjectFile = Schema.Struct({
  iconPath: Schema.optionalKey(trimmedNonEmpty(T3_PROJECT_FILE_PATH_MAX_LENGTH)),
  scripts: Schema.optionalKey(
    Schema.Array(T3ProjectFileScript).check(Schema.isMaxLength(T3_PROJECT_FILE_MAX_SCRIPTS)),
  ),
});
export type T3ProjectFile = typeof T3ProjectFile.Type;
