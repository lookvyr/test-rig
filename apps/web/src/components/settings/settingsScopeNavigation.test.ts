import { describe, expect, it } from "vite-plus/test";

import { settingsLinkSearch, validateSettingsRouteSearch } from "./settingsScopeNavigation";

const SCOPED = new Set(["/settings/threads", "/settings/worktrees"]);

describe("validateSettingsRouteSearch", () => {
  it("reads an environment link as the environment scope", () => {
    expect(validateSettingsRouteSearch({ environmentId: "laptop" })).toEqual({ machine: "laptop" });
  });

  it("keeps an explicit scope over a legacy environment link", () => {
    expect(validateSettingsRouteSearch({ environmentId: "laptop", project: "repo" })).toEqual({
      project: "repo",
    });
    expect(validateSettingsRouteSearch({ environmentId: "laptop", machine: "server" })).toEqual({
      machine: "server",
    });
  });

  it("drops empty and non-string values", () => {
    expect(validateSettingsRouteSearch({ project: "", machine: 3, checkout: "  " })).toEqual({});
  });
});

describe("settingsLinkSearch", () => {
  const scope = { project: "repo", machine: "laptop", checkout: "laptop:/repo" };

  it("keeps the scope between pages that follow it", () => {
    expect(settingsLinkSearch("/settings/threads", "/settings/worktrees", scope, SCOPED)).toEqual(
      scope,
    );
  });

  it("starts from all projects when either page does not follow the scope", () => {
    expect(settingsLinkSearch("/settings/threads", "/settings/tools", scope, SCOPED)).toEqual({});
    expect(settingsLinkSearch("/settings/tools", "/settings/threads", scope, SCOPED)).toEqual({});
  });
});
