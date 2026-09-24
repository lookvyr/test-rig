import type { ScopedThreadRef } from "@t3tools/contracts";
import type { MouseEvent } from "react";
import { readLocalApi } from "../localApi";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";

export function useUnlinkPullRequest(threadRef: ScopedThreadRef | null) {
  const updateMetadata = useAtomCommand(threadEnvironment.updateMetadata);
  return async (event: MouseEvent) => {
    if (!threadRef) return;
    event.preventDefault();
    event.stopPropagation();
    const selected = await readLocalApi()?.contextMenu.show(
      [{ id: "unlink", label: "Unlink PR from thread" }],
      { x: event.clientX, y: event.clientY },
    );
    if (selected === "unlink") {
      await updateMetadata({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, pullRequestAssociation: { mode: "unlinked" } },
      });
    }
  };
}
