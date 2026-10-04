import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import { useMemo, useRef } from "react";
import {
  deriveTimelineEntriesFromVisibleTurnItemsWithState,
  type TimelineEntriesProjection,
} from "../../session-logic";
import type { ChatMessage } from "../../types";

/** Keep upstream streaming identities while supplying signed and optimistic image previews. */
export function useThreadTimeline(
  thread: OrchestrationV2ThreadProjection | null | undefined,
  messages: ReadonlyArray<ChatMessage>,
) {
  const previous = useRef<{
    threadId: string | undefined;
    projection: TimelineEntriesProjection;
  } | null>(null);
  return useMemo(() => {
    const committedIds = new Set(
      thread?.visibleTurnItems.flatMap(({ item }) =>
        item.type === "user_message" || item.type === "assistant_message" ? [item.messageId] : [],
      ),
    );
    const attachmentUrlById = new Map<string, string>();
    for (const message of messages) {
      for (const attachment of message.attachments ?? []) {
        if (attachment.previewUrl) attachmentUrlById.set(attachment.id, attachment.previewUrl);
      }
    }
    const projection = deriveTimelineEntriesFromVisibleTurnItemsWithState(
      {
        visibleTurnItems: thread?.visibleTurnItems ?? [],
        optimisticMessages: messages.filter((message) => !committedIds.has(message.id)),
        attachmentUrlById,
        attempts: thread?.attempts ?? [],
        nodes: thread?.nodes ?? [],
        plans: thread?.plans ?? [],
      },
      previous.current?.threadId === thread?.thread.id ? previous.current?.projection : null,
    );
    previous.current = { threadId: thread?.thread.id, projection };
    return projection.entries;
  }, [thread, messages]);
}
