import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { MiddleTruncate } from "./middle-truncate";

describe("MiddleTruncate reconciliation", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("replaces an imperatively clipped head when a short value arrives", async () => {
    vi.stubGlobal("HTMLElement", function HTMLElementMock() {});
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let renderer: ReactTestRenderer;
    const nodes: Array<{
      style: { clipPath: string };
      toggleAttribute: () => void;
      scrollWidth: number;
      clientWidth: number;
      firstChild: null;
    }> = [];
    await act(async () => {
      renderer = create(<MiddleTruncate value="t3/investigate-release-build-times" />, {
        createNodeMock: () => {
          const node = {
            style: { clipPath: "" },
            toggleAttribute: () => {},
            scrollWidth: 0,
            clientWidth: 80,
            firstChild: null,
          };
          nodes.push(node);
          return node;
        },
      });
    });
    const head = renderer!.root.findAllByType("span")[1]!;
    const clippedHead = nodes[0]!;
    clippedHead.style.clipPath = "inset(0 7px 0 0)";
    await act(async () => {
      renderer!.update(<MiddleTruncate value="main" />);
    });
    const whole = renderer!.root.findAllByType("span")[1]!;
    expect(whole.children).toEqual(["main"]);
    expect(whole === head).toBe(false);
    await act(async () => renderer!.unmount());
  });
});
