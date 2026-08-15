import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopConfig from "./DesktopConfig.ts";

const defaultInput = {
  dirname: "/repo/apps/desktop/dist-electron",
  homeDirectory: "/Users/alice",
  platform: "darwin",
  processArch: "arm64",
  appVersion: "0.0.22",
  appPath: "/Applications/Sightseer.app/Contents/Resources/app.asar",
  isPackaged: false,
  resourcesPath: "/Applications/Sightseer.app/Contents/Resources",
  runningUnderArm64Translation: false,
} satisfies DesktopEnvironment.MakeDesktopEnvironmentInput;

const makeEnvironmentLayer = (
  overrides: Partial<DesktopEnvironment.MakeDesktopEnvironmentInput> = {},
  env: Record<string, string | undefined> = {},
) =>
  DesktopEnvironment.layer({
    ...defaultInput,
    ...overrides,
  }).pipe(Layer.provide(Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest(env))));

const makeEnvironment = (
  overrides: Partial<DesktopEnvironment.MakeDesktopEnvironmentInput> = {},
  env: Record<string, string | undefined> = {},
) =>
  DesktopEnvironment.DesktopEnvironment.pipe(Effect.provide(makeEnvironmentLayer(overrides, env)));

describe("DesktopEnvironment", () => {
  it.effect("derives state paths and development identity inside Effect", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment(
        {},
        {
          SIGHTSEER_HOME: " /tmp/sightseer ",
          T3CODE_COMMIT_HASH: " 0123456789abcdef ",
          T3CODE_PORT: "4949",
          VITE_DEV_SERVER_URL: "http://localhost:5173",
          T3CODE_DEV_REMOTE_T3_SERVER_ENTRY_PATH: " /remote/server.mjs ",
        },
      );

      assert.equal(environment.isDevelopment, true);
      assert.equal(environment.appDataDirectory, "/Users/alice/Library/Application Support");
      assert.equal(environment.baseDir, "/tmp/sightseer");
      assert.equal(environment.stateDir, "/tmp/sightseer/userdata");
      assert.equal(
        environment.desktopSettingsPath,
        "/tmp/sightseer/userdata/desktop-settings.json",
      );
      assert.equal(environment.clientSettingsPath, "/tmp/sightseer/userdata/client-settings.json");
      assert.equal(
        environment.savedEnvironmentRegistryPath,
        "/tmp/sightseer/userdata/saved-environments.json",
      );
      assert.equal(environment.serverSettingsPath, "/tmp/sightseer/userdata/settings.json");
      assert.equal(environment.logDir, "/tmp/sightseer/userdata/logs");
      assert.equal(environment.browserArtifactsDir, "/tmp/sightseer/userdata/browser-artifacts");
      assert.equal(environment.rootDir, "/repo");
      assert.equal(environment.appRoot, "/repo");
      assert.equal(environment.backendEntryPath, "/repo/apps/server/dist/bin.mjs");
      assert.equal(environment.backendCwd, "/repo");
      assert.equal(environment.appUserModelId, "com.lookvyr.sightseer.dev");
      assert.equal(environment.linuxWmClass, "sightseer-dev");
      assert.equal(environment.displayName, "Sightseer (Dev)");
      assert.equal(
        environment.electronUserDataPath,
        "/Users/alice/Library/Application Support/sightseer-dev",
      );
      assert.equal(
        environment.electronSessionDataPath,
        "/Users/alice/Library/Application Support/sightseer-dev/session-data",
      );
      assert.deepEqual(
        Option.map(environment.devServerUrl, (url) => url.href),
        Option.some("http://localhost:5173/"),
      );
      assert.deepEqual(environment.devRemoteT3ServerEntryPath, Option.some("/remote/server.mjs"));
      assert.deepEqual(environment.configuredBackendPort, Option.some(4949));
      assert.deepEqual(environment.commitHashOverride, Option.some("0123456789abcdef"));
    }),
  );

  it.effect("stores production state under userdata in an explicit home", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment(
        {},
        {
          SIGHTSEER_HOME: "/tmp/sightseer",
        },
      );

      assert.equal(environment.isDevelopment, false);
      assert.equal(environment.stateDir, "/tmp/sightseer/userdata");
      assert.equal(environment.logDir, "/tmp/sightseer/userdata/logs");
      assert.equal(environment.browserArtifactsDir, "/tmp/sightseer/userdata/browser-artifacts");
      assert.equal(environment.serverSettingsPath, "/tmp/sightseer/userdata/settings.json");
    }),
  );

  it.effect("keeps implicit development state separate from production state", () =>
    Effect.gen(function* () {
      const development = yield* makeEnvironment(
        {},
        { VITE_DEV_SERVER_URL: "http://localhost:5173" },
      );
      const production = yield* makeEnvironment();

      assert.equal(development.stateDir, "/Users/alice/.sightseer/dev");
      assert.equal(production.stateDir, "/Users/alice/.sightseer/userdata");
    }),
  );

  it.effect("enumerates isolated production and development paths on every desktop platform", () =>
    Effect.gen(function* () {
      for (const platform of ["darwin", "linux", "win32"] as const) {
        for (const isDevelopment of [false, true]) {
          const environment = yield* makeEnvironment(
            { platform },
            isDevelopment ? { VITE_DEV_SERVER_URL: "http://localhost:5173" } : {},
          );
          const expectedProfile = isDevelopment ? "sightseer-dev" : "sightseer";
          const expectedState = isDevelopment
            ? "/Users/alice/.sightseer/dev"
            : "/Users/alice/.sightseer/userdata";

          assert.equal(environment.userDataDirName, expectedProfile);
          assert.equal(environment.displayName, isDevelopment ? "Sightseer (Dev)" : "Sightseer");
          assert.equal(
            environment.appUserModelId,
            isDevelopment ? "com.lookvyr.sightseer.dev" : "com.lookvyr.sightseer",
          );
          assert.equal(environment.stateDir, expectedState);
          assert.isTrue(environment.electronUserDataPath.endsWith(`/${expectedProfile}`));
          assert.isTrue(
            environment.electronSessionDataPath.endsWith(`/${expectedProfile}/session-data`),
          );

          for (const derivedPath of [
            environment.baseDir,
            environment.stateDir,
            environment.logDir,
            environment.browserArtifactsDir,
            environment.electronUserDataPath,
            environment.electronSessionDataPath,
            environment.electronCrashDumpsPath,
          ]) {
            assert.notInclude(derivedPath, "/.t3/");
            assert.notInclude(derivedPath, "Sightseer");
            assert.notInclude(derivedPath, "t3code");
          }
        }
      }
    }),
  );

  it.effect("ignores the legacy T3 home override", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment({}, { T3CODE_HOME: "/Users/alice/.t3" });
      assert.equal(environment.baseDir, "/Users/alice/.sightseer");
      assert.equal(environment.stateDir, "/Users/alice/.sightseer/userdata");
    }),
  );

  it.effect("uses a configured app user model id override", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment(
        {},
        {
          T3CODE_DESKTOP_APP_USER_MODEL_ID: " com.lookvyr.sightseer.dev.local ",
          VITE_DEV_SERVER_URL: "http://localhost:5173",
        },
      );

      assert.equal(environment.appUserModelId, "com.lookvyr.sightseer.dev.local");
    }),
  );

  it.effect("resolves picker defaults without nullish sentinels", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment();

      assert.deepEqual(environment.resolvePickFolderDefaultPath(null), Option.none());
      assert.deepEqual(
        environment.resolvePickFolderDefaultPath({ initialPath: " " }),
        Option.none(),
      );
      assert.deepEqual(
        environment.resolvePickFolderDefaultPath({ initialPath: "~" }),
        Option.some("/Users/alice"),
      );
      assert.deepEqual(
        environment.resolvePickFolderDefaultPath({ initialPath: "~/project" }),
        Option.some("/Users/alice/project"),
      );
    }),
  );
});
