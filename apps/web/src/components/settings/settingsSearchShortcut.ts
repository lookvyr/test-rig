/** Find can leave an editor; slash must remain available for typing in it. */
export function isSettingsSearchShortcut(
  event: Pick<
    KeyboardEvent,
    "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "defaultPrevented" | "isComposing"
  >,
  { editable, popup }: { editable: boolean; popup: boolean },
) {
  if (event.defaultPrevented || event.isComposing || popup) return false;
  const find =
    event.key.toLowerCase() === "f" &&
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey;
  const slash = event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey;
  return find || (slash && !editable);
}
