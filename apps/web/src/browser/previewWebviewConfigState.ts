import { DEFAULT_BROWSER_PROFILE_ID } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import type {
  DesktopPreviewBridge,
  DesktopPreviewWebviewConfig,
  EnvironmentId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { previewBridge } from "~/components/preview/previewBridge";

const PREVIEW_CONFIG_STALE_TIME_MS = 5 * 60_000;
const PREVIEW_CONFIG_IDLE_TTL_MS = 10 * 60_000;

export class PreviewWebviewBridgeUnavailableError extends Schema.TaggedError<PreviewWebviewBridgeUnavailableError>()(
  "PreviewWebviewBridgeUnavailableError",
  { environmentId: Schema.String },
) {
  override get message(): string {
    return `Desktop preview configuration is unavailable for environment "${this.environmentId}".`;
  }
}

export class PreviewWebviewConfigLoadError extends Schema.TaggedError<PreviewWebviewConfigLoadError>()(
  "PreviewWebviewConfigLoadError",
  {
    environmentId: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to load desktop preview configuration for environment "${this.environmentId}".`;
  }
}

export const PreviewWebviewConfigError = Schema.Union([
  PreviewWebviewBridgeUnavailableError,
  PreviewWebviewConfigLoadError,
]);
export type PreviewWebviewConfigError = typeof PreviewWebviewConfigError.Type;

type PreviewConfigBridge = Pick<DesktopPreviewBridge, "getPreviewConfig">;

export const loadPreviewWebviewConfig = (
  environmentId: EnvironmentId,
  bridge: PreviewConfigBridge | null = previewBridge,
  profileId = DEFAULT_BROWSER_PROFILE_ID,
): Effect.Effect<DesktopPreviewWebviewConfig, PreviewWebviewConfigError> => {
  if (bridge === null) {
    return Effect.fail(new PreviewWebviewBridgeUnavailableError({ environmentId }));
  }

  return Effect.tryPromise({
    try: () => bridge.getPreviewConfig(environmentId, profileId),
    catch: (cause) => new PreviewWebviewConfigLoadError({ environmentId, cause }),
  });
};

const previewWebviewConfigAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.family((profileId: string) =>
    Atom.make(loadPreviewWebviewConfig(environmentId, previewBridge, profileId)).pipe(
      Atom.swr({
        staleTime: PREVIEW_CONFIG_STALE_TIME_MS,
        revalidateOnMount: true,
      }),
      Atom.setIdleTTL(PREVIEW_CONFIG_IDLE_TTL_MS),
      Atom.withLabel(`preview:webview-config:${environmentId}:${profileId}`),
    ),
  ),
);

export function usePreviewWebviewConfig(
  environmentId: EnvironmentId,
  profileId = DEFAULT_BROWSER_PROFILE_ID,
): DesktopPreviewWebviewConfig | null {
  const result = useAtomValue(previewWebviewConfigAtom(environmentId)(profileId));
  return Option.getOrNull(AsyncResult.value(result));
}
