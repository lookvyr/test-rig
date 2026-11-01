import { useAtomValue } from "@effect/atom-react";
import type { KeybindingCommand, PreviewForwardedShortcut } from "@t3tools/contracts";
import { useEffect } from "react";

import { primaryServerKeybindingsAtom } from "~/state/server";

/**
 * App commands a focused browser page hands back to the app. The desktop replays each chord in
 * the app window, so the app's own handlers and `when` clauses decide what it does there.
 */
const FORWARDED_COMMANDS: ReadonlySet<KeybindingCommand> = new Set<KeybindingCommand>([
  "commandPalette.toggle",
  "preview.toggle",
  "preview.new",
  "view.reopenClosed",
  "rightPanel.close",
  "rightPanel.previous",
  "rightPanel.next",
  "rightPanel.toggleMaximized",
]);

/** Keeps the desktop's forwarded chords on the user's current keybindings. */
export function PreviewShortcutForwarder() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  useEffect(() => {
    const preview = window.desktopBridge?.preview;
    if (!preview) return;
    const shortcuts: PreviewForwardedShortcut[] = keybindings
      .filter((rule) => FORWARDED_COMMANDS.has(rule.command))
      .map(({ command, shortcut }) => ({ command, shortcut }));
    void preview.setForwardedShortcuts(shortcuts).catch(() => undefined);
    return () => {
      void preview.setForwardedShortcuts([]).catch(() => undefined);
    };
  }, [keybindings]);
  return null;
}
