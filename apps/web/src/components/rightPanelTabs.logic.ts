export const LAUNCHER_SHORTCUT_BLOCKING_LAYERS = [
  "dialog-popup",
  "alert-dialog-popup",
  "command-dialog-popup",
  "menu-popup",
  "select-popup",
  "popover-popup",
  "combobox-popup",
  "autocomplete-popup",
]
  .map((slot) => `[data-slot="${slot}"]`)
  .join(",");

export function surfaceShortcutTargetsTypingContext(
  target: { closest(selectors: string): unknown } | null,
): boolean {
  return (
    target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !=
    null
  );
}

export function surfaceShortcutActionForKey<
  Action extends { available: boolean; shortcut: string },
>(
  actions: readonly Action[],
  event: Pick<
    KeyboardEvent,
    "altKey" | "ctrlKey" | "metaKey" | "defaultPrevented" | "isComposing" | "key"
  >,
): Action | null {
  if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey)
    return null;
  return (
    actions.find(
      (action) => action.available && action.shortcut.toLowerCase() === event.key.toLowerCase(),
    ) ?? null
  );
}

export function tabWheelDelta(
  event: Pick<WheelEvent, "deltaX" | "deltaY" | "deltaMode" | "ctrlKey" | "metaKey">,
  width: number,
): number {
  if (event.ctrlKey || event.metaKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return 0;
  return event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? width : 1);
}
