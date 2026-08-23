import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import type * as Electron from "electron";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as DesktopAppIdentity from "./DesktopAppIdentity.ts";
import * as DesktopAssets from "./DesktopAssets.ts";
import * as DesktopConfig from "./DesktopConfig.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";

const defaultEnvironmentInput = {
  dirname: "/repo/apps/desktop/dist-electron",
  homeDirectory: "/Users/alice",
  platform: "darwin",
  processArch: "arm64",
  appVersion: "1.2.3",
  appPath: "/Applications/Test Rig.app/Contents/Resources/app.asar",
  isPackaged: true,
  resourcesPath: "/Applications/Test Rig.app/Contents/Resources",
  runningUnderArm64Translation: false,
} satisfies DesktopEnvironment.MakeDesktopEnvironmentInput;

interface ElectronAppCalls {
  readonly setAboutPanelOptions: Array<Electron.AboutPanelOptionsOptions>;
  readonly setDockIcon: string[];
  readonly setName: string[];
  readonly setPath: Array<readonly [string, string]>;
}

const makeElectronAppLayer = (calls: ElectronAppCalls) =>
  Layer.succeed(ElectronApp.ElectronApp, {
    metadata: Effect.die("unexpected metadata read"),
    name: Effect.succeed("Test Rig"),
    whenReady: Effect.void,
    quit: Effect.void,
    requestSingleInstanceLock: Effect.succeed(true),
    exit: () => Effect.void,
    relaunch: () => Effect.void,
    setPath: (name, value) => Effect.sync(() => calls.setPath.push([name, value])),
    setName: (name) => Effect.sync(() => calls.setName.push(name)),
    setAboutPanelOptions: (options) => Effect.sync(() => calls.setAboutPanelOptions.push(options)),
    setAppUserModelId: () => Effect.void,
    getAppMetrics: Effect.succeed([]),
    isDefaultProtocolClient: () => Effect.succeed(false),
    setAsDefaultProtocolClient: () => Effect.succeed(true),
    setDesktopName: () => Effect.void,
    setDockIcon: (iconPath) => Effect.sync(() => calls.setDockIcon.push(iconPath)),
    appendCommandLineSwitch: () => Effect.void,
    removeCommandLineSwitch: () => Effect.void,
    on: () => Effect.void,
  } satisfies ElectronApp.ElectronApp["Service"]);

const makeCalls = (): ElectronAppCalls => ({
  setAboutPanelOptions: [],
  setDockIcon: [],
  setName: [],
  setPath: [],
});

const withIdentity = <A, E, R>(
  effect: Effect.Effect<A, E, R | DesktopAppIdentity.DesktopAppIdentity>,
  calls: ElectronAppCalls,
  env: Record<string, string | undefined> = {},
  initialized = false,
) =>
  effect.pipe(
    Effect.provide(
      (initialized ? DesktopAppIdentity.layerInitialized : DesktopAppIdentity.layer).pipe(
        Layer.provideMerge(
          FileSystem.layerNoop({
            makeDirectory: () => Effect.void,
            readFileString: () => Effect.succeed('{"t3codeCommitHash":"abcdef1234567890"}'),
          }),
        ),
        Layer.provideMerge(
          Layer.succeed(DesktopAssets.DesktopAssets, {
            iconPaths: Effect.succeed({
              ico: Option.none(),
              icns: Option.none(),
              png: Option.some("/icon.png"),
            }),
            resolveResourcePath: () => Effect.succeed(Option.none()),
          }),
        ),
        Layer.provideMerge(makeElectronAppLayer(calls)),
        Layer.provideMerge(
          DesktopEnvironment.layer(defaultEnvironmentInput).pipe(
            Layer.provide(Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest(env))),
          ),
        ),
      ),
    ),
  );

describe("DesktopAppIdentity", () => {
  it.effect("configures isolated Electron storage before ready", () => {
    const calls = makeCalls();
    return withIdentity(
      Effect.gen(function* () {
        yield* DesktopAppIdentity.DesktopAppIdentity;
        assert.deepEqual(calls.setPath, [
          ["userData", "/Users/alice/Library/Application Support/test-rig"],
          ["sessionData", "/Users/alice/Library/Application Support/test-rig/session-data"],
          ["logs", "/Users/alice/.test-rig/userdata/logs"],
          ["crashDumps", "/Users/alice/.test-rig/userdata/crash-dumps"],
        ]);
      }),
      calls,
      {},
      true,
    );
  });

  it.effect("configures the Test Rig product identity", () => {
    const calls = makeCalls();
    return withIdentity(
      Effect.gen(function* () {
        const identity = yield* DesktopAppIdentity.DesktopAppIdentity;
        yield* identity.configure;
        assert.deepEqual(calls.setName, ["Test Rig"]);
        assert.equal(calls.setAboutPanelOptions[0]?.applicationName, "Test Rig");
        assert.equal(calls.setAboutPanelOptions[0]?.applicationVersion, "1.2.3");
        assert.equal(calls.setAboutPanelOptions[0]?.version, "0123456789ab");
        assert.deepEqual(calls.setDockIcon, ["/icon.png"]);
      }),
      calls,
      { T3CODE_COMMIT_HASH: "0123456789abcdef" },
    );
  });
});
