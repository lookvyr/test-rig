// @effect-diagnostics nodeBuiltinImport:off - This regression verifies synchronous filesystem setup before Electron's ready event.
import { assert, describe, it } from "@effect/vitest";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { beforeEach, vi } from "vite-plus/test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

const {
  appendSwitchMock,
  getSwitchValueMock,
  hasSwitchMock,
  registerSchemesMock,
  getPathMock,
  setPathMock,
} = vi.hoisted(() => ({
  appendSwitchMock: vi.fn(),
  getSwitchValueMock: vi.fn(),
  hasSwitchMock: vi.fn(),
  registerSchemesMock: vi.fn(),
  getPathMock: vi.fn(),
  setPathMock: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    getPath: getPathMock,
    setPath: setPathMock,
    commandLine: {
      appendSwitch: appendSwitchMock,
      getSwitchValue: getSwitchValueMock,
      hasSwitch: hasSwitchMock,
    },
  },
  protocol: {
    registerSchemesAsPrivileged: registerSchemesMock,
  },
}));

import * as DesktopPreReadyPlatform from "./DesktopPreReadyPlatform.ts";

describe("DesktopPreReadyPlatform", () => {
  beforeEach(() => {
    appendSwitchMock.mockReset();
    getSwitchValueMock.mockReset();
    hasSwitchMock.mockReset();
    registerSchemesMock.mockReset();
    getPathMock.mockReset();
    setPathMock.mockReset();
  });

  for (const [devServerUrl, profile] of [
    ["", "test-rig"],
    ["http://localhost:5733", "test-rig-dev"],
  ] as const) {
    it(`sets ${profile} cache paths synchronously before async services start`, () => {
      const appData = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "test-rig-early-profile-"));
      vi.stubEnv("VITE_DEV_SERVER_URL", devServerUrl);
      getPathMock.mockImplementation((name) => {
        assert.equal(name, "appData");
        return appData;
      });
      setPathMock.mockImplementation((_name, path) => {
        assert.isTrue(NodeFS.existsSync(path));
      });
      try {
        const result = DesktopPreReadyPlatform.configureStoragePathsSync();
        assert.isUndefined(result);
        const userData = NodePath.join(appData, profile);
        assert.deepEqual(setPathMock.mock.calls, [
          ["userData", userData],
          ["sessionData", NodePath.join(userData, "session-data")],
        ]);
      } finally {
        vi.unstubAllEnvs();
        NodeFS.rmSync(appData, { recursive: true, force: true });
      }
    });
  }

  it("reads an explicit Electron command-line switch value", () => {
    const value = DesktopPreReadyPlatform.readCommandLineSwitchValue(
      {
        hasSwitch: (switchName) => switchName === "password-store",
        getSwitchValue: (switchName) => {
          assert.equal(switchName, "password-store");
          return "basic";
        },
      },
      "password-store",
    );

    assert.equal(value, "basic");
  });

  it("treats valueless Electron command-line switches as absent", () => {
    const value = DesktopPreReadyPlatform.readCommandLineSwitchValue(
      {
        hasSwitch: () => true,
        getSwitchValue: () => "",
      },
      "password-store",
    );

    assert.isNull(value);
  });

  it("returns null for missing Electron command-line switches", () => {
    const value = DesktopPreReadyPlatform.readCommandLineSwitchValue(
      {
        hasSwitch: () => false,
        getSwitchValue: () => {
          throw new Error("Unexpected switch value read.");
        },
      },
      "password-store",
    );

    assert.isNull(value);
  });

  it.effect("acquires a synchronous pre-ready layer before an asynchronous dependent layer", () =>
    Effect.gen(function* () {
      class DependentService extends Context.Service<DependentService, { readonly ready: true }>()(
        "@t3tools/desktop/app/DesktopPreReadyPlatform.test/DependentService",
      ) {}

      const events: Array<string> = [];
      registerSchemesMock.mockImplementation(() => {
        events.push("pre-ready");
      });

      const preReadyLayer = DesktopPreReadyPlatform.layer.pipe(
        Layer.provide(Layer.succeed(HostProcessPlatform, "darwin")),
      );

      const dependentLayer = Layer.effect(
        DependentService,
        Effect.promise(() => Promise.resolve()).pipe(
          Effect.map(() => {
            events.push("dependent");
            return { ready: true as const };
          }),
        ),
      );

      const runtimeLayer = dependentLayer.pipe(
        Layer.flatMap((dependentContext) => Layer.succeedContext(dependentContext)),
        Layer.provideMerge(preReadyLayer),
      );

      const result = yield* Effect.all({
        dependent: DependentService,
        preReady: DesktopPreReadyPlatform.DesktopPreReadyElectronOptions,
      }).pipe(Effect.provide(runtimeLayer));

      assert.deepEqual(result, {
        dependent: { ready: true },
        preReady: {
          linux: null,
          linuxPasswordStoreCommandLine: null,
        },
      });
      assert.deepEqual(events, ["pre-ready", "dependent"]);
      assert.equal(registerSchemesMock.mock.calls.length, 1);
      assert.equal(appendSwitchMock.mock.calls.length, 0);
    }),
  );
});
