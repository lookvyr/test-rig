import { type ProviderInstanceId, type ServerProviderWorkspaceCatalog } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { ProviderInstance } from "./ProviderDriver.ts";

/** Read workspace inventory without refreshing or publishing environment health. */
export const readProviderWorkspaceCatalog = Effect.fn("readProviderWorkspaceCatalog")(function* (
  input: { readonly instanceId: ProviderInstanceId; readonly cwd: string },
  getInstance: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<Pick<ProviderInstance, "enabled" | "getWorkspaceCatalog"> | undefined>,
): Effect.fn.Return<ServerProviderWorkspaceCatalog> {
  const instance = yield* getInstance(input.instanceId);
  if (!instance?.enabled || !instance.getWorkspaceCatalog || input.cwd.trim().length === 0) {
    return { skills: [], slashCommands: [] };
  }
  return yield* instance.getWorkspaceCatalog(input.cwd);
});
