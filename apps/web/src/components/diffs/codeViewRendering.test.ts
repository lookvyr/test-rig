import { CodeView, clearRenderQueue } from "@pierre/diffs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

describe("CodeView render scheduling", () => {
  let nextFrame: FrameRequestCallback | undefined;

  beforeEach(() => {
    nextFrame = undefined;
    vi.stubGlobal("document", { createElement: () => ({ style: {} }) });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      nextFrame = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {
      nextFrame = undefined;
    });
  });

  afterEach(() => {
    clearRenderQueue();
    vi.unstubAllGlobals();
  });

  it("defers an immediate render requested during a frame until that frame finishes", () => {
    const viewer = new CodeView();
    let depth = 0;
    let maxDepth = 0;
    let requestedNestedRender = false;
    // Stop before DOM layout; React slot publication can call render(true) in
    // the same way while an actual frame is settling a file scroll target.
    const beginFrame = vi.fn(() => {
      depth++;
      maxDepth = Math.max(maxDepth, depth);
      if (!requestedNestedRender) {
        requestedNestedRender = true;
        viewer.render(true);
        viewer.render(true);
      }
      depth--;
      return false;
    });
    Object.defineProperty(viewer, "isReady", { value: beginFrame });

    viewer.render(true);

    expect(maxDepth).toBe(1);
    expect(beginFrame).toHaveBeenCalledTimes(1);
    expect(nextFrame).toBeTypeOf("function");
    nextFrame?.(0);
    expect(beginFrame).toHaveBeenCalledTimes(2);
    expect(maxDepth).toBe(1);
  });

  it("allows another immediate render after a frame throws", () => {
    const viewer = new CodeView();
    const beginFrame = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("render failure");
      })
      .mockReturnValue(false);
    Object.defineProperty(viewer, "isReady", { value: beginFrame });

    expect(() => viewer.render(true)).toThrow("render failure");
    viewer.render(true);
    expect(beginFrame).toHaveBeenCalledTimes(2);
    expect(nextFrame).toBeUndefined();
  });
});
