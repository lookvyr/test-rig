import { DEFAULT_SERVER_SETTINGS, ProjectId, type ProjectScript } from "@t3tools/contracts";
import { resolveProjectScripts } from "@t3tools/shared/projectScripts";
import { applyServerSettingsPatch } from "@t3tools/shared/serverSettings";
import { describe, expect, it } from "vite-plus/test";

import { projectScriptsPatch } from "./useProjectScriptSettings";

const projectId = ProjectId.make("project");
const dev: ProjectScript = {
  id: "dev",
  name: "Dev",
  command: "vp dev",
  icon: "play",
  runOnWorktreeCreate: false,
};
const settings = {
  ...DEFAULT_SERVER_SETTINGS,
  defaultProjectScripts: [{ ...dev, id: "lint", command: "vp lint" }],
  projectSettingsOverrides: { [projectId]: { defaultThreadEnvMode: "worktree" as const } },
};
const project = { id: projectId, scripts: [] };

describe("projectScriptsPatch", () => {
  it("stores the project's actions without dropping its other overrides", () => {
    const next = applyServerSettingsPatch(
      settings,
      projectScriptsPatch(settings, projectId, [dev]),
    );
    expect(next.projectSettingsOverrides[projectId]).toEqual({
      defaultThreadEnvMode: "worktree",
      defaultProjectScripts: [dev],
    });
    expect(resolveProjectScripts(next, project)).toEqual([dev]);
  });

  it("returns a project to the environment's default actions", () => {
    const overridden = applyServerSettingsPatch(
      settings,
      projectScriptsPatch(settings, projectId, [dev]),
    );
    const reset = applyServerSettingsPatch(
      overridden,
      projectScriptsPatch(overridden, projectId, null),
    );
    expect(reset.projectSettingsOverrides[projectId]).toEqual({ defaultThreadEnvMode: "worktree" });
    expect(resolveProjectScripts({ ...reset, projectSettingsFolded: true }, project)).toEqual(
      settings.defaultProjectScripts,
    );
  });
});
