import { describe, expect, it } from "vite-plus/test";
import { isSettingsSearchShortcut } from "./settingsSearchShortcut";

const key = (overrides: Partial<KeyboardEvent> = {}) => ({
  key: "/",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  defaultPrevented: false,
  isComposing: false,
  ...overrides,
});
const page = { editable: false, popup: false };

describe("settings search shortcut", () => {
  it("allows Cmd+F and Ctrl+F from editable settings controls", () => {
    expect(
      isSettingsSearchShortcut(key({ key: "f", metaKey: true }), { ...page, editable: true }),
    ).toBe(true);
    expect(
      isSettingsSearchShortcut(key({ key: "f", ctrlKey: true }), { ...page, editable: true }),
    ).toBe(true);
  });
  it("leaves slash available for typing", () => {
    expect(isSettingsSearchShortcut(key(), page)).toBe(true);
    expect(isSettingsSearchShortcut(key(), { ...page, editable: true })).toBe(false);
  });
  it("leaves nested popups and keybinding capture in control", () => {
    expect(
      isSettingsSearchShortcut(key({ key: "f", metaKey: true }), { ...page, popup: true }),
    ).toBe(false);
    expect(isSettingsSearchShortcut(key(), { ...page, popup: true })).toBe(false);
  });
  it("ignores consumed, composing and modified find events", () => {
    for (const extra of [
      { defaultPrevented: true },
      { isComposing: true },
      { altKey: true },
      { shiftKey: true },
    ]) {
      expect(isSettingsSearchShortcut(key({ key: "f", ctrlKey: true, ...extra }), page)).toBe(
        false,
      );
    }
  });
});
