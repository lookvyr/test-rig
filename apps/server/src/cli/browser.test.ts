import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  HostProcessEnvironment,
  HostProcessPlatform,
  HostProcessUserId,
} from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { Command } from "effect/unstable/cli";
import { ChildProcessSpawner } from "effect/unstable/process";
import { browserCommand } from "./browser.ts";
import { APPARMOR_PROFILE_PATH } from "../preview/PreviewBrowserHost.ts";

it.effect("removes a profile when loading fails so the next setup retries", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    let profileExists = false;
    let loads = 0;
    const dependencies = Layer.mergeAll(
      Layer.succeed(FileSystem.FileSystem, {
        ...fs,
        readFileString: () => Effect.succeed("1"),
        readDirectory: () => Effect.succeed([]),
        exists: (path) => Effect.succeed(path === APPARMOR_PROFILE_PATH && profileExists),
        writeFileString: (path) =>
          Effect.sync(() => {
            expect(path).toBe(APPARMOR_PROFILE_PATH);
            profileExists = true;
          }),
        remove: (path) =>
          Effect.sync(() => {
            expect(path).toBe(APPARMOR_PROFILE_PATH);
            profileExists = false;
          }),
      }),
      Layer.mock(ChildProcessSpawner.ChildProcessSpawner)({
        exitCode: () =>
          Effect.sync(() => {
            loads++;
            return ChildProcessSpawner.ExitCode(1);
          }),
      }),
    );
    const run = Command.runWith(browserCommand, { version: "test" })([
      "setup",
      "--base-dir",
      "/custom/rig",
    ]).pipe(Effect.provide(dependencies), Effect.flip);
    expect((yield* run)._tag).toBe("BrowserSetupStepError");
    expect(profileExists).toBe(false);
    expect((yield* run)._tag).toBe("BrowserSetupStepError");
    expect(loads).toBe(2);
  }).pipe(
    Effect.provideService(HostProcessPlatform, "linux"),
    Effect.provideService(HostProcessUserId, 0),
    Effect.provideService(HostProcessEnvironment, {}),
    Effect.provide(NodeServices.layer),
  ),
);
