import { ThreadId, TurnItemId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  toolCallLines,
  turnItemDetailRevision,
  turnItemHasDetail,
  turnItemNeedsDetailFetch,
  turnItemOutputImages,
  turnItemOutputText,
} from "./itemDetail.ts";

const screenshot = {
  id: TurnItemId.make("tool-screenshot"),
  type: "dynamic_tool" as const,
  threadId: ThreadId.make("thread-1"),
  runId: null,
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal: 1,
  status: "completed" as const,
  title: null,
  toolName: "mcp__t3-code__device_screenshot",
  input: { deviceId: "phone" },
  // What a detail read returns: the image's position without its bytes.
  output: {
    content: [
      { type: "text", text: "Captured the home screen." },
      { type: "image", mimeType: "image/png" },
    ],
  },
  startedAt: DateTime.makeUnsafe("2026-10-05T00:00:00.000Z"),
  completedAt: DateTime.makeUnsafe("2026-10-05T00:00:01.000Z"),
  updatedAt: DateTime.makeUnsafe("2026-10-05T00:00:01.000Z"),
};

describe("tool output images", () => {
  it("shows a screenshot as an image asset, not as text", () => {
    expect(turnItemOutputImages(screenshot)).toEqual([
      {
        _tag: "tool-output-image",
        threadId: screenshot.threadId,
        itemId: screenshot.id,
        index: 0,
      },
    ]);
    expect(turnItemOutputText(screenshot)).toBe("Captured the home screen.");
    expect(
      turnItemOutputText({ ...screenshot, output: { content: [screenshot.output.content[1]] } }),
    ).toBeNull();
  });

  it("keeps a placeholder for images it cannot show", () => {
    const output = { content: [{ type: "image", mimeType: "image/svg+xml" }] };
    expect(turnItemOutputImages({ ...screenshot, output })).toEqual([]);
    expect(turnItemOutputText({ ...screenshot, output })).toBe("[image]");
  });
});

describe("expanded tool details", () => {
  it("fetches a PR watch result and formats its MCP text without the envelope", () => {
    const input = { url: "https://github.com/example/project/pull/42" };
    const result = { ...input, watching: true, wasWatching: false };
    const item = {
      ...screenshot,
      toolName: "mcp__test_rig__watch_pull_request",
      input,
      output: undefined,
      outputOmitted: true,
    };
    expect(turnItemHasDetail(item)).toBe(true);
    expect(turnItemNeedsDetailFetch(item)).toBe(true);
    expect(turnItemOutputText(item)).toBeNull();
    expect(toolCallLines({ args: input }).args).toEqual([["url", input.url]]);
    expect(
      turnItemOutputText({
        ...item,
        outputOmitted: undefined,
        output: {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
        },
      }),
    ).toBe(JSON.stringify(result, null, 2));
  });

  it("keeps one live fetch key, then refreshes on completion", () => {
    const running = { ...screenshot, status: "running" as const };
    const later = { ...running, updatedAt: DateTime.add(running.updatedAt, { seconds: 5 }) };
    expect(turnItemDetailRevision(running)).toBe(turnItemDetailRevision(later));
    expect(turnItemDetailRevision({ ...later, status: "completed" })).not.toBe(
      turnItemDetailRevision(running),
    );
  });

  it("only offers expansion for content, including withheld or summarized values", () => {
    const empty = { ...screenshot, input: {}, output: undefined };
    expect(turnItemHasDetail(empty)).toBe(false);
    expect(turnItemNeedsDetailFetch(empty)).toBe(false);
    expect(turnItemHasDetail({ ...empty, outputOmitted: true })).toBe(true);
    expect(
      turnItemNeedsDetailFetch({ ...empty, input: { summary: "Large input", truncated: true } }),
    ).toBe(true);
  });
});
