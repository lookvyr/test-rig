import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ServerSettings,
  ServerSettingsPatch,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as TestClock from "effect/testing/TestClock";
import * as Effect from "effect/Effect";
import * as Duration from "effect/Duration";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ServerSecretStore from "./auth/ServerSecretStore.ts";
import * as ServerConfig from "./config.ts";
import * as ServerSettingsModule from "./serverSettings.ts";
import {
  McpServerConfig,
  McpServerProjectOverride,
} from "../../../packages/contracts/src/mcpServers.ts";

import { ToolsScopeId } from "../../../packages/contracts/src/toolsScope.ts";

const encodeLegacySettings = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeSettingsPatch = Schema.decodeUnknownEffect(ServerSettingsPatch);
const decodeSavedServerSettings = Schema.decodeUnknownEffect(Schema.fromJsonString(ServerSettings));
const decodeServerSettings = Schema.decodeUnknownEffect(ServerSettings);
const decodeMcpServerConfig = Schema.decodeEffect(McpServerConfig);
const decodeMcpProjectOverride = Schema.decodeEffect(McpServerProjectOverride);

it.layer(NodeServices.layer)("MCP secret persistence", (it) => {
  it.effect("returns committed settings when obsolete MCP secret cleanup fails", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      let failSecretRemoval = false;
      let secretDirectory = "";
      const failingFileSystem = {
        ...fs,
        remove: (...args: Parameters<typeof fs.remove>) =>
          failSecretRemoval && args[0].startsWith(`${secretDirectory}/mcp-`)
            ? Effect.fail(
                PlatformError.systemError({
                  _tag: "PermissionDenied",
                  module: "FileSystem",
                  method: "remove",
                  pathOrDescriptor: args[0],
                  description: "Injected secret cleanup failure.",
                }),
              )
            : fs.remove(...args),
      };
      yield* Effect.gen(function* () {
        const config = yield* ServerConfig.ServerConfig;
        secretDirectory = config.secretsDir;
        const service = yield* ServerSettingsModule.ServerSettingsService;
        yield* service.updateSettings({
          mcpServers: {
            docs: yield* decodeMcpServerConfig({
              transport: {
                type: "http",
                url: "https://example.test",
                headers: [{ name: "X-Credential", value: "working-secret" }],
              },
            }),
          },
        });
        failSecretRemoval = true;
        const removed = yield* service.updateSettings({ mcpServers: { docs: null } });
        assert.isUndefined(removed.mcpServers.docs);
        assert.isUndefined((yield* service.getSettings).mcpServers.docs);
        const persisted = yield* decodeSavedServerSettings(
          yield* fs.readFileString(config.settingsPath),
        );
        assert.isUndefined(persisted.mcpServers.docs);
        assert.lengthOf(
          (yield* fs.readDirectory(config.secretsDir)).filter((name) => name.startsWith("mcp-")),
          1,
        );
        failSecretRemoval = false;
      }).pipe(
        Effect.provide(
          makeServerSettingsLayer().pipe(
            Layer.provide(Layer.succeed(FileSystem.FileSystem, failingFileSystem)),
          ),
        ),
      );
    }),
  );
  it.effect("keeps a working scope credential when settings rename or deletion fails", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      let failSettingsWrite = false;
      let settingsPath = "";
      const failingFileSystem = {
        ...fs,
        rename: (source: string, destination: string) =>
          failSettingsWrite && destination === settingsPath
            ? Effect.fail(
                PlatformError.systemError({
                  _tag: "PermissionDenied",
                  module: "FileSystem",
                  method: "rename",
                  pathOrDescriptor: destination,
                  description: "Injected settings write failure.",
                }),
              )
            : fs.rename(source, destination),
      };
      yield* Effect.gen(function* () {
        const config = yield* ServerConfig.ServerConfig;
        settingsPath = config.settingsPath;
        const service = yield* ServerSettingsModule.ServerSettingsService;
        const scope = ToolsScopeId.make("project:failed-save");
        yield* service.updateSettings({
          toolsScopeMcpServers: {
            [scope]: {
              old: yield* decodeMcpProjectOverride({
                transport: {
                  type: "http",
                  url: "https://example.test",
                  headers: [{ name: "X-Credential", value: "working-secret" }],
                },
              }),
            },
          },
        });
        const originalDisk = yield* fs.readFileString(settingsPath);
        const originalSecretFiles = (yield* fs.readDirectory(config.secretsDir)).filter((name) =>
          name.startsWith("mcp-"),
        );
        const renamePatch = {
          toolsScopeMcpServers: {
            [scope]: {
              renamed: yield* decodeMcpProjectOverride({
                transport: {
                  type: "http",
                  url: "https://example.test",
                  headers: [
                    {
                      name: "X-New-Credential",
                      value: "",
                      valueRedacted: true,
                      storedAs: { server: "old", variable: "X-Credential" },
                    },
                  ],
                },
              }),
            },
          },
        };
        failSettingsWrite = true;
        const failure = yield* service.updateSettings(renamePatch).pipe(Effect.flip);
        assert.equal(failure.operation, "write-file");
        assert.equal(yield* fs.readFileString(settingsPath), originalDisk);
        assert.isTrue(
          encodeLegacySettings(
            (yield* service.getSettings).toolsScopeMcpServers[scope]?.old,
          ).includes("working-secret"),
        );
        assert.deepEqual(
          (yield* fs.readDirectory(config.secretsDir)).filter((name) => name.startsWith("mcp-")),
          originalSecretFiles,
        );
        yield* service
          .updateSettings({ toolsScopeMcpServers: { [scope]: null } })
          .pipe(Effect.flip);
        assert.equal(yield* fs.readFileString(settingsPath), originalDisk);
        assert.isTrue(
          encodeLegacySettings(
            (yield* service.getSettings).toolsScopeMcpServers[scope]?.old,
          ).includes("working-secret"),
        );
        failSettingsWrite = false;
        const saved = yield* service.updateSettings(renamePatch);
        assert.isUndefined(saved.toolsScopeMcpServers[scope]?.old);
        assert.isTrue(
          encodeLegacySettings(saved.toolsScopeMcpServers[scope]?.renamed).includes(
            "working-secret",
          ),
        );
        assert.lengthOf(
          (yield* fs.readDirectory(config.secretsDir)).filter((name) => name.startsWith("mcp-")),
          1,
        );
      }).pipe(
        Effect.provide(
          makeServerSettingsLayer().pipe(
            Layer.provide(Layer.succeed(FileSystem.FileSystem, failingFileSystem)),
          ),
        ),
      );
    }),
  );
  it.effect(
    "persists and reloads Tools-scope secrets independently, and cleans only a renamed or removed scope",
    () =>
      Effect.gen(function* () {
        const service = yield* ServerSettingsModule.ServerSettingsService;
        const fs = yield* FileSystem.FileSystem;
        const config = yield* ServerConfig.ServerConfig;
        const scope = ToolsScopeId.make("git:" + "a".repeat(64));
        const other = ToolsScopeId.make("project:other");
        const physical = ProjectId.make("physical-worktree");
        const header = (value: string) =>
          decodeMcpProjectOverride({
            transport: {
              type: "http",
              url: "https://scope.test",
              headers: [{ name: "X-Credential", value }],
            },
          });
        yield* service.updateSettings({
          mcpServers: {
            docs: yield* decodeMcpServerConfig({
              transport: {
                type: "http",
                url: "https://global.test",
                headers: [{ name: "X-Credential", value: "global-secret" }],
              },
            }),
          },
          projectSettingsOverrides: {
            [physical]: { mcpServers: { docs: yield* header("physical-secret") } },
          },
          toolsScopeMcpServers: {
            [scope]: { docs: yield* header("scope-secret") },
            [other]: {
              docs: yield* decodeMcpProjectOverride({
                transport: {
                  type: "stdio",
                  command: "node",
                  env: [{ name: "DATABASE_URL", value: "other-scope-secret" }],
                },
              }),
            },
          },
        });
        const loaded = yield* service.getSettings;
        const client = ServerSettingsModule.redactServerSettingsForClient(loaded);
        const disk = yield* fs.readFileString(config.settingsPath);
        for (const secret of [
          "global-secret",
          "physical-secret",
          "scope-secret",
          "other-scope-secret",
        ]) {
          assert.isFalse(disk.includes(secret));
          assert.isFalse(encodeLegacySettings(client).includes(secret));
          assert.isTrue(encodeLegacySettings(loaded).includes(secret));
        }
        yield* service.updateSettings({ toolsScopeMcpServers: client.toolsScopeMcpServers });
        const restarted = yield* Effect.gen(function* () {
          const fresh = yield* ServerSettingsModule.ServerSettingsService;
          return yield* fresh.getSettings;
        }).pipe(
          Effect.provide(ServerSettingsModule.layer.pipe(Layer.provide(ServerSecretStore.layer))),
        );
        assert.isTrue(
          encodeLegacySettings(restarted.toolsScopeMcpServers).includes("scope-secret"),
        );
        const renamed = yield* service.updateSettings({
          toolsScopeMcpServers: {
            [scope]: {
              renamed: yield* decodeMcpProjectOverride({
                transport: {
                  type: "http",
                  url: "https://scope.test",
                  headers: [
                    {
                      name: "X-New-Credential",
                      value: "",
                      valueRedacted: true,
                      storedAs: { server: "docs", variable: "X-Credential" },
                    },
                  ],
                },
              }),
            },
          },
        });
        assert.isUndefined(renamed.toolsScopeMcpServers[scope]?.docs);
        assert.isTrue(
          encodeLegacySettings(renamed.toolsScopeMcpServers[scope]).includes("scope-secret"),
        );
        assert.lengthOf(
          (yield* fs.readDirectory(config.secretsDir)).filter((name) => name.startsWith("mcp-")),
          4,
        );
        const removed = yield* service.updateSettings({ toolsScopeMcpServers: { [scope]: null } });
        assert.isUndefined(removed.toolsScopeMcpServers[scope]);
        assert.isTrue(
          encodeLegacySettings(removed.toolsScopeMcpServers[other]).includes("other-scope-secret"),
        );
        assert.isTrue(encodeLegacySettings(removed.mcpServers).includes("global-secret"));
        assert.isTrue(
          encodeLegacySettings(removed.projectSettingsOverrides).includes("physical-secret"),
        );
        assert.lengthOf(
          (yield* fs.readDirectory(config.secretsDir)).filter((name) => name.startsWith("mcp-")),
          3,
        );
      }).pipe(Effect.provide(makeServerSettingsLayer())),
  );
  it.effect("preserves both stored secrets when variable names are swapped", () =>
    Effect.gen(function* () {
      const service = yield* ServerSettingsModule.ServerSettingsService;
      yield* service.updateSettings({
        mcpServers: {
          docs: yield* decodeMcpServerConfig({
            transport: {
              type: "stdio",
              command: "node",
              env: [
                { name: "LEFT", value: "left-secret" },
                { name: "RIGHT", value: "right-secret" },
              ],
            },
          }),
        },
      });
      const swapped = yield* service.updateSettings({
        mcpServers: {
          docs: yield* decodeMcpServerConfig({
            transport: {
              type: "stdio",
              command: "node",
              env: [
                {
                  name: "LEFT",
                  value: "",
                  valueRedacted: true,
                  storedAs: { server: "docs", variable: "RIGHT" },
                },
                {
                  name: "RIGHT",
                  value: "",
                  valueRedacted: true,
                  storedAs: { server: "docs", variable: "LEFT" },
                },
              ],
            },
          }),
        },
      });
      const transport = swapped.mcpServers.docs?.transport;
      assert.deepEqual(
        transport?.type === "stdio" ? transport.env.map((variable) => variable.value) : [],
        ["right-secret", "left-secret"],
      );
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );
  it.effect(
    "keeps global and project secrets out of settings and client values, including a reload",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const config = yield* ServerConfig.ServerConfig;
        const service = yield* ServerSettingsModule.ServerSettingsService;
        const server = yield* decodeMcpServerConfig({
          transport: {
            type: "stdio",
            command: "node",
            env: [
              { name: "TOKEN", value: "global-secret" },
              { name: "PLAIN", value: "public-value", sensitive: false },
            ],
          },
        });
        const project = yield* decodeMcpProjectOverride({
          transport: {
            type: "http",
            url: "https://example.test/mcp",
            headers: [{ name: "Authorization", value: "project-secret" }],
          },
        });
        const settings = yield* service.updateSettings({
          mcpServers: { docs: server },
          projectSettingsOverrides: {
            [ProjectId.make("workspace-a")]: { mcpServers: { docs: project } },
          },
        });
        const disk = yield* fs.readFileString(config.settingsPath);
        assert.isFalse(disk.includes("global-secret"));
        assert.isFalse(disk.includes("project-secret"));
        assert.isTrue(disk.includes("public-value"));
        const client = ServerSettingsModule.redactServerSettingsForClient(settings);
        assert.isFalse(encodeLegacySettings(client).includes("global-secret"));
        assert.isFalse(encodeLegacySettings(client).includes("project-secret"));
        yield* service.updateSettings({
          mcpServers: client.mcpServers,
          projectSettingsOverrides: client.projectSettingsOverrides,
        });
        const loaded = yield* service.getSettings;
        assert.isTrue(encodeLegacySettings(loaded).includes("global-secret"));
        assert.isTrue(encodeLegacySettings(loaded).includes("project-secret"));
        const restarted = yield* Effect.gen(function* () {
          const fresh = yield* ServerSettingsModule.ServerSettingsService;
          return yield* fresh.getSettings;
        }).pipe(
          Effect.provide(ServerSettingsModule.layer.pipe(Layer.provide(ServerSecretStore.layer))),
        );
        assert.isTrue(encodeLegacySettings(restarted).includes("global-secret"));
        assert.isTrue(encodeLegacySettings(restarted).includes("project-secret"));
      }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("preserves a secret during rename and removes it when the server is deleted", () =>
    Effect.gen(function* () {
      const service = yield* ServerSettingsModule.ServerSettingsService;
      const fs = yield* FileSystem.FileSystem;
      const config = yield* ServerConfig.ServerConfig;
      yield* service.updateSettings({
        mcpServers: {
          docs: yield* decodeMcpServerConfig({
            transport: {
              type: "http",
              url: "https://example.test/mcp",
              headers: [{ name: "Authorization", value: "rename-secret" }],
            },
          }),
        },
      });
      const renamed = yield* service.updateSettings({
        mcpServers: {
          docs: null,
          renamed: yield* decodeMcpServerConfig({
            transport: {
              type: "http",
              url: "https://example.test/mcp",
              headers: [
                {
                  name: "X-Token",
                  value: "",
                  valueRedacted: true,
                  storedAs: { server: "docs", variable: "Authorization" },
                },
              ],
            },
          }),
        },
      });
      assert.isTrue(encodeLegacySettings(renamed.mcpServers.renamed).includes("rename-secret"));
      assert.equal(
        (yield* fs.readDirectory(config.secretsDir)).filter((name) => name.startsWith("mcp-"))
          .length,
        1,
      );
      yield* service.updateSettings({ mcpServers: { renamed: null } });
      assert.equal(
        (yield* fs.readDirectory(config.secretsDir)).filter((name) => name.startsWith("mcp-"))
          .length,
        0,
      );
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );
});

const makeServerSettingsLayer = () =>
  ServerSettingsModule.layer.pipe(
    Layer.provide(ServerSecretStore.layer),
    Layer.provideMerge(
      Layer.fresh(
        ServerConfig.layerTest(process.cwd(), {
          prefix: "t3code-server-settings-test-",
        }),
      ),
    ),
  );

const makeFailingSecretStoreLayer = (cause: ServerSecretStore.SecretStoreError) =>
  Layer.succeed(
    ServerSecretStore.ServerSecretStore,
    ServerSecretStore.ServerSecretStore.of({
      get: () => Effect.fail(cause),
      set: () => Effect.void,
      create: () => Effect.void,
      getOrCreateRandom: () => Effect.succeed(new Uint8Array()),
      remove: () => Effect.void,
    }),
  );

it.layer(NodeServices.layer)("server settings", (it) => {
  it.effect("ignores the obsolete prefix instead of migrating it", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const config = yield* ServerConfig.ServerConfig;
      yield* fs.writeFileString(config.settingsPath, '{"newWorktreeBranchPrefix":"old-team"}');
      const service = yield* ServerSettingsModule.ServerSettingsService;
      const settings = yield* service.getSettings;
      assert.equal(settings.branchNamePrefix, "test-rig");
      assert.equal(settings.branchNamingMode, "static");
      assert.equal("newWorktreeBranchPrefix" in settings, false);
      yield* service.updateSettings({ newWorktreesStartFromOrigin: false });
      const saved = yield* fs.readFileString(config.settingsPath);
      assert.equal(saved.includes("newWorktreeBranchPrefix"), false);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("preserves a shared settings symlink while saving its destination", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "test-rig-linked-settings-" });
      const destination = `${directory}/settings.json`;
      yield* fs.writeFileString(destination, '{"newWorktreesStartFromOrigin":false}');
      yield* fs.remove(config.settingsPath, { force: true });
      yield* fs.symlink(destination, config.settingsPath);
      const settings = yield* ServerSettingsModule.ServerSettingsService;
      yield* settings.updateSettings({ newWorktreesStartFromOrigin: true });
      assert.equal(yield* fs.readLink(config.settingsPath), destination);
      assert.equal(
        (yield* decodeSavedServerSettings(yield* fs.readFileString(destination)))
          .newWorktreesStartFromOrigin,
        true,
      );
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("reloads a symlink target on its own directory event", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const events = yield* PubSub.unbounded<FileSystem.WatchEvent>();
      const targetSubscribed = yield* Deferred.make<void>();
      let targetDirectory = "";
      const watchedFileSystem = {
        ...fs,
        watch: (directory: string) =>
          Stream.unwrap(
            Effect.gen(function* () {
              const subscription = yield* PubSub.subscribe(events);
              if (directory === targetDirectory)
                yield* Deferred.succeed(targetSubscribed, undefined);
              return Stream.fromSubscription(subscription);
            }),
          ),
      };
      yield* Effect.gen(function* () {
        const config = yield* ServerConfig.ServerConfig;
        const settings = yield* ServerSettingsModule.ServerSettingsService;
        targetDirectory = yield* fs.makeTempDirectoryScoped({
          prefix: "test-rig-shared-settings-",
        });
        const destination = path.join(targetDirectory, "settings.json");
        yield* fs.writeFileString(destination, '{"newWorktreesStartFromOrigin":false}');
        yield* fs.remove(config.settingsPath, { force: true });
        yield* fs.symlink(destination, config.settingsPath);
        yield* settings.start;
        yield* Deferred.await(targetSubscribed);
        const changes = yield* settings.subscribeChanges;
        const changed = yield* changes.pipe(Stream.runHead, Effect.forkChild);
        yield* fs.writeFileString(destination, '{"newWorktreesStartFromOrigin":true}');
        yield* PubSub.publish(events, { _tag: "Update", path: destination } as const);
        yield* TestClock.adjust(Duration.millis(100));
        const next = yield* Fiber.join(changed);
        assert.equal(Option.getOrUndefined(next)?.newWorktreesStartFromOrigin, true);
      }).pipe(
        Effect.provide(
          makeServerSettingsLayer().pipe(
            Layer.provide(Layer.succeed(FileSystem.FileSystem, watchedFileSystem)),
          ),
        ),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("preserves context when reading a provider environment secret fails", () => {
    const platformCause = PlatformError.systemError({
      _tag: "PermissionDenied",
      module: "FileSystem",
      method: "readFile",
      pathOrDescriptor: "provider environment secret",
      description: "Secret backend unavailable.",
    });
    const cause = new ServerSecretStore.SecretStoreReadError({
      resource: "provider environment secret",
      cause: platformCause,
    });
    const configLayer = Layer.fresh(
      ServerConfig.layerTest(process.cwd(), {
        prefix: "t3code-server-settings-secret-failure-test-",
      }),
    );
    const settingsLayer = ServerSettingsModule.layer.pipe(
      Layer.provide(makeFailingSecretStoreLayer(cause)),
      Layer.provideMerge(configLayer),
    );

    return Effect.gen(function* () {
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      yield* fileSystem.writeFileString(
        serverConfig.settingsPath,
        '{"providerInstances":{"codex_personal":{"driver":"codex","environment":[{"name":"OPENROUTER_API_KEY","value":"","sensitive":true,"valueRedacted":true}],"config":{}}}}',
      );

      const error = yield* Effect.flip(serverSettings.getSettings);

      assert.deepInclude(error, {
        _tag: "ServerSettingsError",
        operation: "read-secret",
        providerInstanceId: "codex_personal",
        environmentVariable: "OPENROUTER_API_KEY",
      });
      assert.strictEqual(error.cause, cause);
      assert.notInclude(error.message, cause.message);
    }).pipe(Effect.provide(settingsLayer));
  });

  it.effect("preserves disabled inactivity settlement across concurrent settings edits", () =>
    Effect.gen(function* () {
      const service = yield* ServerSettingsModule.ServerSettingsService;
      const fs = yield* FileSystem.FileSystem;
      const config = yield* ServerConfig.ServerConfig;
      yield* Effect.all(
        [
          service.updateSettings({ sidebarAutoSettleAfterDays: null }),
          service.updateSettings({ sidebarAutoSettleOnMerge: false }),
        ],
        { concurrency: "unbounded" },
      );
      const saved = yield* decodeSavedServerSettings(yield* fs.readFileString(config.settingsPath));
      const current = yield* service.getSettings;
      for (const settings of [saved, current]) {
        assert.isNull(settings.sidebarAutoSettleAfterDays);
        assert.isFalse(settings.sidebarAutoSettleOnMerge);
      }
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("preserves configured preferences when an unrelated decoded patch is saved", () =>
    Effect.gen(function* () {
      const service = yield* ServerSettingsModule.ServerSettingsService;
      const preferences = {
        enableAgentBrowserAccess: false,
        defaultAutoPull: true,
        continueThreadsAfterServerUpdate: true,
        sidebarAutoSettleAfterDays: 14,
        sidebarAutoSettleOnMerge: false,
        snoozeLimitedThreads: true,
        autoResumeLimitedThreads: true,
      };
      yield* service.updateSettings(yield* decodeSettingsPatch(preferences));
      const before = yield* service.getSettings;
      const patch = yield* decodeSettingsPatch({ addProjectBaseDirectory: "/projects" });
      yield* service.updateSettings(patch);
      const after = yield* service.getSettings;
      assert.deepEqual(after, { ...before, addProjectBaseDirectory: "/projects" });
      for (const [key, value] of Object.entries(preferences)) {
        assert.equal(after[key as keyof typeof preferences], value);
      }
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("decodes nested settings patches", () =>
    Effect.gen(function* () {
      assert.deepEqual(
        yield* decodeSettingsPatch({ providers: { codex: { binaryPath: "/tmp/codex" } } }),
        {
          providers: { codex: { binaryPath: "/tmp/codex" } },
        },
      );

      assert.deepEqual(
        yield* decodeSettingsPatch({
          textGenerationModelSelection: {
            options: [{ id: "fastMode", value: false }],
          },
        }),
        {
          textGenerationModelSelection: {
            options: [{ id: "fastMode", value: false }],
          },
        },
      );
    }),
  );

  it.effect(
    "decodes legacy object-shaped textGenerationModelSelection.options from settings.json",
    () =>
      Effect.gen(function* () {
        const decoded = yield* decodeServerSettings({
          textGenerationModelSelection: {
            provider: ProviderDriverKind.make("codex"),
            model: "gpt-5.4-mini",
            options: { reasoningEffort: "low" },
          },
        });

        assert.deepEqual(decoded.textGenerationModelSelection, {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4-mini",
          options: [{ id: "reasoningEffort", value: "low" }],
        });
      }),
  );

  it.effect("deep merges nested settings updates without dropping siblings", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;

      yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: "/usr/local/bin/codex",
            homePath: "/Users/julius/.codex",
          },
          claudeAgent: {
            binaryPath: "/usr/local/bin/claude",
            customModels: ["claude-custom"],
          },
        },
        textGenerationModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
          options: createModelSelection(
            ProviderInstanceId.make("codex"),
            DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
            [
              { id: "reasoningEffort", value: "high" },
              { id: "fastMode", value: true },
            ],
          ).options!,
        },
      });

      const next = yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: "/opt/homebrew/bin/codex",
          },
        },
        textGenerationModelSelection: {
          options: [{ id: "fastMode", value: false }],
        },
      });

      assert.deepEqual(next.providers.codex, {
        enabled: true,
        binaryPath: "/opt/homebrew/bin/codex",
        homePath: "/Users/julius/.codex",
        shadowHomePath: "",
        launchArgs: "",
        customModels: [],
      });
      assert.deepEqual(next.providers.claudeAgent, {
        enabled: true,
        binaryPath: "/usr/local/bin/claude",
        homePath: "",
        customModels: ["claude-custom"],
        autoCompactWindow: "",
        launchArgs: "",
      });
      assert.deepEqual(
        next.textGenerationModelSelection,
        createModelSelection(
          ProviderInstanceId.make("codex"),
          DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
          [
            { id: "reasoningEffort", value: "high" },
            { id: "fastMode", value: false },
          ],
        ),
      );
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("preserves excluded legacy settings across unrelated updates", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      yield* fileSystem.writeFileString(
        serverConfig.settingsPath,
        encodeLegacySettings({
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
          textGenerationModelSelection: {
            instanceId: "grok",
            model: "grok-legacy-model",
          },
        }),
      );

      const next = yield* serverSettings.updateSettings({
        newWorktreesStartFromOrigin: false,
      });

      assert.deepEqual(next.providers.cursor, {
        enabled: true,
        binaryPath: "/legacy/cursor-agent",
        apiEndpoint: "https://legacy.invalid/cursor",
        customModels: ["cursor-legacy-model"],
      });
      assert.deepEqual(next.providers.grok, {
        enabled: true,
        binaryPath: "/legacy/grok",
        customModels: ["grok-legacy-model"],
      });
      assert.deepEqual(next.textGenerationModelSelection, {
        instanceId: ProviderInstanceId.make("grok"),
        model: "grok-legacy-model",
      });

      const persisted = yield* fileSystem.readFileString(serverConfig.settingsPath);
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const roundTripped = yield* decodeServerSettings(JSON.parse(persisted));
      assert.deepEqual(roundTripped.providers.cursor, next.providers.cursor);
      assert.deepEqual(roundTripped.providers.grok, next.providers.grok);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("falls back only to an enabled approved provider", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      const settings = yield* serverSettings.getSettings;

      assert.deepEqual(settings.textGenerationModelSelection, {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        model: "claude-haiku-5-5",
      });
    }).pipe(
      Effect.provide(
        ServerSettingsModule.layerTest({
          providers: {
            codex: { enabled: false },
            claudeAgent: { enabled: true },
            cursor: { enabled: true },
            grok: { enabled: true },
          },
          textGenerationModelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "disabled-codex-model",
          },
        }),
      ),
    ),
  );

  it.effect("buffers changes after a subscription is acquired but before it is consumed", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
        const changes = yield* serverSettings.subscribeChanges;

        yield* serverSettings.updateSettings({
          providers: {
            codex: {
              binaryPath: "/usr/local/bin/codex-next",
            },
          },
        });

        const firstChange = yield* changes.pipe(Stream.runHead, Effect.timeout("1 second"));
        assert.equal(
          Option.getOrUndefined(firstChange)?.providers.codex.binaryPath,
          "/usr/local/bin/codex-next",
        );
      }),
    ).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("preserves model when switching providers via textGenerationModelSelection", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;

      // Start with Claude text generation selection
      yield* serverSettings.updateSettings({
        textGenerationModelSelection: {
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: "claude-sonnet-4-6",
          options: createModelSelection(
            ProviderInstanceId.make("claudeAgent"),
            "claude-sonnet-4-6",
            [{ id: "effort", value: "high" }],
          ).options!,
        },
      });

      // Switch to Codex — the stale Claude "effort" in options must not
      // cause the update to lose the selected model.
      const next = yield* serverSettings.updateSettings({
        textGenerationModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4",
          options: createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4", [
            { id: "reasoningEffort", value: "high" },
          ]).options!,
        },
      });

      assert.deepEqual(
        next.textGenerationModelSelection,
        createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4", [
          { id: "reasoningEffort", value: "high" },
        ]),
      );
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("preserves custom provider instance text generation selections", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;

      const next = yield* serverSettings.updateSettings({
        providerInstances: {
          [ProviderInstanceId.make("claude_openrouter")]: {
            driver: ProviderDriverKind.make("claudeAgent"),
            enabled: true,
            config: { customModels: ["openai/gpt-5.5"] },
          },
        },
        textGenerationModelSelection: {
          instanceId: ProviderInstanceId.make("claude_openrouter"),
          model: "openai/gpt-5.5",
        },
      });

      assert.deepEqual(next.textGenerationModelSelection, {
        instanceId: ProviderInstanceId.make("claude_openrouter"),
        model: "openai/gpt-5.5",
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect(
    "uses explicit provider instance enabled state over legacy provider enabled state",
    () =>
      Effect.gen(function* () {
        const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
        const instanceId = ProviderInstanceId.make("claude_openrouter");

        const next = yield* serverSettings.updateSettings({
          providers: {
            claudeAgent: {
              enabled: false,
            },
          },
          providerInstances: {
            [instanceId]: {
              driver: ProviderDriverKind.make("claudeAgent"),
              enabled: true,
              config: { customModels: ["openai/gpt-5.5"] },
            },
          },
          textGenerationModelSelection: {
            instanceId,
            model: "openai/gpt-5.5",
          },
        });

        assert.deepEqual(next.textGenerationModelSelection, {
          instanceId,
          model: "openai/gpt-5.5",
        });
      }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("preserves enabled text generation selections for non-built-in drivers", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      const instanceId = ProviderInstanceId.make("openrouter_text");

      const next = yield* serverSettings.updateSettings({
        providerInstances: {
          [instanceId]: {
            driver: ProviderDriverKind.make("openrouter"),
            enabled: true,
            config: { customModels: ["openai/gpt-5.5"] },
          },
        },
        textGenerationModelSelection: {
          instanceId,
          model: "openai/gpt-5.5",
        },
      });

      assert.deepEqual(next.textGenerationModelSelection, {
        instanceId,
        model: "openai/gpt-5.5",
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect(
    "preserves the source control writer selection when its provider instance is disabled",
    () =>
      Effect.gen(function* () {
        const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
        const serverConfig = yield* ServerConfig.ServerConfig;
        const fileSystem = yield* FileSystem.FileSystem;
        const instanceId = ProviderInstanceId.make("codex_writer");
        const sourceControlWriterModelSelection = {
          instanceId,
          model: "gpt-5.4-mini",
        };

        yield* serverSettings.updateSettings({
          providerInstances: {
            [instanceId]: {
              driver: ProviderDriverKind.make("codex"),
              enabled: true,
              config: {},
            },
          },
          sourceControlWriterModelSelection,
        });

        const next = yield* serverSettings.updateSettings({
          providerInstances: {
            [instanceId]: {
              driver: ProviderDriverKind.make("codex"),
              enabled: false,
              config: {},
            },
          },
        });

        assert.deepEqual(next.sourceControlWriterModelSelection, sourceControlWriterModelSelection);
        assert.deepEqual(
          ServerSettingsModule.resolveSourceControlWriterModelSelection(next),
          next.textGenerationModelSelection,
        );
        assert.deepEqual(
          (yield* serverSettings.getSettings).sourceControlWriterModelSelection,
          sourceControlWriterModelSelection,
        );

        const raw = yield* fileSystem.readFileString(serverConfig.settingsPath);
        assert.deepEqual(
          // @effect-diagnostics-next-line preferSchemaOverJson:off
          JSON.parse(raw).sourceControlWriterModelSelection,
          sourceControlWriterModelSelection,
        );

        const restored = yield* serverSettings.updateSettings({
          providerInstances: {
            [instanceId]: {
              driver: ProviderDriverKind.make("codex"),
              enabled: true,
              config: {},
            },
          },
        });
        assert.deepEqual(
          ServerSettingsModule.resolveSourceControlWriterModelSelection(restored),
          sourceControlWriterModelSelection,
        );
      }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("drops stale text generation options when resetting model selection", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;

      yield* serverSettings.updateSettings({
        textGenerationModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
          options: createModelSelection(
            ProviderInstanceId.make("codex"),
            DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
            [
              { id: "reasoningEffort", value: "high" },
              { id: "fastMode", value: true },
            ],
          ).options!,
        },
      });

      const next = yield* serverSettings.updateSettings({
        textGenerationModelSelection: {
          instanceId: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.instanceId,
          model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
        },
      });

      assert.deepEqual(next.textGenerationModelSelection, {
        instanceId: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.instanceId,
        model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("replaces provider instance maps when clearing optional fields", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      const codexId = ProviderInstanceId.make("codex");

      yield* serverSettings.updateSettings({
        providerInstances: {
          [codexId]: {
            driver: ProviderDriverKind.make("codex"),
            displayName: "Codex Work",
            accentColor: "#7c3aed",
            enabled: true,
            config: { homePath: "~/.codex" },
          },
        },
      });

      const next = yield* serverSettings.updateSettings({
        providerInstances: {
          [codexId]: {
            driver: ProviderDriverKind.make("codex"),
            displayName: "Codex Work",
            enabled: true,
            config: { homePath: "~/.codex" },
          },
        },
      });

      assert.deepEqual(next.providerInstances[codexId], {
        driver: ProviderDriverKind.make("codex"),
        displayName: "Codex Work",
        enabled: true,
        config: { homePath: "~/.codex" },
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("trims provider path settings when updates are applied", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;

      const next = yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: "  /opt/homebrew/bin/codex  ",
            homePath: "   ",
          },
          claudeAgent: {
            binaryPath: "  /opt/homebrew/bin/claude  ",
          },
        },
      });

      assert.deepEqual(next.providers.codex, {
        enabled: true,
        binaryPath: "/opt/homebrew/bin/codex",
        homePath: "",
        shadowHomePath: "",
        launchArgs: "",
        customModels: [],
      });
      assert.deepEqual(next.providers.claudeAgent, {
        enabled: true,
        binaryPath: "/opt/homebrew/bin/claude",
        homePath: "",
        customModels: [],
        autoCompactWindow: "",
        launchArgs: "",
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("trims observability settings when updates are applied", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;

      const next = yield* serverSettings.updateSettings({
        addProjectBaseDirectory: "  ~/Development  ",
        observability: {
          otlpTracesUrl: "  http://localhost:4318/v1/traces  ",
          otlpMetricsUrl: "  http://localhost:4318/v1/metrics  ",
        },
      });

      assert.equal(next.addProjectBaseDirectory, "~/Development");
      assert.deepEqual(next.observability, {
        otlpTracesUrl: "http://localhost:4318/v1/traces",
        otlpMetricsUrl: "http://localhost:4318/v1/metrics",
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("defaults blank binary paths to provider executables", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;

      const next = yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: "   ",
          },
          claudeAgent: {
            binaryPath: "",
          },
        },
      });

      assert.equal(next.providers.codex.binaryPath, "codex");
      assert.equal(next.providers.claudeAgent.binaryPath, "claude");
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("writes only non-default server settings to disk", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const next = yield* serverSettings.updateSettings({
        addProjectBaseDirectory: "~/Development",
        observability: {
          otlpTracesUrl: "http://localhost:4318/v1/traces",
          otlpMetricsUrl: "http://localhost:4318/v1/metrics",
        },
        providers: {
          codex: {
            binaryPath: "/opt/homebrew/bin/codex",
          },
        },
        automaticGitFetchInterval: Duration.seconds(10),
      });

      assert.equal(next.providers.codex.binaryPath, "/opt/homebrew/bin/codex");

      const raw = yield* fileSystem.readFileString(serverConfig.settingsPath);
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      assert.deepEqual(JSON.parse(raw), {
        addProjectBaseDirectory: "~/Development",
        observability: {
          otlpTracesUrl: "http://localhost:4318/v1/traces",
          otlpMetricsUrl: "http://localhost:4318/v1/metrics",
        },
        providers: {
          codex: {
            binaryPath: "/opt/homebrew/bin/codex",
          },
        },
        backgroundActivity: {
          schemaVersion: 1,
          profile: "custom",
          baseProfile: "balanced",
          overrides: {
            automaticGitFetchInterval: 10_000,
          },
        },
        automaticGitFetchInterval: 10_000,
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("stores sensitive provider instance environment values outside settings.json", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const instanceId = ProviderInstanceId.make("codex_personal");

      const next = yield* serverSettings.updateSettings({
        providerInstances: {
          [instanceId]: {
            driver: ProviderDriverKind.make("codex"),
            environment: [
              { name: "OPENROUTER_API_KEY", value: "sk-or-secret", sensitive: true },
              { name: "ANTHROPIC_BASE_URL", value: "https://openrouter.ai/api", sensitive: false },
            ],
            config: {},
          },
        },
      });

      assert.deepEqual(next.providerInstances[instanceId]?.environment, [
        {
          name: "OPENROUTER_API_KEY",
          value: "sk-or-secret",
          sensitive: true,
          valueRedacted: true,
        },
        { name: "ANTHROPIC_BASE_URL", value: "https://openrouter.ai/api", sensitive: false },
      ]);

      const raw = yield* fileSystem.readFileString(serverConfig.settingsPath);
      assert.notInclude(raw, "sk-or-secret");
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      assert.deepEqual(JSON.parse(raw).providerInstances.codex_personal.environment, [
        {
          name: "OPENROUTER_API_KEY",
          value: "",
          sensitive: true,
          valueRedacted: true,
        },
        { name: "ANTHROPIC_BASE_URL", value: "https://openrouter.ai/api", sensitive: false },
      ]);

      const roundTripped = yield* serverSettings.updateSettings({
        providerInstances: {
          [instanceId]: {
            driver: ProviderDriverKind.make("codex"),
            displayName: "Codex Personal",
            environment: [
              { name: "OPENROUTER_API_KEY", value: "", sensitive: true, valueRedacted: true },
              { name: "ANTHROPIC_BASE_URL", value: "https://openrouter.ai/api", sensitive: false },
            ],
            config: {},
          },
        },
      });

      assert.equal(
        roundTripped.providerInstances[instanceId]?.environment?.[0]?.value,
        "sk-or-secret",
      );
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );
});
