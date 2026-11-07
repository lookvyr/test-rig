import type { ScopedThreadRef } from "@t3tools/contracts";
import type { MouseEvent } from "react";
import { readLocalApi } from "../localApi";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { useThreadShell } from "../state/entities";
import { resolveThreadCurrentPullRequestLink } from "@t3tools/shared/threadPullRequests";
import { useRightPanelStore } from "../rightPanelStore";

export function useUnlinkPullRequest(threadRef: ScopedThreadRef | null) {
  const thread = useThreadShell(threadRef);
  const unlink = useAtomCommand(threadEnvironment.unlinkPullRequest);
  return async (event: MouseEvent) => {
    if (!threadRef) return;
    event.preventDefault();
    event.stopPropagation();
    const link = resolveThreadCurrentPullRequestLink(thread?.pullRequests ?? []);
    const selected = await readLocalApi()?.contextMenu.show(
      [
        { id: "manage", label: "Manage linked PRs" },
        ...(link ? [{ id: "unlink", label: `Unlink PR #${link.number}` }] : []),
      ],
      { x: event.clientX, y: event.clientY },
    );
    if (selected === "manage") useRightPanelStore.getState().open(threadRef, "pull-request");
    if (selected === "unlink" && link) {
      await unlink({
        environmentId: threadRef.environmentId,
        input: {
          threadId: threadRef.threadId,
          host: link.host,
          repository: link.repository,
          number: link.number,
        },
      });
    }
  };
}
