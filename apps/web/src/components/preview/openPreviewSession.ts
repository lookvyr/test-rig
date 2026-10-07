import type {
  EnvironmentId,
  PreviewOpenInput,
  PreviewViewportSetting,
  PreviewSessionSnapshot,
  ScopedThreadRef,
} from "@t3tools/contracts";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";

import { ensureClientSettingsHydrated } from "~/hooks/useSettings";
import { browserDefaultOpenProfileId } from "~/browser/browserDefaults";

import { applyPreviewServerSnapshot, rememberPreviewUrl } from "~/previewStateStore";

interface OpenPreviewSessionInput<E> {
  openPreview: (input: {
    readonly environmentId: EnvironmentId;
    readonly input: PreviewOpenInput;
  }) => Promise<AtomCommandResult<PreviewSessionSnapshot, E>>;
  threadRef: ScopedThreadRef;
  url?: string;
  profileId?: string;
  viewport?: PreviewViewportSetting;
}

export async function openPreviewSession<E>(
  input: OpenPreviewSessionInput<E>,
): Promise<AtomCommandResult<PreviewSessionSnapshot, E>> {
  if (input.profileId === undefined) await ensureClientSettingsHydrated();
  const result = await input.openPreview({
    environmentId: input.threadRef.environmentId,
    input: {
      threadId: input.threadRef.threadId,
      profileId: input.profileId ?? browserDefaultOpenProfileId(),
      ...(input.viewport === undefined ? {} : { viewport: input.viewport }),
      ...(input.url === undefined ? {} : { url: input.url }),
    },
  });
  if (result._tag === "Failure") {
    return result;
  }
  const snapshot = result.value;
  applyPreviewServerSnapshot(input.threadRef, snapshot);
  if (input.url !== undefined) {
    rememberPreviewUrl(
      input.threadRef,
      snapshot.navStatus._tag === "Idle" ? input.url : snapshot.navStatus.url,
    );
  }
  return result;
}
