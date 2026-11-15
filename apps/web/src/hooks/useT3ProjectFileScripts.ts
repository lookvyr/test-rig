import {
  T3_PROJECT_FILE_NAME,
  type EnvironmentId,
  type T3ProjectFileScript,
} from "@t3tools/contracts";
import { T3ProjectFileFromJson } from "@t3tools/shared/t3ProjectFile";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { useMemo } from "react";

import { useProjectFileQuery } from "~/components/files/projectFilesQueryState";

const decodeT3ProjectFile = Schema.decodeExit(T3ProjectFileFromJson);

const NO_SCRIPTS: ReadonlyArray<T3ProjectFileScript> = [];

/**
 * Scripts declared in the project's checked-in `t3.json`, offered in the
 * scripts menu for import. Missing, truncated, or invalid files resolve to
 * an empty list.
 */
export function useT3ProjectFileScripts(
  environmentId: EnvironmentId,
  cwd: string | null,
): ReadonlyArray<T3ProjectFileScript> {
  const query = useProjectFileQuery(environmentId, cwd ?? "", T3_PROJECT_FILE_NAME, cwd !== null);
  const contents = query.data && !query.data.truncated ? query.data.contents : null;
  return useMemo(() => {
    if (contents === null) return NO_SCRIPTS;
    const decoded = decodeT3ProjectFile(contents);
    if (Exit.isFailure(decoded)) return NO_SCRIPTS;
    return decoded.value.scripts ?? NO_SCRIPTS;
  }, [contents]);
}

export type T3ProjectFileStatus = "loading" | "missing" | "valid" | "invalid";

/**
 * The checkout's `t3.json` scripts plus whether the file parsed, so settings
 * can warn when a file exists but is ignored.
 */
export function useT3ProjectFileState(
  environmentId: EnvironmentId,
  cwd: string | null,
): { readonly scripts: ReadonlyArray<T3ProjectFileScript>; readonly status: T3ProjectFileStatus } {
  const query = useProjectFileQuery(environmentId, cwd ?? "", T3_PROJECT_FILE_NAME, cwd !== null);
  const contents = query.data && !query.data.truncated ? query.data.contents : null;
  const pending = query.isPending && query.data === null;
  return useMemo(() => {
    if (contents === null) return { scripts: NO_SCRIPTS, status: pending ? "loading" : "missing" };
    const decoded = decodeT3ProjectFile(contents);
    return Exit.isFailure(decoded)
      ? { scripts: NO_SCRIPTS, status: "invalid" }
      : { scripts: decoded.value.scripts ?? NO_SCRIPTS, status: "valid" };
  }, [contents, pending]);
}
