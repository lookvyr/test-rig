import { useEffect } from "react";
import { AsyncResult } from "effect/unstable/reactivity";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  type EnvironmentId,
  type PreviewSessionSnapshot,
  type ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import { getClientSettings } from "~/hooks/useSettings";
import { primaryEnvironmentIdAtom } from "~/state/primaryEnvironment";
import { rendersServerTabNatively } from "./previewRuntime";
import { useEnvironments } from "~/state/environments";
import { previewEnvironment } from "~/state/preview";
import { usePreviewMiniPlayerStore } from "~/previewMiniPlayerStore";
import { useRightPanelStore } from "~/rightPanelStore";
import { appAtomRegistry } from "~/rpc/atomRegistry";

export function ServerBrowserSessions() {
  const { environments } = useEnvironments();
  return (
    <>
      {environments.map(({ environmentId }) => (
        <EnvironmentBrowserSessions key={environmentId} environmentId={environmentId} />
      ))}
    </>
  );
}
function EnvironmentBrowserSessions({ environmentId }: { environmentId: EnvironmentId }) {
  useEffect(() => {
    const revealed = new Map<string, string>();
    return appAtomRegistry.subscribe(
      previewEnvironment.events({ environmentId, input: {} }),
      (result) => {
        if (!AsyncResult.isSuccess(result)) return;
        const event = result.value;
        // Per-thread preview syncs apply events; this only presents reveals, even for threads
        // that are not open.
        if (event.type === "closed") {
          revealed.delete(event.tabId);
          return;
        }
        if (!("snapshot" in event) || event.snapshot.runtime !== "server") return;
        const snapshot = event.snapshot;
        const threadRef = { environmentId, threadId: ThreadId.make(event.threadId) };
        const reveal = snapshot.revealRequest?.id;
        if (reveal && revealed.get(event.tabId) !== reveal) {
          revealed.set(event.tabId, reveal);
          revealServerTab(threadRef, snapshot);
        }
      },
      { immediate: true },
    );
  }, [environmentId]);
  return null;
}

/**
 * Shows a tab an agent or another client revealed, unless the open panel already shows it. The
 * floating player only shows tabs this desktop renders itself, so streamed tabs open in the
 * panel. A forced reveal, or floating previews turned off, focuses the panel instead.
 */
export function revealServerTab(threadRef: ScopedThreadRef, snapshot: PreviewSessionSnapshot) {
  const rightPanel = useRightPanelStore.getState();
  const panel = rightPanel.byThreadKey[scopedThreadKey(threadRef)];
  const shownInPanel =
    panel?.isOpen === true &&
    panel.surfaces.some(
      (surface) =>
        surface.id === panel.activeSurfaceId &&
        surface.kind === "preview" &&
        surface.resourceId === snapshot.tabId,
    );
  if (shownInPanel) return;
  const floats =
    snapshot.revealRequest?.force !== true &&
    getClientSettings().browserAutoShowFloatingPreview &&
    rendersServerTabNatively(
      threadRef.environmentId,
      appAtomRegistry.get(primaryEnvironmentIdAtom),
      snapshot,
    );
  if (floats) usePreviewMiniPlayerStore.getState().open(threadRef, snapshot.tabId);
  else rightPanel.openBrowser(threadRef, snapshot.tabId);
}
