import type { LegendListRef } from "@legendapp/list/react";
import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { rememberTimelinePosition } from "./timelineScrollAnchoring";
import { useTimelineScroll } from "./useTimelineScroll";

class ScrollNode extends EventTarget {
  scrollTop = 1_500;
  closest() {
    return null;
  }
}

let renderer: ReactTestRenderer | undefined;
let controller: ReturnType<typeof useTimelineScroll>;
let node: ScrollNode;
let contentLength: number;
let frame: FrameRequestCallback | undefined;
const scrollToEnd = vi.fn();
const listRef = { current: null as LegendListRef | null };
function Probe({ threadKey = "scroll-test", inset = 0 }: { threadKey?: string; inset?: number }) {
  const value = useTimelineScroll({ threadKey, listRef, composerInset: inset });
  useLayoutEffect(() => {
    controller = value;
  });
  return null;
}
function render(props: { threadKey?: string; inset?: number } = {}) {
  act(() => {
    if (renderer) renderer.update(<Probe {...props} />);
    else renderer = create(<Probe {...props} />);
  });
}
function fire(type: string, fields: Record<string, unknown> = {}, target = node) {
  act(() => target.dispatchEvent(Object.assign(new Event(type), fields)));
}
function reportEnd(atEnd: boolean) {
  act(() => controller.onIsAtEndChange(atEnd));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("Element", ScrollNode);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frame = callback;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    frame = undefined;
  });
  node = new ScrollNode();
  contentLength = 2_000;
  scrollToEnd.mockReset();
  listRef.current = {
    getState: () => ({
      data: ["row"],
      contentLength,
      scrollLength: 500,
      scroll: node.scrollTop,
      positionAtIndex: () => 0,
      sizeAtIndex: () => contentLength,
    }),
    scrollToEnd,
  } as unknown as LegendListRef;
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  frame = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("timeline follow intent", () => {
  it("keeps following when streaming or layout moves the end out of view", () => {
    render();
    contentLength += 400;
    reportEnd(false);
    act(() => vi.advanceTimersByTime(200));
    expect(controller.liveFollowEnabled).toBe(true);
    expect(controller.showScrollToBottom).toBe(false);
  });

  it("lets upward navigation pause streaming and returning to the bottom resume it", () => {
    render();
    act(() => controller.onScrollElementChange(node as unknown as HTMLElement));
    fire("wheel", { deltaY: -120 });
    node.scrollTop -= 120;
    reportEnd(false);
    act(() => vi.advanceTimersByTime(200));
    expect(controller.liveFollowEnabled).toBe(false);
    expect(controller.showScrollToBottom).toBe(true);
    node.scrollTop += 120;
    reportEnd(true);
    expect(controller.liveFollowEnabled).toBe(true);
    expect(controller.showScrollToBottom).toBe(false);
  });

  it("does not disengage for downward wheels, margin clicks, or content that fits", () => {
    render();
    act(() => controller.onScrollElementChange(node as unknown as HTMLElement));
    fire("wheel", { deltaY: 120 });
    fire("pointerdown");
    expect(controller.liveFollowEnabled).toBe(true);
    contentLength = 200;
    node.scrollTop = 0;
    fire("wheel", { deltaY: -120 });
    fire("keydown", { key: "Home" });
    expect(controller.liveFollowEnabled).toBe(true);
  });

  it("reveals the recovery button during continuous scrolling or streaming", () => {
    render();
    act(() => controller.cancelForUserNavigation());
    reportEnd(false);
    for (let i = 0; i < 4; i++) {
      act(() => vi.advanceTimersByTime(50));
      reportEnd(false);
    }
    expect(controller.showScrollToBottom).toBe(true);
    node.scrollTop += 120;
    reportEnd(true);
    expect(controller.showScrollToBottom).toBe(false);
  });

  it("cancels a delayed button reveal when the user returns to the bottom", () => {
    render();
    act(() => controller.cancelForUserNavigation());
    reportEnd(false);
    act(() => vi.advanceTimersByTime(50));
    node.scrollTop += 120;
    reportEnd(true);
    act(() => vi.advanceTimersByTime(200));
    expect(controller.showScrollToBottom).toBe(false);
    expect(controller.liveFollowEnabled).toBe(true);
  });

  it("attaches navigation when the initially empty timeline mounts and detaches replaced nodes", () => {
    render();
    act(() => controller.onScrollElementChange(node as unknown as HTMLElement));
    const oldNode = node;
    node = new ScrollNode();
    act(() => controller.onScrollElementChange(node as unknown as HTMLElement));
    fire("wheel", { deltaY: -120 }, oldNode);
    expect(controller.liveFollowEnabled).toBe(true);
    fire("keydown", { key: "PageUp" });
    expect(controller.liveFollowEnabled).toBe(false);
  });

  it("leaves editable keyboard navigation alone", () => {
    render();
    act(() => controller.onScrollElementChange(node as unknown as HTMLElement));
    const target = new ScrollNode();
    target.closest = () => target as never;
    const event = Object.assign(new Event("keydown"), { key: "Home" });
    Object.defineProperty(event, "target", { value: target });
    act(() => node.dispatchEvent(event));
    expect(controller.liveFollowEnabled).toBe(true);
  });

  it("recognizes scrollbar movement and touch navigation away from the bottom", () => {
    render();
    act(() => controller.onScrollElementChange(node as unknown as HTMLElement));
    fire("pointerdown");
    node.scrollTop -= 120;
    fire("scroll");
    expect(controller.liveFollowEnabled).toBe(false);
    act(() => controller.resumeFollowing());
    fire("touchmove");
    expect(controller.liveFollowEnabled).toBe(false);
  });

  it("explicitly scrolls on send/jump even when history is several screens away", () => {
    render();
    act(() => controller.cancelForUserNavigation());
    reportEnd(false);
    act(() => controller.scrollToEnd());
    reportEnd(false);
    act(() => frame?.(0));
    expect(scrollToEnd).toHaveBeenCalledWith({ animated: false });
    expect(controller.liveFollowEnabled).toBe(true);
    act(() => vi.advanceTimersByTime(200));
    expect(controller.showScrollToBottom).toBe(false);
  });

  it("lets a new user gesture supersede a scheduled jump", () => {
    render();
    act(() => controller.scrollToEnd());
    act(() => controller.cancelForUserNavigation());
    act(() => frame?.(0));
    expect(scrollToEnd).not.toHaveBeenCalled();
    expect(controller.liveFollowEnabled).toBe(false);
  });

  it("does not re-arm during the first near-bottom frames of PageUp", () => {
    render();
    act(() => controller.onScrollElementChange(node as unknown as HTMLElement));
    fire("keydown", { key: "PageUp" });
    reportEnd(true);
    node.scrollTop -= 10;
    reportEnd(true);
    node.scrollTop -= 400;
    reportEnd(false);
    expect(controller.liveFollowEnabled).toBe(false);
  });

  it("re-arms when scrolling back down entirely within the bottom band", () => {
    render();
    act(() => controller.onScrollElementChange(node as unknown as HTMLElement));
    fire("wheel", { deltaY: -20 });
    node.scrollTop -= 20;
    reportEnd(true);
    expect(controller.liveFollowEnabled).toBe(false);
    node.scrollTop += 20;
    reportEnd(true);
    expect(controller.liveFollowEnabled).toBe(true);
  });

  it("preserves new-turn framing through geometry reports until manual navigation", () => {
    render();
    act(() => controller.resumeFollowing("anchoring-new-turn"));
    reportEnd(false);
    reportEnd(true);
    expect(controller.modeRef.current).toBe("anchoring-new-turn");
    act(() => controller.cancelForUserNavigation());
    node.scrollTop += 120;
    reportEnd(true);
    expect(controller.modeRef.current).toBe("following-end");
  });

  it("keeps reading intent across composer resizes and restores it per thread", () => {
    render();
    act(() => controller.cancelForUserNavigation());
    render({ inset: 200 });
    expect(controller.liveFollowEnabled).toBe(false);
    render({ threadKey: "new-scroll-thread" });
    expect(controller.liveFollowEnabled).toBe(true);
    rememberTimelinePosition("remembered-scroll-thread", {
      rowId: "row",
      offsetWithinRow: 0,
      scrollOffset: 500,
      atEnd: false,
    });
    render({ threadKey: "remembered-scroll-thread" });
    expect(controller.liveFollowEnabled).toBe(false);
  });

  it("cancels a pending jump and button reveal when switching threads", () => {
    render();
    act(() => controller.cancelForUserNavigation());
    reportEnd(false);
    act(() => controller.scrollToEnd());
    render({ threadKey: "another-scroll-thread" });
    act(() => {
      frame?.(0);
      vi.advanceTimersByTime(200);
    });
    expect(scrollToEnd).not.toHaveBeenCalled();
    expect(controller.showScrollToBottom).toBe(false);
  });
});
