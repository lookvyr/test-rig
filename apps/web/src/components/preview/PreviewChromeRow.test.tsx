import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { PreviewChromeRow, type PreviewCaptureState } from "./PreviewChromeRow";

const navigation = {
  url: "https://example.com",
  loading: false,
  loadProgress: 0,
  canGoBack: false,
  canGoForward: false,
  refreshDisabled: false,
  onBack: vi.fn(),
  onForward: vi.fn(),
  onRefresh: vi.fn(),
  onSubmit: vi.fn(),
};

describe("PreviewChromeRow", () => {
  it("shows the complete URL while the address bar is not focused", () => {
    const markup = renderToStaticMarkup(
      <PreviewChromeRow
        url="https://example.com/dashboard?mode=edit&tab=1#notes"
        loading={false}
        loadProgress={0}
        canGoBack={false}
        canGoForward={false}
        refreshDisabled={false}
        onBack={vi.fn()}
        onForward={vi.fn()}
        onRefresh={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(markup).toContain('value="https://example.com/dashboard?mode=edit&amp;tab=1#notes"');
  });

  it("offers a discoverable capture menu", () => {
    const markup = renderToStaticMarkup(<PreviewChromeRow {...navigation} onCapture={vi.fn()} />);

    expect(markup).toContain('aria-label="Capture screenshot or video"');
    expect(markup).toContain('aria-haspopup="menu"');
    expect(markup).not.toContain("Shift-click");
  });

  it.each([
    ["capturing", "Saving screenshot", "Saving…"],
    ["starting", "Starting recording", "Starting…"],
    ["stopping", "Saving recording", "Saving…"],
  ] satisfies [PreviewCaptureState, string, string][])(
    "disables duplicate actions while %s",
    (captureState, label, text) => {
      const markup = renderToStaticMarkup(
        <PreviewChromeRow {...navigation} onCapture={vi.fn()} captureState={captureState} />,
      );
      const action = markup.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0];

      expect(action).toMatch(/\sdisabled(?:=|[ >])/);
      expect(markup).toContain(text);
      expect(markup).not.toContain('aria-label="Capture screenshot or video"');
    },
  );

  it("keeps Stop available when navigation makes new captures unavailable", () => {
    const markup = renderToStaticMarkup(
      <PreviewChromeRow
        {...navigation}
        onCapture={vi.fn()}
        captureState="recording"
        captureDisabled
      />,
    );
    const action = markup.match(/<button[^>]*aria-label="Stop recording"[^>]*>/)?.[0];

    expect(action).toBeDefined();
    expect(action).not.toMatch(/\sdisabled(?:=|[ >])/);
    expect(markup).toContain("Stop");
  });
});
