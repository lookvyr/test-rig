import type {
  OrchestrationV2GetThreadSearchContextInput,
  OrchestrationV2SearchThreadMessagesInput,
  OrchestrationV2ThreadSearchMessage,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { ThreadManagementService } from "./ThreadManagementService.ts";
import {
  buildBoundedThreadProjection,
  THREAD_HISTORY_SNAPSHOT_ROW_LIMIT,
} from "./threadHistoryPaging.ts";
import { projectThreadProjectionForWire } from "./WireProjection.ts";

/** Find scans a bounded message page, never provider logs or tool payloads. */
export const makeThreadFind = Effect.gen(function* () {
  const threads = yield* ThreadManagementService;
  const search = Effect.fn("ThreadFind.search")(function* (
    input: OrchestrationV2SearchThreadMessagesInput,
  ) {
    yield* threads.ensureLegacyTranscript(input.threadId);
    const page = yield* threads.getTimelinePage(input.threadId, {
      view: "messages",
      limit: 100,
      ...(input.cursor === undefined ? {} : { afterPosition: input.cursor }),
    });
    const words = input.query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const messages: OrchestrationV2ThreadSearchMessage[] = [];
    for (const row of page.items) {
      const item = row.item;
      if (item.type !== "user_message" && item.type !== "assistant_message") continue;
      // Markdown can split a rendered match. The client applies its existing
      // rendered-text matcher to these candidates before counting highlights.
      const text = item.text.toLocaleLowerCase();
      if (!words.every((word) => text.includes(word)) && !/[*_`~[<&\\]/.test(item.text)) continue;
      messages.push({
        id: item.messageId,
        sourceThreadId: row.sourceThreadId,
        sourceItemId: row.sourceItemId,
        position: row.position,
        role: item.type === "user_message" ? "user" : "assistant",
        text: item.text,
        createdAt: item.startedAt ?? item.updatedAt,
      });
    }
    return {
      messages,
      truncated: page.hasMore,
      nextCursor: page.hasMore ? (page.items.at(-1)?.position ?? null) : null,
    };
  });
  const getContext = Effect.fn("ThreadFind.getContext")(function* (
    input: OrchestrationV2GetThreadSearchContextInput,
  ) {
    const snapshot = yield* threads.getThreadSnapshotWindow(input.threadId, {
      rowLimit: THREAD_HISTORY_SNAPSHOT_ROW_LIMIT,
      anchorThreadId: input.sourceThreadId,
      anchorItemId: input.sourceItemId,
    });
    return {
      snapshotSequence: snapshot.snapshotSequence,
      ...buildBoundedThreadProjection({
        projection: projectThreadProjectionForWire(snapshot.projection),
        snapshotSequence: snapshot.snapshotSequence,
      }),
    };
  });
  return { search, getContext };
});
