import { ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { PROVIDER_ICON_BY_PROVIDER } from "../chat/providerIconUtils";
import { DRIVER_OPTIONS, getDriverOption, PROVIDER_CLIENT_DEFINITIONS } from "./providerDriverMeta";

describe("provider client definitions", () => {
  it("offers exactly the three Test Rig executable providers", () => {
    const expected = [
      ["codex", "Codex"],
      ["claudeAgent", "Claude"],
      ["opencode", "OpenCode"],
    ];

    expect(PROVIDER_CLIENT_DEFINITIONS.map(({ value, label }) => [value, label])).toEqual(expected);
    expect(DRIVER_OPTIONS.map(({ value, label }) => [value, label])).toEqual(expected);
  });

  it.each(["cursor", "grok"])(
    "renders excluded %s instances through generic metadata",
    (driver) => {
      const driverKind = ProviderDriverKind.make(driver);

      expect(getDriverOption(driverKind)).toBeUndefined();
      expect(PROVIDER_ICON_BY_PROVIDER[driverKind]).toBeUndefined();
    },
  );
});
