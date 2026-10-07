import { surfaceShortcutTargetsTypingContext } from "../rightPanelTabs.logic";

/** Other editors retain their own save shortcut while the composer can stash. */
export function composerStashTargetsOtherEditor(
  target: { closest(selectors: string): unknown } | null,
  composedPath: readonly { closest(selectors: string): unknown }[] = [],
): boolean {
  // File editors live in a shadow root, which retargets window key events to
  // a non-editable host. The composed path retains the actual editable node.
  const typingTarget = composedPath.find(surfaceShortcutTargetsTypingContext) ?? target;
  return (
    target?.closest("[data-chat-composer-form]") == null &&
    surfaceShortcutTargetsTypingContext(typingTarget)
  );
}
