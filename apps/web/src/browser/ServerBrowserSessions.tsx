import { useEffect } from "react";
import { AsyncResult } from "effect/unstable/reactivity";
import { type EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useEnvironments } from "~/state/environments";
import { previewEnvironment } from "~/state/preview";
import { applyPreviewServerEvent, readThreadPreviewState } from "~/previewStateStore";
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
        const threadRef = { environmentId, threadId: ThreadId.make(event.threadId) };
        const snapshot =
          "snapshot" in event
            ? event.snapshot
            : readThreadPreviewState(threadRef).sessions[event.tabId];
        if (snapshot?.runtime !== "server") return;
        applyPreviewServerEvent(threadRef, event);
        if (event.type === "closed") {
          revealed.delete(event.tabId);
          return;
        }
        const reveal = snapshot.revealRequest?.id;
        if (reveal && revealed.get(event.tabId) !== reveal) {
          revealed.set(event.tabId, reveal);
          useRightPanelStore.getState().openBrowser(threadRef, event.tabId);
        }
      },
      { immediate: true },
    );
  }, [environmentId]);
  return null;
}
