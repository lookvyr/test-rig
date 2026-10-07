import { describe, expect, it } from "vite-plus/test";
import {
  surfaceShortcutActionForKey,
  surfaceShortcutTargetsTypingContext,
  tabWheelDelta,
} from "./rightPanelTabs.logic";

describe("panel launcher keyboard access", () => {
  const available = { available: true, shortcut: "F" };
  const unavailable = { available: false, shortcut: "B" };
  const event = {
    key: "f",
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    isComposing: false,
    defaultPrevented: false,
  };
  it("opens available letter actions while preserving modified, composing and handled events", () => {
    expect(surfaceShortcutActionForKey([available, unavailable], event)).toBe(available);
    expect(
      surfaceShortcutActionForKey([available, unavailable], { ...event, key: "b" }),
    ).toBeNull();
    for (const key of ["altKey", "ctrlKey", "metaKey", "isComposing", "defaultPrevented"] as const)
      expect(surfaceShortcutActionForKey([available], { ...event, [key]: true })).toBeNull();
  });
  it("treats empty editable hosts as typing contexts, including non-editable chips inside them", () => {
    let selector = "";
    expect(
      surfaceShortcutTargetsTypingContext({
        closest: (value) => {
          selector = value;
          return {};
        },
      }),
    ).toBe(true);
    expect(selector).toContain('[contenteditable]:not([contenteditable="false"])');
    expect(surfaceShortcutTargetsTypingContext({ closest: () => null })).toBe(false);
  });
});

describe("overflow tab wheel navigation", () => {
  const event = { deltaX: 0, deltaY: 3, deltaMode: 0, ctrlKey: false, metaKey: false };
  it("maps vertical pixel, line and page wheels without consuming horizontal scroll or zoom", () => {
    expect(tabWheelDelta(event, 500)).toBe(3);
    expect(tabWheelDelta({ ...event, deltaMode: 1 }, 500)).toBe(48);
    expect(tabWheelDelta({ ...event, deltaMode: 2 }, 500)).toBe(1500);
    expect(tabWheelDelta({ ...event, deltaX: 5 }, 500)).toBe(0);
    expect(tabWheelDelta({ ...event, ctrlKey: true }, 500)).toBe(0);
  });
});
