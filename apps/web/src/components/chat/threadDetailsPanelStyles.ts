/**
 * Visual primitives shared by controls when they are rendered in the thread details panel.
 *
 * Panel controls keep one density at every breakpoint, independent of toolbar button sizes.
 */
const THREAD_DETAILS_PANEL_RESTING_BUTTON_SURFACE_CLASS = "bg-transparent shadow-none";

const THREAD_DETAILS_PANEL_HOVER_SURFACE_CLASS =
  "hover:!bg-black/[0.055] data-pressed:!bg-black/[0.055] dark:hover:!bg-white/[0.075] dark:data-pressed:!bg-white/[0.075]";

const THREAD_DETAILS_PANEL_ROW_SURFACE_CLASS = `${THREAD_DETAILS_PANEL_RESTING_BUTTON_SURFACE_CLASS} ${THREAD_DETAILS_PANEL_HOVER_SURFACE_CLASS}`;

export const THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS = "gap-2.5 px-2.5 text-left";

// The row supplies the first tint; the hovered or open segment adds a second tint.
const THREAD_DETAILS_PANEL_SPLIT_BUTTON_SURFACE_CLASS = `before:hidden ${THREAD_DETAILS_PANEL_ROW_SURFACE_CLASS} data-popup-open:!bg-black/[0.055] dark:data-popup-open:!bg-white/[0.075]`;

const THREAD_DETAILS_PANEL_CONTROL_CLASS = `h-9 min-w-0 rounded-lg border-transparent ${THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS} text-[13px] font-medium text-foreground/80`;
const THREAD_DETAILS_PANEL_SPLIT_GROUP_SURFACE_CLASS = `${THREAD_DETAILS_PANEL_HOVER_SURFACE_CLASS} has-[[data-popup-open]]:bg-black/[0.055] dark:has-[[data-popup-open]]:bg-white/[0.075]`;

export const THREAD_DETAILS_PANEL_ROW_CLASS = `${THREAD_DETAILS_PANEL_CONTROL_CLASS} w-full justify-start ${THREAD_DETAILS_PANEL_ROW_SURFACE_CLASS}`;

export const THREAD_DETAILS_PANEL_SELECT_ROW_CLASS = `${THREAD_DETAILS_PANEL_ROW_CLASS} pe-0`;

const THREAD_DETAILS_PANEL_TRAILING_GEOMETRY_CLASS = "w-8 shrink-0 justify-center";

/** Match the trailing split button without changing the row's single-trigger semantics. */
export const THREAD_DETAILS_PANEL_TRAILING_SLOT_CLASS = `${THREAD_DETAILS_PANEL_TRAILING_GEOMETRY_CLASS} relative -me-px flex h-full items-center before:absolute before:-left-px before:top-1/2 before:h-4 before:w-px before:-translate-y-1/2 before:bg-border/65`;

// No transition on the group: the halves are Buttons whose background snaps (their base only
// transitions shadow), so an eased group tint would land frames later and the hover would
// visibly commit in two steps.
export const THREAD_DETAILS_PANEL_LINK_SPLIT_GROUP_CLASS = `group/thread-details-link flex w-full items-center rounded-lg ${THREAD_DETAILS_PANEL_SPLIT_GROUP_SURFACE_CLASS}`;

export const THREAD_DETAILS_PANEL_LINK_SPLIT_PRIMARY_CLASS = `${THREAD_DETAILS_PANEL_CONTROL_CLASS} flex-1 justify-start rounded-e-none ${THREAD_DETAILS_PANEL_SPLIT_BUTTON_SURFACE_CLASS}`;

/** The trailing half of a link split row when it carries a word ("Merge") rather than an icon. */
export const THREAD_DETAILS_PANEL_LINK_SPLIT_ACTION_CLASS = `${THREAD_DETAILS_PANEL_CONTROL_CLASS} shrink-0 justify-center rounded-s-none text-primary ${THREAD_DETAILS_PANEL_SPLIT_BUTTON_SURFACE_CLASS}`;

export const THREAD_DETAILS_PANEL_LOCKED_ROW_CLASS = `h-9 w-full min-w-0 justify-start rounded-lg border border-transparent ${THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS} text-[13px] font-medium text-foreground/80 sm:h-9 sm:text-[13px]`;

export const THREAD_DETAILS_PANEL_ICON_CLASS = "size-4 shrink-0 text-muted-foreground";

export const THREAD_DETAILS_PANEL_CHEVRON_CLASS = "size-4 shrink-0 text-muted-foreground";

export const THREAD_DETAILS_PANEL_ICON_ACTION_CLASS = `size-6 rounded-md border-transparent bg-transparent p-0 sm:size-6 ${THREAD_DETAILS_PANEL_ROW_SURFACE_CLASS}`;

export const THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS = `group/thread-details-action flex w-full items-center rounded-lg ${THREAD_DETAILS_PANEL_SPLIT_GROUP_SURFACE_CLASS}`;

export const THREAD_DETAILS_PANEL_SPLIT_PRIMARY_CLASS = `${THREAD_DETAILS_PANEL_CONTROL_CLASS} flex-1 justify-start rounded-e-none ${THREAD_DETAILS_PANEL_SPLIT_BUTTON_SURFACE_CLASS}`;

export const THREAD_DETAILS_PANEL_SPLIT_SECONDARY_CLASS = `${THREAD_DETAILS_PANEL_CONTROL_CLASS} ${THREAD_DETAILS_PANEL_TRAILING_GEOMETRY_CLASS} rounded-s-none border-0 px-0 ${THREAD_DETAILS_PANEL_SPLIT_BUTTON_SURFACE_CLASS}`;

export const THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS = "h-4 w-px shrink-0 bg-border/65";

export const THREAD_DETAILS_PANEL_SPLIT_CHECKS_CLASS = `${THREAD_DETAILS_PANEL_CONTROL_CLASS} justify-center gap-1.5 rounded-none ${THREAD_DETAILS_PANEL_SPLIT_BUTTON_SURFACE_CLASS}`;
