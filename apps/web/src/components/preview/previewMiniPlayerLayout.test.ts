import { describe, expect, it } from "vite-plus/test";

import {
  clampPreviewMiniPlayerPosition,
  resolvePreviewMiniPlayerFrame,
  resolvePreviewMiniPlayerSourceSize,
  resizePreviewMiniPlayer,
  PREVIEW_MINI_PLAYER_EDGE_GAP,
} from "./previewMiniPlayerLayout";

describe("clampPreviewMiniPlayerPosition", () => {
  it("keeps a dragged player within the chat viewport", () => {
    expect(
      clampPreviewMiniPlayerPosition(
        { x: 900, y: -40 },
        { width: 1_000, height: 700 },
        { width: 360, height: 240 },
      ),
    ).toEqual({
      x: 628,
      y: PREVIEW_MINI_PLAYER_EDGE_GAP,
    });
  });

  it("keeps an edge gap when the player is larger than its container", () => {
    expect(
      clampPreviewMiniPlayerPosition(
        { x: 20, y: 30 },
        { width: 200, height: 160 },
        { width: 360, height: 240 },
      ),
    ).toEqual({
      x: PREVIEW_MINI_PLAYER_EDGE_GAP,
      y: PREVIEW_MINI_PLAYER_EDGE_GAP,
    });
  });

  it("keeps the player above a growing composer inset", () => {
    expect(
      clampPreviewMiniPlayerPosition(
        { x: 500, y: 448 },
        { width: 1_000, height: 700 },
        { width: 360, height: 240 },
        { composer: { left: 0, right: 1000, height: 160 }, detailsCard: null },
      ),
    ).toEqual({
      x: 500,
      y: 288,
    });
  });
});

describe("resolvePreviewMiniPlayerFrame", () => {
  it("keeps portrait browser content portrait and can enlarge from the top-left corner", () => {
    const source = resolvePreviewMiniPlayerSourceSize(
      { _tag: "freeform", width: 390, height: 844 },
      null,
      1,
    );
    const start = { x: 1000, y: 400, width: 240, height: 519 };
    const grown = resizePreviewMiniPlayer({
      start,
      direction: "northwest",
      delta: { x: -70, y: -150 },
      source,
      container: { width: 1600, height: 1000 },
    });
    expect(grown.width).toBeGreaterThan(start.width);
    expect(grown.width / grown.height).toBeCloseTo(390 / 844, 2);
    expect(grown.x + grown.width).toBe(start.x + start.width);
    expect(grown.y + grown.height).toBe(start.y + start.height);
  });
  it("fits an oversized player above the composer without changing the stored size", () => {
    const stored = { width: 1000, position: null, source: { width: 1600, height: 1000 } };
    const small = resolvePreviewMiniPlayerFrame({
      ...stored,
      container: { width: 500, height: 500 },
      obstacles: { composer: { left: 0, right: 500, height: 160 }, detailsCard: null },
    });
    expect(small.y + small.height).toBeLessThanOrEqual(340);
    expect(small.x + small.width).toBeLessThanOrEqual(500);
    const restored = resolvePreviewMiniPlayerFrame({
      ...stored,
      container: { width: 1600, height: 1000 },
    });
    expect(restored.width).toBe(1000);
    expect(stored.width).toBe(1000);
  });
  it("lets a tiny container win over the preferred minimum", () => {
    const frame = resolvePreviewMiniPlayerFrame({
      width: 360,
      position: null,
      source: { width: 360, height: 240 },
      container: { width: 250, height: 180 },
      obstacles: { composer: { left: 0, right: 250, height: 20 }, detailsCard: null },
    });
    expect(frame.width).toBeLessThan(240);
    expect(frame.y + frame.height).toBeLessThanOrEqual(160);
  });
});
