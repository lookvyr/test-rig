import { describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_RESOLVED_KEYBINDINGS,
  compileResolvedKeybindingsConfig,
} from "@t3tools/shared/keybindings";
import {
  pullRequestJumpCommandForIndex,
  pullRequestJumpIndexFromCommand,
  resolveShortcutCommand,
  shouldShowPullRequestJumpHint,
  shouldShowThreadJumpHintsForModifiers,
  shortcutLabelForCommand,
} from "./keybindings";
import { shortcutModifierStateAfterKeyboardEvent } from "./shortcutModifierState";

const options = { platform: "MacIntel", context: { pullRequestsView: true } };
const bindings = DEFAULT_RESOLVED_KEYBINDINGS;
const empty = { metaKey: false, altKey: false, ctrlKey: false, shiftKey: false };

describe("PR navigation shortcuts", () => {
  it("opens the workspace globally and scopes number jumps to the PR workspace", () => {
    const modifiers = { ...empty, metaKey: true, altKey: true };
    // Option changes the printed character; physical key codes still resolve.
    expect(
      resolveShortcutCommand({ ...modifiers, key: "π", code: "KeyP" }, bindings, {
        platform: "MacIntel",
      }),
    ).toBe("pullRequest.open");
    for (let index = 0; index < 9; index++) {
      const command = pullRequestJumpCommandForIndex(index)!;
      const event = { ...modifiers, key: "¡", code: `Digit${index + 1}` };
      expect(pullRequestJumpIndexFromCommand(command)).toBe(index);
      expect(resolveShortcutCommand(event, bindings, options)).toBe(command);
      expect(resolveShortcutCommand(event, bindings, { platform: "MacIntel" })).toBeNull();
      expect(
        resolveShortcutCommand({ ...event, key: `${index + 1}`, altKey: false }, bindings, options),
      ).toBe(`thread.jump.${index + 1}`);
    }
    expect(pullRequestJumpCommandForIndex(9)).toBeNull();
    expect(pullRequestJumpIndexFromCommand("thread.jump.1")).toBeNull();
  });

  it("switches PR and sidebar hints immediately when Option is released and pressed again", () => {
    let modifiers = { ...empty };
    const update = (type: "keydown" | "keyup", key: string) => {
      modifiers = shortcutModifierStateAfterKeyboardEvent(modifiers, {
        ...modifiers,
        type,
        key,
      } as KeyboardEvent);
    };
    const hints = () => [
      shouldShowPullRequestJumpHint(modifiers, bindings, "pullRequest.jump.1", options),
      shouldShowThreadJumpHintsForModifiers(modifiers, bindings, options),
    ];
    update("keydown", "Meta");
    expect(hints()).toEqual([false, true]);
    update("keydown", "Alt");
    expect(hints()).toEqual([true, false]);
    update("keyup", "Alt");
    expect(hints()).toEqual([false, true]);
    update("keydown", "Alt");
    expect(hints()).toEqual([true, false]);
    update("keydown", "Shift");
    expect(hints()).toEqual([false, false]);
    update("keyup", "Shift");
    update("keyup", "Meta");
    expect(hints()).toEqual([false, false]);
    update("keyup", "Alt");
    expect(hints()).toEqual([false, false]);
  });

  it("follows remapped shortcuts for each row instead of hardcoding modifier hints", () => {
    const custom = compileResolvedKeybindingsConfig([
      { command: "pullRequest.jump.1", key: "mod+shift+1", when: "pullRequestsView" },
      { command: "pullRequest.jump.2", key: "mod+alt+2", when: "pullRequestsView" },
    ]);
    const modifiers = { ...empty, metaKey: true, shiftKey: true };
    expect(shouldShowPullRequestJumpHint(modifiers, custom, "pullRequest.jump.1", options)).toBe(
      true,
    );
    expect(shouldShowPullRequestJumpHint(modifiers, custom, "pullRequest.jump.2", options)).toBe(
      false,
    );
    expect(shortcutLabelForCommand(custom, "pullRequest.jump.1", options)).toBe("⇧⌘1");
    expect(resolveShortcutCommand({ ...modifiers, key: "1" }, custom, options)).toBe(
      "pullRequest.jump.1",
    );
  });

  it("uses Ctrl+Alt for the corresponding non-Mac shortcuts", () => {
    expect(
      resolveShortcutCommand({ ...empty, ctrlKey: true, altKey: true, key: "9" }, bindings, {
        platform: "Linux",
        context: { pullRequestsView: true },
      }),
    ).toBe("pullRequest.jump.9");
  });
});
