import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";

import { deriveProviderModelsForDisplay, ProviderInstanceCard } from "./ProviderInstanceCard";

describe("deriveProviderModelsForDisplay", () => {
  it("uses current config custom models instead of stale live custom rows", () => {
    const liveModels: ReadonlyArray<ServerProviderModel> = [
      {
        slug: "server-model",
        name: "Server Model",
        isCustom: false,
        capabilities: null,
      },
      {
        slug: "removed-custom",
        name: "Removed Custom",
        isCustom: true,
        capabilities: null,
      },
      {
        slug: "kept-custom",
        name: "Kept Custom",
        isCustom: true,
        capabilities: null,
      },
    ];

    expect(
      deriveProviderModelsForDisplay({
        liveModels,
        customModels: ["kept-custom"],
      }).map((model) => model.slug),
    ).toEqual(["server-model", "kept-custom"]);
  });
});

describe("ProviderInstanceCard", () => {
  it("renders an excluded unavailable instance as readable but not enableable", () => {
    const instanceId = ProviderInstanceId.make("cursor_legacy");
    const driver = ProviderDriverKind.make("cursor");
    const liveProvider: ServerProvider = {
      instanceId,
      driver,
      displayName: "Historical Cursor",
      enabled: false,
      installed: false,
      version: null,
      status: "disabled",
      availability: "unavailable",
      unavailableReason: "Driver is not installed",
      auth: { status: "unknown" },
      checkedAt: "2026-01-01T00:00:00.000Z",
      models: [],
      slashCommands: [],
      skills: [],
    };
    const html = renderToStaticMarkup(
      createElement(ProviderInstanceCard, {
        instanceId,
        instance: {
          driver,
          enabled: true,
          displayName: "Historical Cursor",
          config: { binaryPath: "/legacy/cursor-agent" },
        },
        driverOption: undefined,
        liveProvider,
        isExpanded: true,
        onExpandedChange: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        hiddenModels: [],
        favoriteModels: [],
        modelOrder: [],
        onHiddenModelsChange: vi.fn(),
        onFavoriteModelsChange: vi.fn(),
        onModelOrderChange: vi.fn(),
      }),
    );

    expect(html).toContain("Historical Cursor");
    expect(html).toContain("not shipped with the current build");
    expect(html).toMatch(/aria-label="Enable Historical Cursor"[^>]*disabled/);
  });
});
