/**
 * How the footer's permissions chip shows. The model picker's footer always holds Permissions,
 * so the chip only shows while the mode differs from the default. The narrow footer keeps it as
 * an icon.
 */
export function resolveComposerControlsOwnership(input: {
  /** Permissions hide while the mode is the default, or while the new-thread strip names it. */
  readonly matchesDefault: boolean;
  readonly collapsed: boolean;
}) {
  const accessDisplay = input.matchesDefault
    ? ("hidden" as const)
    : input.collapsed
      ? ("icon" as const)
      : ("label" as const);
  return { accessDisplay, showModeBlock: accessDisplay !== "hidden" };
}
