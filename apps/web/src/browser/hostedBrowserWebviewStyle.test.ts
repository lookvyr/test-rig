import { RIGHT_PANEL_SHEET_LAYER } from "../rightPanelLayout";
import { describe, expect, it } from "vite-plus/test";

import {
  HIDDEN_BROWSER_WEBVIEW_OFFSET,
  resolveHostedBrowserWebviewWrapperStyle,
} from "./hostedBrowserWebviewStyle";

describe("resolveHostedBrowserWebviewWrapperStyle", () => {
  it("places an active webview on its presented surface", () => {
    expect(
      resolveHostedBrowserWebviewWrapperStyle({
        active: true,
        rect: { x: 12, y: 34, width: 800, height: 600 },
        hiddenSize: { width: 1280, height: 800 },
      }),
    ).toEqual({
      left: 12,
      top: 34,
      width: 800,
      height: 600,
      zIndex: 30,
      pointerEvents: "auto",
    });
  });

  it("clips a floating webview to the mini-player frame", () => {
    expect(
      resolveHostedBrowserWebviewWrapperStyle({
        active: true,
        cornerRadius: 12,
        rect: { x: 12, y: 34, width: 360, height: 203 },
        hiddenSize: { width: 1280, height: 800 },
      }),
    ).toMatchObject({
      left: 12,
      top: 34,
      width: 360,
      height: 203,
      borderRadius: 12,
    });
  });

  it("keeps an inactive webview paintable while moving it offscreen", () => {
    const style = resolveHostedBrowserWebviewWrapperStyle({
      active: false,
      rect: { x: 12, y: 34, width: 800, height: 600 },
      hiddenSize: { width: 393, height: 852 },
    });

    expect(style).toEqual({
      left: HIDDEN_BROWSER_WEBVIEW_OFFSET,
      top: HIDDEN_BROWSER_WEBVIEW_OFFSET,
      width: 393,
      height: 852,
      zIndex: -1,
      pointerEvents: "none",
      visibility: "visible",
    });
  });
});

it("presents a sheet-hosted guest above the sheet and below ordinary dialogs", () => {
  const style = resolveHostedBrowserWebviewWrapperStyle({
    active: true,
    zIndex: RIGHT_PANEL_SHEET_LAYER + 1,
    rect: { x: 400, y: 80, width: 450, height: 600 },
    hiddenSize: { width: 1280, height: 800 },
  });
  expect(style.zIndex).toBeGreaterThan(RIGHT_PANEL_SHEET_LAYER);
  expect(style.zIndex).toBeLessThan(50);
  expect(style.left).toBe(400);
  expect(style.top).toBe(80);
  expect(
    resolveHostedBrowserWebviewWrapperStyle({
      active: false,
      zIndex: RIGHT_PANEL_SHEET_LAYER + 1,
      rect: null,
      hiddenSize: { width: 1280, height: 800 },
    }).zIndex,
  ).toBe(-1);
});
