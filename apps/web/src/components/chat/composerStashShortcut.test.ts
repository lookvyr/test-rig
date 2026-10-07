import { describe, expect, it } from "vite-plus/test";

import { composerStashTargetsOtherEditor } from "./composerStashShortcut";

describe("composer stash shortcut focus", () => {
  it("leaves save shortcuts with file editors and other editable controls", () => {
    expect(
      composerStashTargetsOtherEditor({
        closest: (selector) => (selector === "[data-chat-composer-form]" ? null : {}),
      }),
    ).toBe(true);
  });

  it("allows stashing inside the composer, including editable content", () => {
    expect(composerStashTargetsOtherEditor({ closest: () => ({}) })).toBe(false);
  });

  it("recognizes a shadow-root file editor behind a non-editable event target", () => {
    const host = { closest: () => null };
    const editor = { closest: () => ({}) };
    expect(composerStashTargetsOtherEditor(host, [editor, host])).toBe(true);
  });

  it("keeps global stash access from non-editable surfaces", () => {
    expect(composerStashTargetsOtherEditor({ closest: () => null })).toBe(false);
    expect(composerStashTargetsOtherEditor(null)).toBe(false);
  });
});
