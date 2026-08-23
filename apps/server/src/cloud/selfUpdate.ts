import {
  ServerSelfUpdateError,
  type ServerSelfUpdateCapability,
  type ServerSelfUpdateInput,
  type ServerSelfUpdateProgressStage,
  type ServerSelfUpdateResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";

export function resolveServerSelfUpdateCapability(
  desktopManaged: boolean,
): ServerSelfUpdateCapability | null {
  return desktopManaged ? ("desktop-managed" as const) : null;
}

export class ServerSelfUpdate extends Context.Service<
  ServerSelfUpdate,
  {
    readonly update: (
      input: ServerSelfUpdateInput,
      reportProgress?: (stage: ServerSelfUpdateProgressStage) => Effect.Effect<void>,
    ) => Effect.Effect<ServerSelfUpdateResult, ServerSelfUpdateError>;
  }
>()("t3/cloud/selfUpdate/ServerSelfUpdate") {}

export const make = Effect.fn("cloud.server_self_update.make")(function* () {
  const serverConfig = yield* ServerConfig.ServerConfig;
  const reason =
    serverConfig.mode === "desktop"
      ? "This server is managed by the Sightseer desktop app on its machine; rebuild and relaunch the desktop app to update it."
      : "Automated server updates are unavailable in source-only builds. Rebuild and relaunch the server from its source checkout.";

  return ServerSelfUpdate.of({
    update: () => Effect.fail(new ServerSelfUpdateError({ reason })),
  });
});

export const layer = Layer.effect(ServerSelfUpdate, make());
