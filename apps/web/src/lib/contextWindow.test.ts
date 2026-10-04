import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind, TurnItemId, type OrchestrationV2TurnItem } from "@t3tools/contracts";
import { v2Now, v2ThreadId } from "../test/threadFixtures";
import { deriveLatestContextWindowSnapshot, formatContextWindowTokens } from "./contextWindow";

const compaction = (afterTokenCount: number | undefined): OrchestrationV2TurnItem => ({
  id: TurnItemId.make("compaction"),
  threadId: v2ThreadId,
  runId: null,
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal: 0,
  status: "completed",
  title: null,
  startedAt: v2Now,
  completedAt: v2Now,
  updatedAt: v2Now,
  type: "compaction",
  driver: ProviderDriverKind.make("codex"),
  beforeTokenCount: 100_000,
  afterTokenCount,
});

describe("contextWindow", () => {
  it("uses current turn usage ahead of previous provider and compaction data", () => {
    const snapshot = deriveLatestContextWindowSnapshot(
      [{ item: compaction(2_000) }],
      {
        usedTokens: 14_000,
        maxTokens: 258_000,
        updatedAt: "2026-06-20T00:00:00.000Z",
      },
      { contextUsage: { usedTokens: 1_000 }, updatedAt: v2Now },
    );
    expect(snapshot).toMatchObject({
      usedTokens: 14_000,
      maxTokens: 258_000,
      compactsAutomatically: true,
    });
  });

  it("keeps durable provider usage after the active turn is unloaded", () => {
    const snapshot = deriveLatestContextWindowSnapshot([], null, {
      contextUsage: { usedTokens: 81_659, totalProcessedTokens: 748_126, maxTokens: 258_400 },
      updatedAt: v2Now,
    });
    expect(snapshot).toMatchObject({
      usedTokens: 81_659,
      totalProcessedTokens: 748_126,
      maxTokens: 258_400,
    });
  });

  it("ignores compactions without valid token counts", () => {
    expect(deriveLatestContextWindowSnapshot([{ item: compaction(undefined) }])).toBeNull();
    expect(deriveLatestContextWindowSnapshot([{ item: compaction(-1) }])).toBeNull();
  });

  it("keeps valid zero-usage snapshots", () => {
    expect(
      deriveLatestContextWindowSnapshot([], {
        usedTokens: 0,
        maxTokens: 100_000,
        updatedAt: "2026-06-20T00:00:00.000Z",
      }),
    ).toMatchObject({
      usedTokens: 0,
      maxTokens: 100_000,
      remainingTokens: 100_000,
      usedPercentage: 0,
      remainingPercentage: 100,
    });
  });

  it("falls back to the newest completed compaction", () => {
    expect(
      deriveLatestContextWindowSnapshot([{ item: compaction(1_000) }, { item: compaction(2_000) }]),
    ).toMatchObject({ usedTokens: 2_000, totalProcessedTokens: 100_000, maxTokens: null });
  });

  it("formats compact token counts", () => {
    expect(formatContextWindowTokens(999)).toBe("999");
    expect(formatContextWindowTokens(1400)).toBe("1.4k");
    expect(formatContextWindowTokens(14_000)).toBe("14k");
    expect(formatContextWindowTokens(258_000)).toBe("258k");
  });
});
