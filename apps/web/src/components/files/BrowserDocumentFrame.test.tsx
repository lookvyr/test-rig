import { HTML_RENDER_ESCAPE_MESSAGE } from "@t3tools/shared/htmlRender";
import { act } from "react";
import { create } from "react-test-renderer";
import { expect, it, vi } from "vite-plus/test";

import { HtmlRenderDocument } from "./BrowserDocumentFrame";

vi.mock("~/hooks/useHtmlRenderTheme", () => ({
  useHtmlRenderTheme: () => ({ appearance: "dark", variables: {} }),
}));

it("accepts Escape only from its own frame while the viewer requests it", () => {
  const listeners = new Set<(event: { data: unknown; source: unknown }) => void>();
  const contentWindow = { postMessage: vi.fn() };
  vi.stubGlobal("window", {
    addEventListener: (_: string, listener: (event: { data: unknown; source: unknown }) => void) =>
      listeners.add(listener),
    removeEventListener: (
      _: string,
      listener: (event: { data: unknown; source: unknown }) => void,
    ) => listeners.delete(listener),
  });
  const onEscape = vi.fn();
  const message = (source: unknown, data: unknown) =>
    act(() => listeners.forEach((listener) => listener({ source, data })));
  let renderer: ReturnType<typeof create> | undefined;
  try {
    act(() => {
      renderer = create(<HtmlRenderDocument src="/page.html" title="Chart" onEscape={onEscape} />, {
        createNodeMock: () => ({ contentWindow }),
      });
    });
    message({}, HTML_RENDER_ESCAPE_MESSAGE);
    message(contentWindow, "unrelated");
    expect(onEscape).not.toHaveBeenCalled();
    message(contentWindow, HTML_RENDER_ESCAPE_MESSAGE);
    expect(onEscape).toHaveBeenCalledOnce();
    act(() => renderer!.update(<HtmlRenderDocument src="/page.html" title="Chart" />));
    message(contentWindow, HTML_RENDER_ESCAPE_MESSAGE);
    expect(onEscape).toHaveBeenCalledOnce();
  } finally {
    act(() => renderer?.unmount());
    vi.unstubAllGlobals();
  }
});
