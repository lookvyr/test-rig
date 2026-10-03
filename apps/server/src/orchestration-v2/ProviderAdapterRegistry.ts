import { ProviderInstanceId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { ProviderInstanceRegistry } from "../provider/Services/ProviderInstanceRegistry.ts";
import type { ProviderAdapterV2Shape } from "./ProviderAdapter.ts";

export class ProviderAdapterRegistryLookupError extends Schema.TaggedErrorClass<ProviderAdapterRegistryLookupError>()(
  "ProviderAdapterRegistryLookupError",
  { instanceId: ProviderInstanceId },
) {
  override get message() {
    return `No enabled V2 provider adapter is registered for ${this.instanceId}.`;
  }
}

export class ProviderAdapterRegistryV2 extends Context.Service<
  ProviderAdapterRegistryV2,
  {
    readonly get: (
      instanceId: ProviderInstanceId,
    ) => Effect.Effect<ProviderAdapterV2Shape, ProviderAdapterRegistryLookupError>;
    readonly list: () => Effect.Effect<ReadonlyArray<ProviderInstanceId>>;
  }
>()("t3/orchestration-v2/ProviderAdapterRegistry/ProviderAdapterRegistryV2") {}

/** Reuse the existing registry's lifecycle and settings subscription. */
export const layerFromProviderInstanceRegistry = Layer.effect(
  ProviderAdapterRegistryV2,
  Effect.gen(function* () {
    const instances = yield* ProviderInstanceRegistry;
    return ProviderAdapterRegistryV2.of({
      get: (instanceId) =>
        Effect.gen(function* () {
          const instance = yield* instances.getInstance(instanceId);
          if (!instance?.enabled || !instance.orchestrationAdapter)
            return yield* new ProviderAdapterRegistryLookupError({ instanceId });
          return instance.orchestrationAdapter;
        }),
      list: () =>
        instances.listInstances.pipe(
          Effect.map((entries) =>
            entries
              .filter((entry) => entry.enabled && entry.orchestrationAdapter !== undefined)
              .map((entry) => entry.instanceId),
          ),
        ),
    });
  }),
);
