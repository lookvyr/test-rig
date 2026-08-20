import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerSettings,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { BUILT_IN_DRIVERS } from "../builtInDrivers.ts";
import { deriveProviderInstanceConfigMap } from "./ProviderInstanceRegistryHydration.ts";

describe("ProviderInstanceRegistryHydration", () => {
  it("hydrates exactly the three approved built-in drivers from legacy settings", () => {
    expect(BUILT_IN_DRIVERS.map((driver) => driver.driverKind)).toEqual([
      ProviderDriverKind.make("codex"),
      ProviderDriverKind.make("claudeAgent"),
      ProviderDriverKind.make("opencode"),
    ]);

    const configMap = deriveProviderInstanceConfigMap(DEFAULT_SERVER_SETTINGS);
    expect(Object.keys(configMap)).toEqual(["codex", "claudeAgent", "opencode"]);
    expect(configMap).not.toHaveProperty("cursor");
    expect(configMap).not.toHaveProperty("grok");
  });

  it("preserves explicit excluded-provider rows without synthesizing legacy instances", () => {
    const cursorId = ProviderInstanceId.make("cursor_legacy");
    const grokId = ProviderInstanceId.make("grok_legacy");
    const settings: ServerSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      providers: {
        ...DEFAULT_SERVER_SETTINGS.providers,
        cursor: {
          ...DEFAULT_SERVER_SETTINGS.providers.cursor,
          enabled: true,
          binaryPath: "/legacy/must-not-spawn/cursor-agent",
        },
        grok: {
          ...DEFAULT_SERVER_SETTINGS.providers.grok,
          enabled: true,
          binaryPath: "/legacy/must-not-spawn/grok",
        },
      },
      providerInstances: {
        [cursorId]: {
          driver: ProviderDriverKind.make("cursor"),
          enabled: true,
          config: { sentinel: "cursor-config-survives" },
        },
        [grokId]: {
          driver: ProviderDriverKind.make("grok"),
          enabled: true,
          config: { sentinel: "grok-config-survives" },
        },
      },
    };

    const configMap = deriveProviderInstanceConfigMap(settings);
    expect(Object.keys(configMap)).toEqual([
      "cursor_legacy",
      "grok_legacy",
      "codex",
      "claudeAgent",
      "opencode",
    ]);
    expect(configMap[cursorId]?.config).toEqual({ sentinel: "cursor-config-survives" });
    expect(configMap[grokId]?.config).toEqual({ sentinel: "grok-config-survives" });
    expect(configMap).not.toHaveProperty("cursor");
    expect(configMap).not.toHaveProperty("grok");
  });
});
