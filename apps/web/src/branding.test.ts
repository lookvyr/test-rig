import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  resolveServerBackedAppDisplayName,
  resolveServerBackedAppStageLabel,
  resolveSidebarV2Enabled,
} from "./branding.logic";

const originalWindow = globalThis.window;

afterEach(() => {
  vi.resetModules();

  if (originalWindow === undefined) {
    Reflect.deleteProperty(globalThis, "window");
    return;
  }

  globalThis.window = originalWindow;
});

describe("branding", () => {
  it("uses injected desktop branding when available", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        desktopBridge: {
          getAppBranding: () => ({
            baseName: "Test Rig",
            stageLabel: "Nightly",
            displayName: "Test Rig (Nightly)",
          }),
        },
      },
    });

    const branding = await import("./branding");

    expect(branding.APP_BASE_NAME).toBe("Test Rig");
    expect(branding.APP_STAGE_LABEL).toBe("Nightly");
    expect(branding.APP_DISPLAY_NAME).toBe("Test Rig (Nightly)");
  });
});

describe("branding logic", () => {
  it("returns Nightly for nightly primary server versions", () => {
    expect(
      resolveServerBackedAppStageLabel({
        primaryServerVersion: "0.0.28-nightly.20260616.12",
        fallbackStageLabel: "Alpha",
      }),
    ).toBe("Nightly");
  });

  it("updates the display name for nightly primary server versions", () => {
    expect(
      resolveServerBackedAppDisplayName({
        baseName: "Test Rig",
        fallbackDisplayName: "Test Rig (Alpha)",
        fallbackStageLabel: "Alpha",
        primaryServerVersion: "0.0.28-nightly.20260616.12",
      }),
    ).toBe("Test Rig (Nightly)");
  });

  it("keeps the fallback display name for stable primary server versions", () => {
    expect(
      resolveServerBackedAppDisplayName({
        baseName: "Test Rig",
        fallbackDisplayName: "Test Rig (Alpha)",
        fallbackStageLabel: "Alpha",
        primaryServerVersion: "0.0.27",
      }),
    ).toBe("Test Rig (Alpha)");
  });

  it("keeps the fallback display name for malformed nightly primary server versions", () => {
    expect(
      resolveServerBackedAppDisplayName({
        baseName: "Test Rig",
        fallbackDisplayName: "Test Rig (Alpha)",
        fallbackStageLabel: "Alpha",
        primaryServerVersion: "0.0.28-nightly.20260616",
      }),
    ).toBe("Test Rig (Alpha)");
  });
});

describe("resolveSidebarV2Enabled", () => {
  it.each([false, true])("enables V2 for unconfigured settings with stored value %s", (enabled) => {
    expect(
      resolveSidebarV2Enabled({
        enabled,
        configuredByUser: false,
        settingsHydrated: true,
      }),
    ).toBe(true);
  });

  it.each([false, true])("preserves the explicit choice %s", (enabled) => {
    expect(
      resolveSidebarV2Enabled({
        enabled,
        configuredByUser: true,
        settingsHydrated: true,
      }),
    ).toBe(enabled);
  });

  it("holds v1 until settings hydrate", () => {
    expect(
      resolveSidebarV2Enabled({
        enabled: true,
        configuredByUser: true,
        settingsHydrated: false,
      }),
    ).toBe(false);
  });
});
