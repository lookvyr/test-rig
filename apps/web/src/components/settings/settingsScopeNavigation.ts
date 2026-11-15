import { validateSettingsScopeSearch, type SettingsScopeSearch } from "./settingsScope";

export function validateSettingsRouteSearch(raw: Record<string, unknown>) {
  return validateSettingsScopeSearch(
    typeof raw.environmentId === "string" && raw.machine === undefined && raw.project === undefined
      ? { ...raw, machine: raw.environmentId }
      : raw,
  );
}

const SCOPE_KEYS = [
  "project",
  "machine",
  "checkout",
] as const satisfies readonly (keyof SettingsScopeSearch)[];
/**
 * Search for a settings link. Moving between pages that both follow the page
 * scope keeps the selected project and environment; every other move starts
 * from all projects. (The Tools page has its own `project` parameter, so the
 * scope is not retained globally.)
 */
export function settingsLinkSearch(
  fromPath: string,
  toPath: string,
  current: SettingsScopeSearch,
  scopedPaths: ReadonlySet<string>,
): SettingsScopeSearch {
  if (!scopedPaths.has(fromPath) || !scopedPaths.has(toPath)) return {};
  return Object.fromEntries(
    SCOPE_KEYS.filter((key) => current[key] !== undefined).map((key) => [key, current[key]]),
  );
}
