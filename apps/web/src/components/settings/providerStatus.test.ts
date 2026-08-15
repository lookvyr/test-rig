import { describe, expect, it } from "vite-plus/test";

import { getProviderVersionAdvisoryPresentation } from "./providerStatus";

describe("getProviderVersionAdvisoryPresentation", () => {
  it("keeps explicit provider updates available without a latest-version lookup", () => {
    expect(
      getProviderVersionAdvisoryPresentation({
        status: "unknown",
        currentVersion: "1.0.0",
        latestVersion: null,
        updateCommand: "npm install -g example@latest",
        canUpdate: true,
        checkedAt: "2026-08-15T00:00:00.000Z",
        message: null,
      }),
    ).toEqual({
      title: "Update provider",
      detail: "Check for and install the latest provider version when you choose.",
      updateCommand: "npm install -g example@latest",
      emphasis: "normal",
    });
  });

  it("does not advertise an update action when no command is available", () => {
    expect(
      getProviderVersionAdvisoryPresentation({
        status: "unknown",
        currentVersion: "1.0.0",
        latestVersion: null,
        updateCommand: null,
        canUpdate: false,
        checkedAt: "2026-08-15T00:00:00.000Z",
        message: null,
      }),
    ).toBeNull();
  });
});
