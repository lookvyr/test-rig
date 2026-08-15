import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Stream from "effect/Stream";

export interface ProviderSnapshotSettings<Settings> {
  readonly provider: Settings;
}

export function makeProviderSnapshotSettings<Settings>(provider: Settings) {
  return { provider } satisfies ProviderSnapshotSettings<Settings>;
}

export function haveProviderSnapshotSettingsChanged<Settings>(
  previous: ProviderSnapshotSettings<Settings>,
  next: ProviderSnapshotSettings<Settings>,
): boolean {
  return !Equal.equals(previous, next);
}

export function makeProviderSnapshotSettingsSource<Settings>(provider: Settings): {
  readonly getSettings: Effect.Effect<ProviderSnapshotSettings<Settings>>;
  readonly streamSettings: Stream.Stream<ProviderSnapshotSettings<Settings>>;
} {
  const settings = makeProviderSnapshotSettings(provider);
  return {
    getSettings: Effect.succeed(settings),
    streamSettings: Stream.empty,
  };
}
