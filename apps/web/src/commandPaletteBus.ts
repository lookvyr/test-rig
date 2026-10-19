import type { EnvironmentId } from "@t3tools/contracts";
// Tiny event bus allowing components to programmatically open the command palette
// without owning its React state.
const COMMAND_PALETTE_OPEN_EVENT = "t3code:open-command-palette";
const COMPOSER_EFFORT_EVENT = "test-rig:step-composer-effort";

export function stepComposerEffort(direction: 1 | -1): void {
  window.dispatchEvent(new CustomEvent(COMPOSER_EFFORT_EVENT, { detail: direction }));
}

export function onStepComposerEffort(listener: (direction: 1 | -1) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<1 | -1>).detail);
  window.addEventListener(COMPOSER_EFFORT_EVENT, handler);
  return () => window.removeEventListener(COMPOSER_EFFORT_EVENT, handler);
}

export interface CommandPaletteOpenDetail {
  readonly environmentId?: EnvironmentId;
  readonly open?: "add-project" | "new-thread-in" | "new-project";
}

export function openCommandPalette(detail?: CommandPaletteOpenDetail): void {
  window.dispatchEvent(
    new CustomEvent(COMMAND_PALETTE_OPEN_EVENT, detail ? { detail } : undefined),
  );
}

export function onOpenCommandPalette(
  listener: (detail: CommandPaletteOpenDetail) => void,
): () => void {
  const handler = (event: Event) => {
    listener((event as CustomEvent<CommandPaletteOpenDetail>).detail ?? {});
  };
  window.addEventListener(COMMAND_PALETTE_OPEN_EVENT, handler);
  return () => window.removeEventListener(COMMAND_PALETTE_OPEN_EVENT, handler);
}

/** Read at event time so consumers do not subscribe to transient dialog state. */
export function isCommandPaletteOpen(): boolean {
  return (
    typeof document !== "undefined" && document.querySelector("[data-command-palette]") !== null
  );
}
