import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import * as ServerConfig from "../config.ts";
import * as ServerSelfUpdate from "./selfUpdate.ts";

const makeSelfUpdate = (mode: "web" | "desktop") =>
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig.pipe(
      Effect.provide(ServerConfig.layerTest(process.cwd(), "/tmp/sightseer-self-update-test")),
    );
    return yield* ServerSelfUpdate.make().pipe(
      Effect.provide(ServerConfig.layer({ ...config, mode })),
    );
  });

it.layer(NodeServices.layer)("source-only server update boundary", (it) => {
  it.effect("rejects package-backed updates for source-built servers", () =>
    Effect.gen(function* () {
      const selfUpdate = yield* makeSelfUpdate("web");
      const error = yield* selfUpdate.update({ targetVersion: "1.1.0" }).pipe(Effect.flip);

      expect(error.reason).toContain("unavailable in source-only builds");
    }),
  );

  it.effect("directs desktop-managed servers back to the desktop source build", () =>
    Effect.gen(function* () {
      const selfUpdate = yield* makeSelfUpdate("desktop");
      const error = yield* selfUpdate.update({ targetVersion: "1.1.0" }).pipe(Effect.flip);

      expect(error.reason).toContain("rebuild and relaunch the desktop app");
    }),
  );
});
