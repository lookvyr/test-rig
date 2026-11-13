import type { ScopedThreadRef } from "@t3tools/contracts";
import { MessageSquareIcon } from "lucide-react";
import { useMemo } from "react";

import { useRightPanelStore } from "../../rightPanelStore";
import { useThreadShells } from "../../state/entities";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadDetailsSection } from "./ThreadDetailsSection";

/** A thread's side chats, which never appear in the sidebar. Choosing one opens its tab. */
export function ThreadSideChatsPanel(props: { threadRef: ScopedThreadRef }) {
  const { threadRef } = props;
  const shells = useThreadShells();
  const sideChats = useMemo(
    () =>
      shells
        .filter(
          (thread) =>
            thread.environmentId === threadRef.environmentId &&
            thread.sideOfThreadId === threadRef.threadId,
        )
        .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt)),
    [shells, threadRef.environmentId, threadRef.threadId],
  );
  if (sideChats.length === 0) return null;
  const runningCount = sideChats.filter((thread) => thread.source.activityRunStatus != null).length;
  return (
    <ThreadDetailsSection
      headingId="thread-details-side-chats"
      title={`Side chats${runningCount > 0 ? ` · ${runningCount} running` : ""}`}
    >
      {sideChats.map((thread) => {
        const waiting = thread.hasPendingApprovals || thread.hasPendingUserInput;
        const running = thread.source.activityRunStatus != null;
        return (
          <ThreadDetailsControl
            key={thread.id}
            title={thread.title}
            onClick={() => useRightPanelStore.getState().openSideChat(threadRef, thread.id)}
          >
            <MessageSquareIcon />
            <span className="min-w-0 flex-1 truncate text-left">{thread.title}</span>
            {waiting ? (
              <span className="shrink-0 text-2xs text-info">Needs you</span>
            ) : running ? (
              <span className="shrink-0 text-2xs text-muted-foreground">Working</span>
            ) : null}
          </ThreadDetailsControl>
        );
      })}
    </ThreadDetailsSection>
  );
}
