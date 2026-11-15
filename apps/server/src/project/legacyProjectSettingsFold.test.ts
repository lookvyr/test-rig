import { describe, expect, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  type ProjectScript,
  type ServerSettings,
} from "@t3tools/contracts";
import { applyServerSettingsPatch } from "@t3tools/shared/serverSettings";
import { resolveProjectScripts } from "@t3tools/shared/projectScripts";

import {
  foldLegacyProjectSettings,
  type LegacyProjectSettingsRow,
} from "./legacyProjectSettingsFold.ts";

const projectId = ProjectId.make("project:fold");
const otherId = ProjectId.make("project:other");
const script = (id: string, command: string): ProjectScript => ({
  id,
  name: id,
  command,
  icon: "play",
  runOnWorktreeCreate: false,
});
const row = (overrides: Partial<LegacyProjectSettingsRow> = {}): LegacyProjectSettingsRow => ({
  id: projectId,
  defaultThreadEnvMode: null,
  autoPull: false,
  scripts: [],
  ...overrides,
});
const settingsWith = (overrides: Partial<ServerSettings> = {}): ServerSettings => ({
  ...DEFAULT_SERVER_SETTINGS,
  ...overrides,
});
const fold = (settings: ServerSettings, rows: ReadonlyArray<LegacyProjectSettingsRow>) => {
  const patch = foldLegacyProjectSettings(settings, rows);
  return patch === null ? null : applyServerSettingsPatch(settings, patch);
};

describe("foldLegacyProjectSettings", () => {
  it("keeps each project's existing actions exactly as they resolved before", () => {
    const actions = [script("dev", "vp dev"), { ...script("setup", "vp i"), async: false }];
    const rows = [row({ scripts: actions }), row({ id: otherId })];
    const settings = settingsWith({ defaultProjectScripts: [script("lint", "vp lint")] });
    const before = rows.map((project) => resolveProjectScripts(settings, project));
    const folded = fold(settings, rows)!;
    expect(folded.projectSettingsFolded).toBe(true);
    expect(rows.map((project) => resolveProjectScripts(folded, project))).toEqual(before);
    expect(folded.projectSettingsOverrides[projectId]?.defaultProjectScripts).toEqual(actions);
    expect(folded.projectSettingsOverrides[otherId]).toBeUndefined();
  });

  it("moves the project's workspace and auto-pull into its override", () => {
    const folded = fold(settingsWith(), [
      row({ defaultThreadEnvMode: "worktree", autoPull: true }),
    ])!;
    expect(folded.projectSettingsOverrides[projectId]).toEqual({
      defaultThreadEnvMode: "worktree",
      defaultAutoPull: true,
    });
  });

  it("never replaces an override set since, and honours a stored reset of actions", () => {
    const folded = fold(
      settingsWith({
        projectScriptOverrides: { [otherId]: null },
        projectSettingsOverrides: { [projectId]: { defaultThreadEnvMode: "local" } },
      }),
      [
        row({ defaultThreadEnvMode: "worktree", scripts: [script("a", "a")] }),
        row({ id: otherId, scripts: [script("b", "b")] }),
      ],
    )!;
    expect(folded.projectSettingsOverrides[projectId]).toEqual({
      defaultThreadEnvMode: "local",
      defaultProjectScripts: [script("a", "a")],
    });
    expect(folded.projectSettingsOverrides[otherId]).toBeUndefined();
  });

  it("runs once", () => {
    const settings = settingsWith({ projectSettingsFolded: true });
    expect(foldLegacyProjectSettings(settings, [row({ scripts: [script("a", "a")] })])).toBeNull();
    expect(foldLegacyProjectSettings(settingsWith(), [])).toBeNull();
  });
});
