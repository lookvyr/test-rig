import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { ProviderInstanceId } from "./providerInstance.ts";
import {
  ClientSettingsSchema,
  ClientSettingsPatch,
  DEFAULT_SERVER_SETTINGS,
  ServerSettings,
  ServerSettingsPatch,
} from "./settings.ts";

const decodeClientSettings = Schema.decodeUnknownSync(ClientSettingsSchema);
const decodeClientSettingsPatch = Schema.decodeUnknownSync(ClientSettingsPatch);
const decodeServerSettings = Schema.decodeUnknownSync(ServerSettings);
const decodeServerSettingsPatch = Schema.decodeUnknownSync(ServerSettingsPatch);
const encodeServerSettings = Schema.encodeSync(ServerSettings);

describe("ClientSettings word wrap", () => {
  it("defaults word wrap on", () => {
    expect(decodeClientSettings({}).wordWrap).toBe(true);
  });

  it("ignores obsolete wrapping preferences", () => {
    const decoded = decodeClientSettings({
      chatWordWrap: false,
      diffWordWrap: false,
    });

    expect(decoded.wordWrap).toBe(true);
    expect(decoded).not.toHaveProperty("chatWordWrap");
    expect(decoded).not.toHaveProperty("diffWordWrap");
  });
});

describe("ClientSettings glass opacity", () => {
  it("defaults to a readable translucent surface", () => {
    expect(decodeClientSettings({}).glassOpacity).toBe(80);
  });

  it.each([39, 101, 72.5])("rejects an invalid glass opacity: %s", (value) => {
    expect(() => decodeClientSettings({ glassOpacity: value })).toThrow();
    expect(() => decodeClientSettingsPatch({ glassOpacity: value })).toThrow();
  });

  it.each([40, 75, 100])("accepts a glass opacity within the supported range: %s", (value) => {
    expect(decodeClientSettings({ glassOpacity: value }).glassOpacity).toBe(value);
    expect(decodeClientSettingsPatch({ glassOpacity: value }).glassOpacity).toBe(value);
  });
});

describe("ClientSettings environment identification", () => {
  it("defaults to artwork and accepts each presentation mode", () => {
    expect(decodeClientSettings({}).environmentIdentificationMode).toBe("artwork");

    for (const mode of ["artwork", "pill", "none"] as const) {
      expect(
        decodeClientSettingsPatch({ environmentIdentificationMode: mode })
          .environmentIdentificationMode,
      ).toBe(mode);
    }
  });

  it("rejects unsupported presentation modes", () => {
    expect(() => decodeClientSettings({ environmentIdentificationMode: "badge" })).toThrow();
    expect(() => decodeClientSettingsPatch({ environmentIdentificationMode: "badge" })).toThrow();
  });
});

describe("ClientSettings sidebar v2", () => {
  it("defaults the beta off with a three-day auto-settle threshold", () => {
    const settings = decodeClientSettings({});
    expect(settings.sidebarV2Enabled).toBe(false);
    expect(settings.sidebarAutoSettleAfterDays).toBe(3);
  });

  it("treats settings written before the beta had a per-channel default as unconfigured", () => {
    // The stored blob always carries `sidebarV2Enabled`, so only the companion
    // flag can distinguish "user opted out" from "never touched it".
    expect(decodeClientSettings({ sidebarV2Enabled: false }).sidebarV2ConfiguredByUser).toBe(false);
    expect(decodeClientSettings({ sidebarV2Enabled: true }).sidebarV2ConfiguredByUser).toBe(false);
  });

  it("preserves an explicit beta choice", () => {
    const settings = decodeClientSettings({
      sidebarV2Enabled: false,
      sidebarV2ConfiguredByUser: true,
    });
    expect(settings.sidebarV2Enabled).toBe(false);
    expect(settings.sidebarV2ConfiguredByUser).toBe(true);
  });

  it("carries an explicit beta opt-out through the patch the beta toggle writes", () => {
    const patch = decodeClientSettingsPatch({
      sidebarV2Enabled: false,
      sidebarV2ConfiguredByUser: true,
    });
    expect(patch.sidebarV2Enabled).toBe(false);
    expect(patch.sidebarV2ConfiguredByUser).toBe(true);
  });

  it("allows auto-settle by inactivity to be disabled", () => {
    expect(
      decodeClientSettings({ sidebarAutoSettleAfterDays: null }).sidebarAutoSettleAfterDays,
    ).toBeNull();
  });

  it.each([-1, 0, 91])("rejects an auto-settle threshold outside 1..90: %s", (value) => {
    expect(() => decodeClientSettings({ sidebarAutoSettleAfterDays: value })).toThrow();
    expect(() => decodeClientSettingsPatch({ sidebarAutoSettleAfterDays: value })).toThrow();
  });
});

describe("ServerSettings.providerInstances (slice-2 invariant)", () => {
  it("defaults text generation to Luna at low reasoning effort", () => {
    expect(DEFAULT_SERVER_SETTINGS.textGenerationModelSelection).toEqual({
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.6-luna",
      options: [{ id: "reasoningEffort", value: "low" }],
    });
  });

  it("defaults to an empty record so legacy configs without the key still decode", () => {
    expect(DEFAULT_SERVER_SETTINGS.providerInstances).toEqual({});
  });

  it("decodes a fully empty config (legacy on-disk shape) without complaint", () => {
    const decoded = decodeServerSettings({});
    expect(decoded.providerInstances).toEqual({});
    // Legacy `providers` struct is still hydrated with its per-driver defaults
    // so existing call sites keep working through the migration.
    expect(decoded.providers.codex.enabled).toBe(true);
  });

  it("round-trips excluded legacy provider settings losslessly", () => {
    const decoded = decodeServerSettings({
      providers: {
        cursor: {
          enabled: true,
          binaryPath: "/legacy/cursor-agent",
          apiEndpoint: "https://legacy.invalid/cursor",
          customModels: ["cursor-legacy-model"],
        },
        grok: {
          enabled: true,
          binaryPath: "/legacy/grok",
          customModels: ["grok-legacy-model"],
        },
      },
    });
    const encoded = encodeServerSettings(decoded);

    expect(encoded.providers?.cursor).toEqual({
      enabled: true,
      binaryPath: "/legacy/cursor-agent",
      apiEndpoint: "https://legacy.invalid/cursor",
      customModels: ["cursor-legacy-model"],
    });
    expect(encoded.providers?.grok).toEqual({
      enabled: true,
      binaryPath: "/legacy/grok",
      customModels: ["grok-legacy-model"],
    });
  });

  it("strips excluded provider patch keys while retaining approved provider patches", () => {
    const patch = decodeServerSettingsPatch({
      providers: {
        codex: { enabled: false },
        claudeAgent: { binaryPath: "/approved/claude" },
        cursor: { enabled: true, binaryPath: "/excluded/cursor-agent" },
        grok: { enabled: true, binaryPath: "/excluded/grok" },
        opencode: { binaryPath: "/approved/opencode" },
      },
    });

    expect(patch.providers).toEqual({
      codex: { enabled: false },
      claudeAgent: { binaryPath: "/approved/claude" },
      opencode: { binaryPath: "/approved/opencode" },
    });
    expect(patch.providers).not.toHaveProperty("cursor");
    expect(patch.providers).not.toHaveProperty("grok");
  });

  it("decodes a multi-instance map mixing first-party and fork drivers", () => {
    const decoded = decodeServerSettings({
      providerInstances: {
        codex_personal: {
          driver: "codex",
          displayName: "Codex (personal)",
          config: { homePath: "~/.codex_personal" },
        },
        codex_work: {
          driver: "codex",
          config: { homePath: "~/.codex_work" },
        },
        ollama_local: {
          driver: "ollama",
          displayName: "Ollama (local)",
          config: { endpoint: "http://localhost:11434" },
        },
      },
    });
    const personalId = ProviderInstanceId.make("codex_personal");
    const workId = ProviderInstanceId.make("codex_work");
    const ollamaId = ProviderInstanceId.make("ollama_local");

    expect(decoded.providerInstances[personalId]?.driver).toBe("codex");
    expect(decoded.providerInstances[workId]?.config).toEqual({ homePath: "~/.codex_work" });
    // Critical: a config naming a driver this build does not know about
    // (`ollama` is not in `ProviderDriverKind`) must round-trip without loss.
    // The runtime handles "driver not installed" — the schema must not.
    expect(decoded.providerInstances[ollamaId]?.driver).toBe("ollama");
    expect(decoded.providerInstances[ollamaId]?.config).toEqual({
      endpoint: "http://localhost:11434",
    });
  });

  it("rejects instance keys that violate the slug pattern", () => {
    expect(() =>
      decodeServerSettings({
        providerInstances: { "1bad": { driver: "codex" } },
      }),
    ).toThrow();
  });
});

describe("ServerSettings worktree defaults", () => {
  it("defaults legacy configs to Test Rig worktree naming", () => {
    const settings = decodeServerSettings({});

    expect(settings.newWorktreesStartFromOrigin).toBe(true);
    expect(settings.newWorktreeBranchPrefix).toBe("test-rig");
  });

  it("accepts worktree default updates", () => {
    const patch = decodeServerSettingsPatch({
      newWorktreesStartFromOrigin: false,
      newWorktreeBranchPrefix: "example/team",
    });

    expect(patch.newWorktreesStartFromOrigin).toBe(false);
    expect(patch.newWorktreeBranchPrefix).toBe("example/team");
  });

  it("trims valid prefixes and accepts the length boundary", () => {
    expect(
      decodeServerSettingsPatch({ newWorktreeBranchPrefix: "  example/team  " })
        .newWorktreeBranchPrefix,
    ).toBe("example/team");
    expect(
      decodeServerSettingsPatch({ newWorktreeBranchPrefix: "a".repeat(64) })
        .newWorktreeBranchPrefix,
    ).toBe("a".repeat(64));
  });

  it.each(["", "UPPERCASE", "has spaces", "/leading", "trailing/", "double//slash", "dot.name"])(
    "rejects invalid worktree branch prefix %j",
    (newWorktreeBranchPrefix) => {
      expect(() => decodeServerSettingsPatch({ newWorktreeBranchPrefix })).toThrow();
    },
  );

  it("rejects worktree branch prefixes longer than 64 characters", () => {
    expect(() => decodeServerSettingsPatch({ newWorktreeBranchPrefix: "a".repeat(65) })).toThrow();
  });
});

describe("ServerSettings.sourceControlWritingStyle", () => {
  it("defaults all style settings for legacy configs", () => {
    const settings = decodeServerSettings({});

    expect(settings.sourceControlWritingStyle).toEqual({
      mode: "repo_conventions",
      commitInstructions: "",
      changeRequestTitleInstructions: "",
      changeRequestDescriptionInstructions: "",
      followChangeRequestTemplates: true,
    });
    expect(settings.sourceControlWriterModelSelection).toBeNull();
  });

  it("trims partial style updates", () => {
    const patch = decodeServerSettingsPatch({
      sourceControlWritingStyle: {
        mode: "custom",
        commitInstructions: "  Prefer concise commits.  ",
        changeRequestTitleInstructions: "  Prefer concise titles.  ",
        changeRequestDescriptionInstructions: "  Prefer concise descriptions.  ",
      },
    });

    expect(patch.sourceControlWritingStyle).toEqual({
      mode: "custom",
      commitInstructions: "Prefer concise commits.",
      changeRequestTitleInstructions: "Prefer concise titles.",
      changeRequestDescriptionInstructions: "Prefer concise descriptions.",
    });
  });

  it("drops the obsolete shared instruction without migrating it", () => {
    const settings = decodeServerSettings({
      sourceControlWritingStyle: {
        mode: "custom",
        customInstructions: "Legacy shared instruction.",
      },
    });

    expect(settings.sourceControlWritingStyle).toEqual({
      mode: "custom",
      commitInstructions: "",
      changeRequestTitleInstructions: "",
      changeRequestDescriptionInstructions: "",
      followChangeRequestTemplates: true,
    });
  });
});

describe("ServerSettings.sourceControlProviders", () => {
  it("enables only GitHub for legacy settings", () => {
    expect(decodeServerSettings({}).sourceControlProviders).toEqual({
      github: true,
      gitlab: false,
      "azure-devops": false,
      bitbucket: false,
    });
  });

  it("fills provider defaults around a partial stored setting", () => {
    expect(
      decodeServerSettings({
        sourceControlProviders: { github: false },
      }).sourceControlProviders,
    ).toEqual({
      github: false,
      gitlab: false,
      "azure-devops": false,
      bitbucket: false,
    });
  });

  it("accepts partial provider enablement patches", () => {
    expect(
      decodeServerSettingsPatch({
        sourceControlProviders: {
          gitlab: true,
          bitbucket: true,
        },
      }).sourceControlProviders,
    ).toEqual({
      gitlab: true,
      bitbucket: true,
    });
  });
});

describe("ServerSettingsPatch.providerInstances", () => {
  it("treats providerInstances as an optional whole-map replacement", () => {
    const patch = decodeServerSettingsPatch({});
    expect(patch.providerInstances).toBeUndefined();

    const replacement = decodeServerSettingsPatch({
      providerInstances: {
        codex_personal: { driver: "codex", config: { homePath: "~/.codex" } },
      },
    });
    expect(replacement.providerInstances).toBeDefined();
    expect(replacement.providerInstances?.[ProviderInstanceId.make("codex_personal")]?.driver).toBe(
      "codex",
    );
  });

  it("preserves a fork-defined driver entry through patch decoding", () => {
    const patch = decodeServerSettingsPatch({
      providerInstances: {
        ollama_local: {
          driver: "ollama",
          config: { endpoint: "http://localhost:11434" },
        },
      },
    });
    const ollamaId = ProviderInstanceId.make("ollama_local");
    expect(patch.providerInstances?.[ollamaId]?.driver).toBe("ollama");
  });
});

describe("ServerSettingsPatch string normalization", () => {
  it("trims string settings while decoding patches", () => {
    const patch = decodeServerSettingsPatch({
      addProjectBaseDirectory: "  ~/Development  ",
      textGenerationModelSelection: { model: "  gpt-5.4-mini  " },
      observability: {
        otlpTracesUrl: "  http://localhost:4318/v1/traces  ",
      },
      providers: {
        codex: {
          binaryPath: "  /opt/homebrew/bin/codex  ",
          homePath: "  ~/.codex  ",
          launchArgs: "  --strict-config --enable foo  ",
        },
      },
      providerInstances: {
        codex_personal: {
          driver: "  codex  ",
          displayName: "  Codex Personal  ",
          config: { homePath: "  ~/.codex-personal  " },
        },
      },
    });

    expect(patch.addProjectBaseDirectory).toBe("~/Development");
    expect(patch.textGenerationModelSelection?.model).toBe("gpt-5.4-mini");
    expect(patch.observability?.otlpTracesUrl).toBe("http://localhost:4318/v1/traces");
    expect(patch.providers?.codex?.binaryPath).toBe("/opt/homebrew/bin/codex");
    expect(patch.providers?.codex?.homePath).toBe("~/.codex");
    expect(patch.providers?.codex?.launchArgs).toBe("--strict-config --enable foo");
    expect(patch.providerInstances?.[ProviderInstanceId.make("codex_personal")]?.driver).toBe(
      "codex",
    );
    expect(patch.providerInstances?.[ProviderInstanceId.make("codex_personal")]?.displayName).toBe(
      "Codex Personal",
    );
    expect(patch.providerInstances?.[ProviderInstanceId.make("codex_personal")]?.config).toEqual({
      homePath: "  ~/.codex-personal  ",
    });
  });

  it("trims encoded server settings values before validation", () => {
    const defaultSettings = decodeServerSettings({});
    const encoded = encodeServerSettings({
      ...defaultSettings,
      addProjectBaseDirectory: "  ~/Development  ",
      providers: {
        ...defaultSettings.providers,
        codex: {
          ...defaultSettings.providers.codex,
          binaryPath: "  /opt/homebrew/bin/codex  ",
          launchArgs: "  --strict-config  ",
        },
      },
    });

    expect(encoded.addProjectBaseDirectory).toBe("~/Development");
    expect(encoded.providers?.codex?.binaryPath).toBe("/opt/homebrew/bin/codex");
    expect(encoded.providers?.codex?.launchArgs).toBe("--strict-config");
  });
});
