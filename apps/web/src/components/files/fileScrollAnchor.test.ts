import { describe, expect, it } from "vite-plus/test";

import { captureFileScrollAnchor, restoreFileScrollAnchor } from "./fileScrollAnchor";

function fixture() {
  const lines = [
    { dataset: { line: "154" }, getBoundingClientRect: () => ({ top: 70, bottom: 95 }) },
    { dataset: { line: "155" }, getBoundingClientRect: () => ({ top: 95, bottom: 135 }) },
  ];
  const shadowRoot = {
    querySelectorAll: () => lines,
    querySelector: () => lines[1],
  };
  const scroller = {
    scrollTop: 5000,
    getBoundingClientRect: () => ({ top: 100 }),
    querySelector: () => ({ shadowRoot }),
  };
  const root = { querySelector: () => scroller } as unknown as HTMLElement;
  return { root, scroller, lines, shadowRoot };
}

describe("file refresh scroll anchor", () => {
  it("keeps a partially visible line in place when refreshed line heights change", () => {
    const { root, scroller, lines } = fixture();
    const anchor = captureFileScrollAnchor(root);
    expect(anchor).toEqual({ line: "155", offset: -5 });
    lines[1]!.getBoundingClientRect = () => ({ top: 595, bottom: 635 });
    restoreFileScrollAnchor(root, anchor!);
    expect(scroller.scrollTop).toBe(5500);
  });

  it("leaves the browser's clamped position when the anchored line was removed", () => {
    const { root, scroller, shadowRoot } = fixture();
    shadowRoot.querySelector = () => undefined;
    restoreFileScrollAnchor(root, { line: "155", offset: -5 });
    expect(scroller.scrollTop).toBe(5000);
  });
});
