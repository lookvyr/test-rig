import type {
  ProjectId,
  ProjectScopedServerSettingKey,
  ServerSettings,
  ServerSettingsPatch,
} from "@t3tools/contracts";
import {
  clearProjectSettingsOverrides,
  resolveProjectSettings,
} from "@t3tools/shared/projectSettings";
import * as Equal from "effect/Equal";

export type BranchNamingPatch = Pick<
  ServerSettingsPatch,
  "branchNamingMode" | "branchNamePrefix" | "branchNameInstructions"
>;

export function resolveProjectSettingsTargets(
  settings: ServerSettings,
  projectIds: readonly ProjectId[] | null,
) {
  return projectIds === null
    ? [resolveProjectSettings(settings, null)]
    : projectIds.map((id) => resolveProjectSettings(settings, id));
}

type SettingsTarget = ReturnType<typeof resolveProjectSettingsTargets>[number];

export function projectSettingsAreMixed(
  targets: readonly SettingsTarget[],
  key: ProjectScopedServerSettingKey,
): boolean {
  const first = targets[0];
  return (
    first !== undefined &&
    targets.some((target) => !Equal.equals(first.settings[key], target.settings[key]))
  );
}

export function projectSettingSource(
  targets: readonly SettingsTarget[],
  key: ProjectScopedServerSettingKey,
) {
  const sources = new Set(targets.map((target) => target.sources[key]));
  return sources.size > 1 ? "mixed" : sources.has("project") ? "project" : "environment";
}

/** Override entries are replaced by the server, so retain each project's other settings. */
export function projectSettingsPatch(
  settings: ServerSettings,
  projectIds: readonly ProjectId[] | null,
  patch: BranchNamingPatch,
): ServerSettingsPatch {
  if (projectIds === null) return patch;
  return {
    projectSettingsOverrides: Object.fromEntries(
      projectIds.map((id) => [id, { ...settings.projectSettingsOverrides[id], ...patch }]),
    ),
  };
}

export function clearScopedProjectSettings(
  settings: ServerSettings,
  projectIds: readonly ProjectId[],
  key: ProjectScopedServerSettingKey,
): ServerSettingsPatch {
  return {
    projectSettingsOverrides: Object.fromEntries(
      projectIds.map((id) => [id, clearProjectSettingsOverrides(settings, id, [key])]),
    ),
  };
}

/** Build replacement entries after earlier saves finish, even if the config stream lags. */
export function createProjectSettingsSaver(
  readSettings: () => ServerSettings | null,
  save: (patch: ServerSettingsPatch) => Promise<ServerSettings | null>,
) {
  let pending: Promise<ServerSettings | null> | null = null;
  let acknowledged: ServerSettings[] = [];
  return (buildPatch: (settings: ServerSettings) => ServerSettingsPatch) => {
    const previous = pending;
    const next = (async () => {
      if (previous) await previous;
      const observed = readSettings();
      const observedIndex = acknowledged.findIndex((settings) => Equal.equals(settings, observed));
      // A delayed stream event may acknowledge only an earlier save. Keep later edits
      // until they arrive too; an unrelated snapshot becomes the new source of truth.
      acknowledged = observedIndex < 0 ? [] : acknowledged.slice(observedIndex);
      const settings = acknowledged.at(-1) ?? observed;
      if (settings === null) return null;
      if (acknowledged.length === 0) acknowledged.push(settings);
      const saved = await save(buildPatch(settings));
      if (saved !== null) acknowledged.push(saved);
      return saved ?? settings;
    })();
    pending = next;
    const clear = () => {
      if (pending === next) pending = null;
    };
    void next.then(clear, clear);
    return next;
  };
}
