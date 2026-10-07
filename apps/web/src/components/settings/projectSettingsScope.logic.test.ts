import { DEFAULT_SERVER_SETTINGS, ProjectId, type ServerSettings } from "@t3tools/contracts";
import { applyServerSettingsPatch } from "@t3tools/shared/serverSettings";
import { describe, expect, it } from "vite-plus/test";
import {
  clearScopedProjectSettings,
  createProjectSettingsSaver,
  projectSettingSource,
  projectSettingsAreMixed,
  projectSettingsPatch,
  resolveProjectSettingsTargets,
} from "./projectSettingsScope.logic";

const first = ProjectId.make("first");
const second = ProjectId.make("second");
const other = ProjectId.make("other");
const settings: ServerSettings = {
  ...DEFAULT_SERVER_SETTINGS,
  branchNamePrefix: "team",
  projectSettingsOverrides: {
    [first]: { branchNamePrefix: "first", defaultAutoPull: true },
    [other]: { branchNamingMode: "custom", branchNameInstructions: "Keep case." },
  },
};

describe("project settings scope", () => {
  it("uses defaults for unset values and reports mixed values across checkouts", () => {
    const targets = resolveProjectSettingsTargets(settings, [first, second]);
    expect(targets.map((target) => target.settings.branchNamePrefix)).toEqual(["first", "team"]);
    expect(projectSettingsAreMixed(targets, "branchNamePrefix")).toBe(true);
    expect(projectSettingSource(targets, "branchNamePrefix")).toBe("mixed");
    expect(projectSettingsAreMixed(targets, "branchNamingMode")).toBe(false);
    expect(projectSettingSource(targets, "branchNamingMode")).toBe("environment");
  });

  it("writes all selected checkouts while preserving unrelated settings and projects", () => {
    const next = applyServerSettingsPatch(
      settings,
      projectSettingsPatch(settings, [first, second], {
        branchNamingMode: "custom",
        branchNameInstructions: "Use issue IDs.",
      }),
    );
    expect(next.branchNamingMode).toBe("static");
    expect(next.projectSettingsOverrides[first]).toEqual({
      branchNamePrefix: "first",
      defaultAutoPull: true,
      branchNamingMode: "custom",
      branchNameInstructions: "Use issue IDs.",
    });
    expect(next.projectSettingsOverrides[second]).toEqual({
      branchNamingMode: "custom",
      branchNameInstructions: "Use issue IDs.",
    });
    expect(next.projectSettingsOverrides[other]).toEqual(settings.projectSettingsOverrides[other]);
  });

  it("clears only the selected override and follows future default changes", () => {
    const cleared = applyServerSettingsPatch(
      settings,
      clearScopedProjectSettings(settings, [first], "branchNamePrefix"),
    );
    expect(cleared.projectSettingsOverrides[first]).toEqual({ defaultAutoPull: true });
    const next = applyServerSettingsPatch(
      cleared,
      projectSettingsPatch(cleared, null, { branchNamePrefix: "new-default" }),
    );
    expect(resolveProjectSettingsTargets(next, [first])[0]?.settings.branchNamePrefix).toBe(
      "new-default",
    );
    expect(next.projectSettingsOverrides[other]).toEqual(settings.projectSettingsOverrides[other]);
  });

  it("changing defaults preserves project overrides, including an empty prefix", () => {
    const empty = applyServerSettingsPatch(
      settings,
      projectSettingsPatch(settings, [first], { branchNamePrefix: "" }),
    );
    const next = applyServerSettingsPatch(
      empty,
      projectSettingsPatch(empty, null, { branchNamePrefix: "new-default" }),
    );
    expect(resolveProjectSettingsTargets(next, [first])[0]?.settings.branchNamePrefix).toBe("");
    expect(
      projectSettingSource(resolveProjectSettingsTargets(next, [first]), "branchNamePrefix"),
    ).toBe("project");
    expect(resolveProjectSettingsTargets(next, [second])[0]?.settings.branchNamePrefix).toBe(
      "new-default",
    );
  });

  it("keeps unavailable project scopes empty instead of editing defaults", () => {
    expect(resolveProjectSettingsTargets(settings, [])).toEqual([]);
    expect(
      applyServerSettingsPatch(
        settings,
        projectSettingsPatch(settings, [], { branchNamePrefix: "wrong" }),
      ),
    ).toEqual(applyServerSettingsPatch(settings, {}));
  });

  it("an explicit override equal to the default remains distinguishable and can be cleared", () => {
    const explicit = applyServerSettingsPatch(
      settings,
      projectSettingsPatch(settings, [second], { branchNamePrefix: "team" }),
    );
    const targets = resolveProjectSettingsTargets(explicit, [first, second]);
    expect(projectSettingSource(targets, "branchNamePrefix")).toBe("project");
    const cleared = applyServerSettingsPatch(
      explicit,
      clearScopedProjectSettings(explicit, [second], "branchNamePrefix"),
    );
    expect(cleared.projectSettingsOverrides[second]).toBeUndefined();
  });
});

function deferredSettings() {
  let resolve!: (settings: ServerSettings | null) => void;
  const promise = new Promise<ServerSettings | null>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("project settings save ordering", () => {
  it("preserves preceding edits and their original project while the subscription is stale", async () => {
    const firstResponse = deferredSettings();
    const writes: Array<ReturnType<typeof projectSettingsPatch>> = [];
    const save = createProjectSettingsSaver(
      () => settings,
      async (patch) => {
        writes.push(patch);
        return writes.length === 1
          ? firstResponse.promise
          : applyServerSettingsPatch(settings, patch);
      },
    );
    const prefixSave = save((current) =>
      projectSettingsPatch(current, [first], { branchNamePrefix: "edited" }),
    );
    const modeSave = save((current) =>
      projectSettingsPatch(current, [first], { branchNamingMode: "custom" }),
    );
    const otherProjectSave = save((current) =>
      projectSettingsPatch(current, [second], { branchNamePrefix: "second" }),
    );
    expect(writes).toHaveLength(1);
    firstResponse.resolve(applyServerSettingsPatch(settings, writes[0]!));
    await Promise.all([prefixSave, modeSave, otherProjectSave]);
    expect(writes[1]?.projectSettingsOverrides?.[first]).toEqual({
      defaultAutoPull: true,
      branchNamePrefix: "edited",
      branchNamingMode: "custom",
    });
    expect(Object.keys(writes[2]?.projectSettingsOverrides ?? {})).toEqual([second]);
  });

  it("retains acknowledged edits until the subscription advances", async () => {
    let observed = settings;
    let persisted = settings;
    const save = createProjectSettingsSaver(
      () => observed,
      async (patch) => (persisted = applyServerSettingsPatch(persisted, patch)),
    );
    await save((current) =>
      projectSettingsPatch(current, [first], { branchNamePrefix: "acknowledged" }),
    );
    const firstAcknowledgement = persisted;
    await save((current) => projectSettingsPatch(current, [first], { branchNamingMode: "custom" }));
    observed = firstAcknowledgement;
    await save((current) =>
      projectSettingsPatch(current, [first], { branchNameInstructions: "Keep case." }),
    );
    expect(persisted.projectSettingsOverrides[first]).toEqual({
      defaultAutoPull: true,
      branchNamePrefix: "acknowledged",
      branchNamingMode: "custom",
      branchNameInstructions: "Keep case.",
    });

    observed = persisted = applyServerSettingsPatch(persisted, {
      projectSettingsOverrides: {
        [first]: { ...persisted.projectSettingsOverrides[first], defaultAutoPull: false },
      },
    });
    await save((current) =>
      projectSettingsPatch(current, [first], { branchNameInstructions: "Keep case." }),
    );
    expect(persisted.projectSettingsOverrides[first]).toEqual({
      defaultAutoPull: false,
      branchNamePrefix: "acknowledged",
      branchNamingMode: "custom",
      branchNameInstructions: "Keep case.",
    });
  });

  it("a failed save is not included in a later clear", async () => {
    const failedResponse = deferredSettings();
    const writes: Array<ReturnType<typeof projectSettingsPatch>> = [];
    const save = createProjectSettingsSaver(
      () => settings,
      async (patch) => {
        writes.push(patch);
        return writes.length === 1
          ? failedResponse.promise
          : applyServerSettingsPatch(settings, patch);
      },
    );
    const failedSave = save((current) =>
      projectSettingsPatch(current, [first], { branchNamingMode: "custom" }),
    );
    const clearSave = save((current) =>
      clearScopedProjectSettings(current, [first], "branchNamePrefix"),
    );
    failedResponse.resolve(null);
    await Promise.all([failedSave, clearSave]);
    expect(writes[1]?.projectSettingsOverrides?.[first]).toEqual({ defaultAutoPull: true });
  });
});
