import { act, useEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useComposerTypingGuard } from "./useComposerTypingGuard";

let renderer: ReactTestRenderer | null = null;
let guard: ReturnType<typeof useComposerTypingGuard>;
function Probe({ scope, requests }: { scope: string; requests: string[] }) {
  const value = useComposerTypingGuard(scope, requests);
  useEffect(() => {
    guard = value;
  }, [value]);
  return null;
}
function render(scope = "main", requests: string[] = []) {
  act(() => {
    if (renderer) renderer.update(<Probe scope={scope} requests={requests} />);
    else renderer = create(<Probe scope={scope} requests={requests} />);
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", { setTimeout, clearTimeout });
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("composer typing guard lifecycle", () => {
  it("extends the hold for real edits and releases after the last edit", () => {
    render();
    act(() => {
      guard.onFocus();
      guard.onDraftChange();
    });
    render("main", ["question"]);
    expect([...guard.heldRequestIds]).toEqual(["question"]);
    act(() => {
      vi.advanceTimersByTime(1000);
      guard.onDraftChange();
    });
    act(() => vi.advanceTimersByTime(1499));
    expect(guard.heldRequestIds.has("question")).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(guard.heldRequestIds.size).toBe(0);
    act(() => guard.onDraftChange());
    render("main", ["question", "approval"]);
    expect([...guard.heldRequestIds]).toEqual(["approval"]);
  });
  it.each(["onBlur", "onSend"] as const)("releases immediately on %s", (event) => {
    render();
    act(() => {
      guard.onFocus();
      guard.onDraftChange();
    });
    render("main", ["question"]);
    act(() => guard[event]());
    expect(guard.heldRequestIds.size).toBe(0);
    act(() => {
      guard.onFocus();
      guard.onDraftChange();
    });
    render("main", ["question"]);
    expect(guard.heldRequestIds.size).toBe(0);
  });
  it("drops cancelled requests and does not carry typing across thread changes", () => {
    render();
    act(() => {
      guard.onFocus();
      guard.onDraftChange();
    });
    render("main", ["question"]);
    render("main", []);
    expect(guard.heldRequestIds.size).toBe(0);
    render("side-chat", ["other-question"]);
    expect(guard.heldRequestIds.size).toBe(0);
    act(() => guard.onDraftChange());
    render("side-chat", ["other-question", "new-question"]);
    expect([...guard.heldRequestIds]).toEqual(["new-question"]);
  });
});
