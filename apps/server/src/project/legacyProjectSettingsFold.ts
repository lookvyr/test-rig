import type {
  OrchestrationProjectShell,
  ProjectSettingsOverrides,
  ServerSettings,
  ServerSettingsPatch,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ServerSettingsService from "../serverSettings.ts";

/** The per-project fields older releases kept on the project itself. */
export type LegacyProjectSettingsRow = Pick<
  OrchestrationProjectShell,
  "id" | "defaultThreadEnvMode" | "autoPull" | "scripts"
>;

/**
 * Moves the per-project workspace, auto-pull, browser-access, and action
 * settings that older releases stored on the project (and in the
 * legacy per-key maps) into `projectSettingsOverrides`, where settings pages
 * and the server read them. Existing override keys win, so nothing a user set
 * since is replaced. Returns null when there is nothing to fold yet.
 *
 * Unlike upstream, a model saved on the project is not folded: here it is only
 * a fallback for new threads, and an override would pin them over "Automatic".
 *
 * `projectSettingsFolded` is set with the result, so a later reset in
 * Settings cannot be undone by the stale project fields on the next start.
 */
export function foldLegacyProjectSettings(
  settings: ServerSettings,
  rows: ReadonlyArray<LegacyProjectSettingsRow>,
): ServerSettingsPatch | null {
  if (settings.projectSettingsFolded) return null;
  if (
    rows.length === 0 &&
    Object.keys(settings.projectAgentBrowserAccessOverrides).length === 0 &&
    Object.keys(settings.projectAutoPullOverrides).length === 0 &&
    Object.keys(settings.projectScriptOverrides).length === 0
  ) {
    return null;
  }
  const entries: Record<string, ProjectSettingsOverrides> = {};
  const changed = new Set<string>();
  const set = <K extends keyof ProjectSettingsOverrides>(
    projectId: string,
    key: K,
    value: ProjectSettingsOverrides[K] | undefined,
  ) => {
    if (value === undefined) return;
    const entry = entries[projectId] ?? settings.projectSettingsOverrides[projectId as never] ?? {};
    if (Object.hasOwn(entry, key)) return;
    entries[projectId] = { ...entry, [key]: value };
    changed.add(projectId);
  };
  for (const [projectId, value] of Object.entries(settings.projectAgentBrowserAccessOverrides)) {
    set(projectId, "enableAgentBrowserAccess", value);
  }
  for (const [projectId, value] of Object.entries(settings.projectAutoPullOverrides)) {
    set(projectId, "defaultAutoPull", value);
  }
  // A stored null meant "use the environment's actions", so the project's own list must not return.
  const resetScripts = new Set<string>();
  for (const [projectId, value] of Object.entries(settings.projectScriptOverrides)) {
    if (value === null) resetScripts.add(projectId);
    else set(projectId, "defaultProjectScripts", value);
  }
  for (const row of rows) {
    if (row.defaultThreadEnvMode === "local" || row.defaultThreadEnvMode === "worktree") {
      set(row.id, "defaultThreadEnvMode", row.defaultThreadEnvMode);
    }
    if (row.autoPull === true) set(row.id, "defaultAutoPull", true);
    if (row.scripts.length > 0 && !resetScripts.has(row.id)) {
      set(row.id, "defaultProjectScripts", row.scripts);
    }
  }
  if (changed.size === 0) return { projectSettingsFolded: true };
  return {
    projectSettingsFolded: true,
    projectSettingsOverrides: Object.fromEntries(
      [...changed].map((projectId) => [projectId, entries[projectId]!]),
    ) as NonNullable<ServerSettingsPatch["projectSettingsOverrides"]>,
  };
}

/** Startup step: fold the legacy fields once, before clients read project settings. */
export const runLegacyProjectSettingsFold = Effect.gen(function* () {
  const settingsService = yield* ServerSettingsService.ServerSettingsService;
  const settings = yield* settingsService.getSettings;
  if (settings.projectSettingsFolded) return;
  const projects = yield* (yield* ProjectStore.ProjectStoreV2).listShells();
  const patch = foldLegacyProjectSettings(settings, projects);
  if (patch !== null) yield* settingsService.updateSettings(patch);
});
