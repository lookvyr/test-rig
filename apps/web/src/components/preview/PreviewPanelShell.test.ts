import { describe, expect, it } from "vite-plus/test";

import { getPreviewPanelMaxWidth } from "./PreviewPanelShell";

describe("getPreviewPanelMaxWidth", () => {
  it("allows the panel to use 70% of an ultra-wide viewport without a pixel ceiling", () => {
    expect(getPreviewPanelMaxWidth(6_000)).toBe(4_200);
  });

  it("rounds fractional CSS pixels down", () => {
    expect(getPreviewPanelMaxWidth(2_001)).toBe(1_400);
  });
  it("preserves the chat column when the app sidebar consumes part of the viewport", () => {
    expect(getPreviewPanelMaxWidth(1600, 1344)).toBe(984);
    expect(getPreviewPanelMaxWidth(1100, 844)).toBe(484);
  });
  it("reclamps on a narrower parent without inverting the panel limits", () => {
    expect(getPreviewPanelMaxWidth(1600, 1000)).toBe(640);
    expect(getPreviewPanelMaxWidth(600, 400)).toBe(360);
  });
});
