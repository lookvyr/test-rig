import * as OpenCodeServerLedger from "../OpenCodeServerLedger.ts";
import * as ProviderContinuationRequests from "../../orchestration-v2/ProviderContinuationRequests.ts";
/**
 * Multi-instance validation slices for `ProviderInstanceRegistryLive`.
 *
 * Two axes of the driver/registry refactor are exercised here:
 *
 *  1. **Same driver, many instances** — the "multi-instance codex slice"
 *     describe block below configures two independent `codex` instances and
 *     asserts each gets its own closures and identity. This is the
 *     multi-codex capability the refactor exists to unlock.
 *
 *  2. **Many drivers, one registry** — the "built-in drivers slice" describe
 *     block configures one instance of every executable driver shipped by
 *     Test Rig (`codex`, `claudeAgent`, `opencode`) alongside excluded
 *     Cursor/Grok rows. It proves the approved drivers boot normally while
 *     excluded rows fail closed as unavailable snapshots.
 *
 * Every instance in these tests is configured with `enabled: false` so the
 * provider-status checks short-circuit to pending/disabled snapshots
 * without trying to spawn real `codex` / `claude` / `opencode` binaries.
 * That keeps the assertions focused on registry routing
 * behaviour rather than the runtime details of each provider.
 */
import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  type ClaudeSettings,
  type CodexSettings,
  type OpenCodeSettings,
  ProviderDriverKind,
  type ProviderInstanceConfigMap,
  ProviderInstanceId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";
import { createModelSelection } from "@t3tools/shared/model";

import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import * as ProviderAdapterRegistry from "../../orchestration-v2/ProviderAdapterRegistry.ts";
import { makeTextGenerationFromRegistry } from "../../textGeneration/TextGeneration.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { ProviderInstanceRegistry } from "../Services/ProviderInstanceRegistry.ts";
import { ProviderRegistry } from "../Services/ProviderRegistry.ts";
import * as ProviderMaintenanceRunner from "../providerMaintenanceRunner.ts";
import { CodexDriver } from "../Drivers/CodexDriver.ts";
import { BUILT_IN_DRIVERS } from "../builtInDrivers.ts";
import { OpenCodeRuntimeLayer } from "../opencodeRuntime.ts";
import { NoOpProviderEventLoggers, ProviderEventLoggers } from "./ProviderEventLoggers.ts";
import { makeProviderInstanceRegistry } from "./ProviderInstanceRegistryLive.ts";
import { ProviderRegistryLive } from "./ProviderRegistry.ts";

const TEST_EPOCH = DateTime.makeUnsafe("1970-01-01T00:00:00.000Z");

const BackgroundPolicyAlwaysRunLayer = Layer.mock(BackgroundPolicy.BackgroundPolicy)({
  reportClientActivity: () => Effect.void,
  removeRpcClient: () => Effect.void,
  reportHostPowerState: () => Effect.void,
  snapshot: Effect.succeed({
    hostPower: {
      source: "unknown",
      idle: "unknown",
      idleSeconds: null,
      locked: "unknown",
      suspended: false,
      onBattery: "unknown",
      lowPowerMode: "unknown",
      thermalState: "unknown",
      stale: true,
      updatedAt: TEST_EPOCH,
    },
    leases: [],
    activeForegroundLeaseCount: 0,
    activeScopeKeys: [],
    shouldRunOpportunisticWork: true,
    updatedAt: TEST_EPOCH,
  }),
  streamChanges: Stream.empty,
  hasDemand: () => Effect.succeed(true),
  shouldRunScopeWork: () => Effect.succeed(true),
  shouldRunOpportunisticWork: Effect.succeed(true),
});

const makeCodexConfig = (overrides: Partial<CodexSettings>): CodexSettings => ({
  enabled: false,
  binaryPath: "codex",
  homePath: "",
  shadowHomePath: "",
  launchArgs: "",
  customModels: [],
  ...overrides,
});

const makeClaudeConfig = (overrides: Partial<ClaudeSettings>): ClaudeSettings => ({
  autoCompactWindow: "",
  enabled: false,
  binaryPath: "claude",
  homePath: "",
  customModels: [],
  launchArgs: "",
  ...overrides,
});

const makeOpenCodeConfig = (overrides: Partial<OpenCodeSettings>): OpenCodeSettings => ({
  enabled: false,
  binaryPath: "opencode",
  serverUrl: "",
  serverPassword: "",
  customModels: [],
  ...overrides,
});

describe("ProviderInstanceRegistryLive — multi-instance codex slice", () => {
  // `ServerConfig.layerTest` needs `FileSystem` to materialize its scratch
  // directory. `Layer.merge` just unions requirements, so we have to push
  // `NodeServices.layer` through `Layer.provideMerge` to satisfy that
  // dependency while still surfacing NodeServices to the test body (the
  // codex driver's `create` yields `ChildProcessSpawner` directly).
  const testLayer = ServerConfig.layerTest(process.cwd(), {
    prefix: "provider-instance-registry-test",
  }).pipe(
    Layer.provideMerge(NodeServices.layer),
    Layer.provideMerge(BackgroundPolicyAlwaysRunLayer),
    Layer.provideMerge(ProviderContinuationRequests.layer),
    Layer.provideMerge(ServerSettingsService.layerTest()),
    Layer.provideMerge(Layer.succeed(ProviderEventLoggers, NoOpProviderEventLoggers)),
  );

  it.live("boots two independent codex instances from a ProviderInstanceConfigMap", () =>
    Effect.gen(function* () {
      const personalId = ProviderInstanceId.make("codex_personal");
      const workId = ProviderInstanceId.make("codex_work");
      const codexDriverKind = ProviderDriverKind.make("codex");

      const configMap: ProviderInstanceConfigMap = {
        [personalId]: {
          driver: codexDriverKind,
          displayName: "Codex (personal)",
          enabled: false,
          config: makeCodexConfig({
            binaryPath: "/opt/codex-personal/bin/codex",
            homePath: "/home/julius/.codex_personal",
            customModels: ["personal-preview"],
          }),
        },
        [workId]: {
          driver: codexDriverKind,
          displayName: "Codex (work)",
          enabled: false,
          config: makeCodexConfig({
            binaryPath: "/opt/codex-work/bin/codex",
            homePath: "/home/julius/.codex",
            customModels: ["work-preview"],
          }),
        },
      };

      const { registry } = yield* makeProviderInstanceRegistry({
        drivers: [CodexDriver],
        configMap,
      });

      const instances = yield* registry.listInstances;
      expect(instances.map((instance) => instance.instanceId).toSorted()).toEqual(
        [personalId, workId].toSorted(),
      );
      expect(instances.every((instance) => instance.driverKind === codexDriverKind)).toBe(true);
      expect(instances.map((instance) => instance.displayName).toSorted()).toEqual(
        ["Codex (personal)", "Codex (work)"].toSorted(),
      );

      // Each instance must be retrievable by id and carry its *own* closures.
      const personal = yield* registry.getInstance(personalId);
      const work = yield* registry.getInstance(workId);
      expect(personal).toBeDefined();
      expect(work).toBeDefined();
      expect(personal!.adapter).not.toBe(work!.adapter);
      expect(personal!.textGeneration).not.toBe(work!.textGeneration);
      expect(personal!.snapshot).not.toBe(work!.snapshot);

      // Snapshots identify themselves by instanceId + driver — this is
      // what makes per-instance routing distinguishable downstream.
      const personalSnapshot = yield* personal!.snapshot.getSnapshot;
      expect(personalSnapshot.instanceId).toBe(personalId);
      expect(personalSnapshot.driver).toBe(codexDriverKind);
      expect(personalSnapshot.enabled).toBe(false);
      expect(personalSnapshot.continuation?.groupKey).toBe(
        "codex:home:/home/julius/.codex_personal",
      );

      const workSnapshot = yield* work!.snapshot.getSnapshot;
      expect(workSnapshot.instanceId).toBe(workId);
      expect(workSnapshot.driver).toBe(codexDriverKind);
      expect(workSnapshot.enabled).toBe(false);
      expect(workSnapshot.continuation?.groupKey).toBe("codex:home:/home/julius/.codex");

      // Nothing goes to the unavailable bucket — both drivers are registered.
      const unavailable = yield* registry.listUnavailable;
      expect(unavailable).toEqual([]);
    }).pipe(Effect.provide(testLayer)),
  );

  it.live(
    "shadows instances whose driver is not registered in this build without failing boot",
    () =>
      Effect.gen(function* () {
        const codexId = ProviderInstanceId.make("codex_main");
        const ghostId = ProviderInstanceId.make("ghost_main");

        const configMap: ProviderInstanceConfigMap = {
          [codexId]: {
            driver: ProviderDriverKind.make("codex"),
            enabled: false,
            config: makeCodexConfig({}),
          },
          [ghostId]: {
            driver: ProviderDriverKind.make("ghostDriver"),
            displayName: "A fork-only driver we don't ship",
            enabled: false,
            config: { arbitrary: "payload", preserved: true },
          },
        };

        const { registry } = yield* makeProviderInstanceRegistry({
          drivers: [CodexDriver],
          configMap,
        });

        const instances = yield* registry.listInstances;
        expect(instances).toHaveLength(1);
        expect(instances[0]!.instanceId).toBe(codexId);

        const unavailable = yield* registry.listUnavailable;
        expect(unavailable).toHaveLength(1);
        const ghost = unavailable[0]!;
        expect(ghost.instanceId).toBe(ghostId);
        expect(ghost.driver).toBe("ghostDriver");
        expect(ghost.availability).toBe("unavailable");
        expect(ghost.unavailableReason).toMatch(/ghostDriver/);
      }).pipe(Effect.provide(testLayer)),
  );
});

describe("ProviderInstanceRegistryLive — built-in drivers slice", () => {
  // All drivers need `NodeServices` (ChildProcessSpawner + FileSystem +
  // Path). `OpenCodeDriver.create` additionally yields `OpenCodeRuntime`
  // at construction time, so we wire `OpenCodeRuntimeLive` into the stack.
  // `OpenCodeRuntimeLive` bundles its own `NetService.layer` via
  // `Layer.provide`, so the only external requirement it still exposes is
  // `ChildProcessSpawner` — resolved here by piping it through
  // `provideMerge(NodeServices.layer)`.
  //
  // The nested `provideMerge`s read bottom-up: `NodeServices.layer`
  // provides `OpenCodeRuntimeLive`'s deps while keeping its own outputs
  // surfaced; that merged layer then provides `ServerConfig.layerTest`'s
  // `FileSystem` dep while keeping everything else surfaced to the test.
  const infraLayer = OpenCodeRuntimeLayer.pipe(
    Layer.provide(OpenCodeServerLedger.layerTest),
    Layer.provideMerge(NodeServices.layer),
  );
  const testLayer = ServerConfig.layerTest(process.cwd(), {
    prefix: "provider-instance-registry-built-in-drivers-test",
  }).pipe(
    Layer.provideMerge(infraLayer),
    Layer.provideMerge(BackgroundPolicyAlwaysRunLayer),
    Layer.provideMerge(ProviderContinuationRequests.layer),
    Layer.provideMerge(ServerSettingsService.layerTest()),
    Layer.provideMerge(Layer.succeed(ProviderEventLoggers, NoOpProviderEventLoggers)),
  );

  it.live(
    "rejects excluded configured instances at every execution facade without spawning",
    () => {
      const spawned: unknown[] = [];
      return Effect.gen(function* () {
        const excluded = [
          {
            instanceId: ProviderInstanceId.make("cursor"),
            driver: ProviderDriverKind.make("cursor"),
          },
          {
            instanceId: ProviderInstanceId.make("cursor_legacy"),
            driver: ProviderDriverKind.make("cursor"),
          },
          { instanceId: ProviderInstanceId.make("grok"), driver: ProviderDriverKind.make("grok") },
          {
            instanceId: ProviderInstanceId.make("grok_legacy"),
            driver: ProviderDriverKind.make("grok"),
          },
          // Instance names cannot turn an excluded driver into an executable one.
          {
            instanceId: ProviderInstanceId.make("codex"),
            driver: ProviderDriverKind.make("cursor"),
          },
        ];
        const { registry } = yield* makeProviderInstanceRegistry({
          drivers: BUILT_IN_DRIVERS,
          configMap: Object.fromEntries(
            excluded.map(({ instanceId, driver }) => [
              instanceId,
              {
                driver,
                enabled: true,
                config: { binaryPath: "/sentinel/must-not-spawn", enabled: true },
              },
            ]),
          ),
        });
        const adapters = yield* ProviderAdapterRegistry.ProviderAdapterRegistryV2.pipe(
          Effect.provide(ProviderAdapterRegistry.layerFromProviderInstanceRegistry),
          Effect.provideService(ProviderInstanceRegistry, registry),
        );
        const providers = yield* ProviderRegistry.pipe(
          Effect.provide(ProviderRegistryLive),
          Effect.provideService(ProviderInstanceRegistry, registry),
        );
        const maintenance = yield* ProviderMaintenanceRunner.make().pipe(
          Effect.provideService(ProviderRegistry, providers),
        );
        const textGeneration = makeTextGenerationFromRegistry(registry);

        expect(yield* adapters.list()).toEqual([]);
        const unavailable = yield* providers.getProviders;
        expect(unavailable).toHaveLength(excluded.length);
        expect(
          unavailable.every(
            (provider) => !provider.enabled && provider.availability === "unavailable",
          ),
        ).toBe(true);

        for (const { instanceId, driver } of excluded) {
          expect((yield* adapters.get(instanceId).pipe(Effect.flip))._tag).toBe(
            "ProviderAdapterRegistryLookupError",
          );
          expect((yield* adapters.getMetadata!(instanceId).pipe(Effect.flip))._tag).toBe(
            "ProviderAdapterRegistryLookupError",
          );
          expect(
            (yield* maintenance.updateProvider({ provider: driver, instanceId }).pipe(Effect.flip))
              ._tag,
          ).toBe("ServerProviderUpdateError");
          yield* providers.refreshInstance(instanceId);
          yield* providers.refresh(driver);

          const common = {
            cwd: process.cwd(),
            modelSelection: createModelSelection(instanceId, "legacy-model"),
          };
          const operations = [
            [
              "generateBranchName",
              textGeneration.generateBranchName({ ...common, message: "test" }).pipe(Effect.asVoid),
            ],
            [
              "generateThreadTitle",
              textGeneration
                .generateThreadTitle({ ...common, message: "test" })
                .pipe(Effect.asVoid),
            ],
            [
              "generateCommitMessage",
              textGeneration
                .generateCommitMessage({
                  ...common,
                  branch: "test",
                  stagedSummary: "test",
                  stagedPatch: "test",
                })
                .pipe(Effect.asVoid),
            ],
            [
              "generatePrContent",
              textGeneration
                .generatePrContent({
                  ...common,
                  baseBranch: "main",
                  headBranch: "test",
                  commitSummary: "test",
                  diffSummary: "test",
                  diffPatch: "test",
                })
                .pipe(Effect.asVoid),
            ],
          ] as const;
          for (const [operation, run] of operations) {
            const error = yield* run.pipe(Effect.flip);
            expect(error._tag).toBe("TextGenerationError");
            expect(error.operation).toBe(operation);
            expect(error.detail).toContain(instanceId);
          }
        }
        expect(spawned).toEqual([]);
      }).pipe(
        Effect.provideService(
          ChildProcessSpawner.ChildProcessSpawner,
          ChildProcessSpawner.make((command) => {
            spawned.push(command);
            return Effect.die("Excluded provider attempted to spawn");
          }),
        ),
        Effect.provide(testLayer),
      );
    },
  );

  it.live("boots only approved drivers and shadows excluded provider rows", () =>
    Effect.gen(function* () {
      const codexId = ProviderInstanceId.make("codex_default");
      const claudeId = ProviderInstanceId.make("claude_default");
      const cursorId = ProviderInstanceId.make("cursor_legacy");
      const grokId = ProviderInstanceId.make("grok_legacy");
      const openCodeId = ProviderInstanceId.make("opencode_default");

      const codexDriverKind = ProviderDriverKind.make("codex");
      const claudeDriverKind = ProviderDriverKind.make("claudeAgent");
      const openCodeDriverKind = ProviderDriverKind.make("opencode");

      const configMap: ProviderInstanceConfigMap = {
        [codexId]: {
          driver: codexDriverKind,
          displayName: "Codex",
          enabled: false,
          config: makeCodexConfig({ homePath: "/home/julius/.codex" }),
        },
        [claudeId]: {
          driver: claudeDriverKind,
          displayName: "Claude",
          enabled: false,
          config: makeClaudeConfig({
            homePath: "/home/julius/.claude-work",
            autoCompactWindow: "",
            launchArgs: "--verbose",
          }),
        },
        [cursorId]: {
          driver: ProviderDriverKind.make("cursor"),
          displayName: "Historical Cursor",
          enabled: true,
          config: { binaryPath: "/sentinel/must-not-spawn/cursor-agent" },
        },
        [grokId]: {
          driver: ProviderDriverKind.make("grok"),
          displayName: "Historical Grok",
          enabled: true,
          config: { binaryPath: "/sentinel/must-not-spawn/grok" },
        },
        [openCodeId]: {
          driver: openCodeDriverKind,
          displayName: "OpenCode",
          enabled: false,
          config: makeOpenCodeConfig({}),
        },
      };

      const { registry } = yield* makeProviderInstanceRegistry({
        drivers: BUILT_IN_DRIVERS,
        configMap,
      });

      const unavailable = yield* registry.listUnavailable;
      expect(unavailable.map((provider) => provider.instanceId).toSorted()).toEqual(
        [cursorId, grokId].toSorted(),
      );
      expect(unavailable.every((provider) => provider.availability === "unavailable")).toBe(true);
      expect(unavailable.every((provider) => provider.enabled === false)).toBe(true);
      expect(unavailable.every((provider) => provider.installed === false)).toBe(true);

      const instances = yield* registry.listInstances;
      expect(instances).toHaveLength(3);
      expect(instances.map((instance) => instance.instanceId).toSorted()).toEqual(
        [codexId, claudeId, openCodeId].toSorted(),
      );

      // Instance lookup by id resolves each instance to its own bundle —
      // this is how rest-of-server routes turn/session calls in the new
      // model. Each driver's bundle carries its advertised `driverKind`.
      const codex = yield* registry.getInstance(codexId);
      const claude = yield* registry.getInstance(claudeId);
      const cursor = yield* registry.getInstance(cursorId);
      const grok = yield* registry.getInstance(grokId);
      const openCode = yield* registry.getInstance(openCodeId);
      expect(codex?.driverKind).toBe(codexDriverKind);
      expect(claude?.driverKind).toBe(claudeDriverKind);
      expect(cursor).toBeUndefined();
      expect(grok).toBeUndefined();
      expect(openCode?.driverKind).toBe(openCodeDriverKind);
      expect(codex?.displayName).toBe("Codex");
      expect(claude?.displayName).toBe("Claude");
      expect(openCode?.displayName).toBe("OpenCode");

      // Every live instance owns its own set of closures — no sharing across
      // drivers. `adapter` / `textGeneration` / `snapshot` are all distinct
      // references.
      const adapters = [codex!.adapter, claude!.adapter, openCode!.adapter];
      expect(new Set(adapters).size).toBe(adapters.length);
      const textGenerations = [
        codex!.textGeneration,
        claude!.textGeneration,
        openCode!.textGeneration,
      ];
      expect(new Set(textGenerations).size).toBe(textGenerations.length);
      const snapshots = [codex!.snapshot, claude!.snapshot, openCode!.snapshot];
      expect(new Set(snapshots).size).toBe(snapshots.length);

      // Snapshots identify themselves by `instanceId` + `driver` so
      // downstream aggregation in `ProviderRegistry` can tell instances
      // apart even when two share a driver. With `enabled: false`, the
      // check short-circuits and we get a disabled/pending snapshot back
      // — that's enough signal to validate the stamping wrapper without
      // spawning real binaries.
      const codexSnapshot = yield* codex!.snapshot.getSnapshot;
      expect(codexSnapshot.instanceId).toBe(codexId);
      expect(codexSnapshot.driver).toBe(codexDriverKind);
      expect(codexSnapshot.enabled).toBe(false);
      expect(codexSnapshot.continuation?.groupKey).toBe("codex:home:/home/julius/.codex");

      const claudeSnapshot = yield* claude!.snapshot.getSnapshot;
      expect(claudeSnapshot.instanceId).toBe(claudeId);
      expect(claudeSnapshot.driver).toBe(claudeDriverKind);
      expect(claudeSnapshot.enabled).toBe(false);
      expect(claudeSnapshot.continuation?.groupKey).toBe("claude:home:/home/julius/.claude-work");

      const openCodeSnapshot = yield* openCode!.snapshot.getSnapshot;
      expect(openCodeSnapshot.instanceId).toBe(openCodeId);
      expect(openCodeSnapshot.driver).toBe(openCodeDriverKind);
      expect(openCodeSnapshot.enabled).toBe(false);
      expect(openCodeSnapshot.continuation?.groupKey).toBe(
        `${openCodeDriverKind}:instance:${openCodeId}`,
      );
    }).pipe(Effect.provide(testLayer)),
  );
});
