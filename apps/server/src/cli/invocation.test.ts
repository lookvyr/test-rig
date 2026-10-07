import { expect, it } from "@effect/vitest";
import {
  HostProcessArguments,
  HostProcessExecutablePath,
  HostProcessWorkingDirectory,
} from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import { resolveRootCliCommand } from "./invocation.ts";

it.effect(
  "keeps custom homes and source entrypoints intact under sudo, including shell metacharacters",
  () =>
    Effect.gen(function* () {
      const command = yield* resolveRootCliCommand("browser setup", "/data/rig's $(home)");
      expect(command).toBe(
        "sudo env ELECTRON_RUN_AS_NODE=1 '/opt/Test Rig/node' '/repo/apps/server/src/bin.ts' browser setup --base-dir '/data/rig'\\''s $(home)'",
      );
    }).pipe(
      Effect.provideService(HostProcessArguments, ["node", "src/bin.ts"]),
      Effect.provideService(HostProcessExecutablePath, "/opt/Test Rig/node"),
      Effect.provideService(HostProcessWorkingDirectory, "/repo/apps/server"),
      Effect.provide(Path.layer),
    ),
);
