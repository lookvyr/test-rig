import type { PointerEvent as ReactPointerEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  cleanup: undefined as (() => void) | undefined,
  setWidth: vi.fn(),
  persist: vi.fn(),
}));
vi.mock("react", () => ({
  useCallback: (callback: unknown) => callback,
  useRef: (current: unknown) => ({ current }),
  useState: (initial: () => number) => [initial(), state.setWidth],
  useEffect: (effect: () => () => void) => {
    state.cleanup = effect();
  },
}));
vi.mock("./useLocalStorage", () => ({
  getLocalStorageItem: () => null,
  setLocalStorageItem: state.persist,
}));

import { useResizableWidth } from "./useResizableWidth";

function setup() {
  const surface = new EventTarget();
  const style = {
    cursor: "",
    userSelect: "",
    removeProperty(name: string) {
      if (name === "cursor") this.cursor = "";
      if (name === "user-select") this.userSelect = "";
    },
  };
  const target = {
    setPointerCapture: vi.fn(),
    hasPointerCapture: () => true,
    releasePointerCapture: vi.fn(() => dispatch("lostpointercapture")),
  };
  function dispatch(type: string, pointerId = 1) {
    surface.dispatchEvent(Object.assign(new Event(type), { pointerId }));
  }
  function pointer(clientX: number) {
    return {
      pointerId: 1,
      button: 0,
      clientX,
      currentTarget: target,
      preventDefault() {},
      stopPropagation() {},
    } as unknown as ReactPointerEvent<HTMLElement>;
  }
  vi.stubGlobal("window", surface);
  vi.stubGlobal("document", { body: { style } });
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const { handlers } = useResizableWidth({
    storageKey: "test-panel",
    defaultWidth: 560,
    minWidth: 320,
    maxWidth: 1000,
    edge: "left",
  });
  handlers.onPointerDown(pointer(800));
  handlers.onPointerMove(pointer(700));
  expect(style.cursor).toBe("col-resize");
  return { dispatch, style, target, handlers, pointer };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  state.cleanup?.();
  vi.unstubAllGlobals();
});

describe("resize cursor cleanup", () => {
  it("finishes a release outside the handle and persists the final width once", () => {
    const { dispatch, style, handlers, pointer } = setup();
    dispatch("pointerup");
    handlers.onPointerUp(pointer(700));
    expect(style).toMatchObject({ cursor: "", userSelect: "" });
    expect(state.setWidth).toHaveBeenLastCalledWith(660);
    expect(state.persist).toHaveBeenCalledExactlyOnceWith("test-panel", 660, expect.anything());
  });

  it.each(["pointercancel", "lostpointercapture", "blur"])(
    "clears the cursor and cancels unsaved resizing on %s",
    (event) => {
      const { dispatch, style } = setup();
      dispatch(event);
      expect(style).toMatchObject({ cursor: "", userSelect: "" });
      expect(state.setWidth).toHaveBeenLastCalledWith(560);
      expect(state.persist).not.toHaveBeenCalled();
      expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
    },
  );

  it("cleans up on navigation without leaving listeners or a queued resize", () => {
    const { dispatch, style, target } = setup();
    state.cleanup?.();
    expect(style).toMatchObject({ cursor: "", userSelect: "" });
    expect(target.releasePointerCapture).toHaveBeenCalledOnce();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
    dispatch("pointerup");
    expect(state.persist).not.toHaveBeenCalled();
    expect(state.setWidth).not.toHaveBeenCalled();
  });

  it("ignores a different pointer ending while this drag is active", () => {
    const { dispatch, style } = setup();
    dispatch("pointerup", 2);
    dispatch("lostpointercapture", 2);
    expect(style.cursor).toBe("col-resize");
    expect(state.persist).not.toHaveBeenCalled();
    dispatch("pointerup");
    expect(style.cursor).toBe("");
  });
});
