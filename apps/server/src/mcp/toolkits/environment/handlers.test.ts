import { expect, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2ThreadShell,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as FileSystem from "effect/FileSystem";
import * as ServerConfig from "../../../config.ts";
import * as ServerSecretStore from "../../../auth/ServerSecretStore.ts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Environment from "../../../environment/ServerEnvironment.ts";
import * as ThreadCommandExecutor from "../../../orchestration-v2/ThreadCommandExecutor.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as Settings from "../../../serverSettings.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { EnvironmentHandlersLive } from "./handlers.ts";
import { EnvironmentToolkit } from "./tools.ts";

const decodePreferences = Schema.decodeUnknownEffect(
  EnvironmentToolkit.tools.t3_environment_preferences_update.parametersSchema,
);
const settingsJson = Schema.fromJsonString(Schema.Unknown);
const encodeSettingsJson = Schema.encodeSync(settingsJson);
const decodeSettingsJson = Schema.decodeUnknownSync(settingsJson);

it.effect("MCP preferences cannot enable disabled hosting or excluded ancillary routes", () =>
  Effect.gen(function* () {
    const threadId = ThreadId.make("preferences-caller");
    const environmentId = EnvironmentId.make("preferences-environment");
    const providerInstanceId = ProviderInstanceId.make("codex");
    const caller = {
      id: threadId,
      providerInstanceId,
      activeRunId: RunId.make("preferences-run"),
      archivedAt: null,
      deletedAt: null,
      runtimeMode: "full-access",
      interactionMode: "default",
    } as OrchestrationV2ThreadShell;
    const patches: ServerSettingsPatch[] = [];
    const settingsLayer = Settings.ServerSettingsService.layerTest();
    const settings = yield* Settings.ServerSettingsService.pipe(Effect.provide(settingsLayer));
    const dependencies = Layer.mergeAll(
      ThreadCommandExecutor.layer,
      Layer.succeed(McpInvocationContext.McpInvocationContext, {
        environmentId,
        threadId,
        providerInstanceId,
        providerSessionId: "session",
        issuedAt: 0,
        capabilities: new Set(["orchestration" as const]),
      }),
      Layer.mock(ThreadManagement.ThreadManagementService)({
        getThreadShell: () => Effect.succeed(caller),
      }),
      Layer.mock(Environment.ServerEnvironment)({
        getDescriptor: Effect.succeed({
          environmentId,
          label: "Test",
          serverVersion: "test",
          platform: { os: "darwin", arch: "arm64" },
          capabilities: { repositoryIdentity: true },
        }),
      }),
      Layer.succeed(
        Settings.ServerSettingsService,
        Settings.ServerSettingsService.of({
          ...settings,
          updateSettings: (patch) => {
            patches.push(patch);
            return settings.updateSettings(patch);
          },
        }),
      ),
    );
    const raw = {
      newWorktreesStartFromOrigin: false,
      sourceControlProviders: { gitlab: true, "azure-devops": true, bitbucket: true },
      automaticUpdates: true,
      providerEnrichment: true,
      serviceLauncher: { enabled: true },
      telemetry: { enabled: true },
    };
    const parameters = yield* decodePreferences(raw);
    const toolkit = yield* EnvironmentToolkit.pipe(
      Effect.provide(EnvironmentHandlersLive.pipe(Layer.provide(dependencies))),
    );
    yield* toolkit
      .handle("t3_environment_preferences_update", parameters)
      .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(dependencies));
    expect(patches).toEqual([{ newWorktreesStartFromOrigin: false }]);
    const updated = yield* settings.getSettings;
    expect(updated.newWorktreesStartFromOrigin).toBe(false);
    expect(updated.sourceControlProviders).toEqual(DEFAULT_SERVER_SETTINGS.sourceControlProviders);
    for (const field of [
      "automaticUpdates",
      "providerEnrichment",
      "serviceLauncher",
      "telemetry",
    ]) {
      expect(updated).not.toHaveProperty(field);
    }
  }),
);

it.effect("saved obsolete preferences do not restore excluded services or enrichment", () =>
  Effect.gen(function* () {
    const configLayer = ServerConfig.layerTest(process.cwd(), {
      prefix: "mcp-preference-boundary-",
    }).pipe(Layer.provideMerge(NodeServices.layer));
    const settingsLayer = Settings.layer.pipe(
      Layer.provide(ServerSecretStore.layer),
      Layer.provideMerge(configLayer),
    );
    yield* Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const fs = yield* FileSystem.FileSystem;
      yield* fs.writeFileString(
        config.settingsPath,
        encodeSettingsJson({
          automaticUpdates: true,
          providerEnrichment: true,
          serviceLauncher: { enabled: true },
          telemetry: { enabled: true },
        }),
      );
      const service = yield* Settings.ServerSettingsService;
      const loaded = yield* service.getSettings;
      expect(loaded.sourceControlProviders).toEqual(DEFAULT_SERVER_SETTINGS.sourceControlProviders);
      const updated = yield* service.updateSettings({ newWorktreesStartFromOrigin: false });
      const persisted = decodeSettingsJson(yield* fs.readFileString(config.settingsPath));
      for (const field of [
        "automaticUpdates",
        "providerEnrichment",
        "serviceLauncher",
        "telemetry",
      ]) {
        expect(loaded).not.toHaveProperty(field);
        expect(updated).not.toHaveProperty(field);
        expect(persisted).not.toHaveProperty(field);
      }
    }).pipe(Effect.provide(settingsLayer));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
