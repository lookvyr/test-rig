import { ChevronDownIcon } from "lucide-react";

import { cn } from "~/lib/utils";

/**
 * Collapsible header for the Working, Snoozed, and Settled sections: the label
 * on the left, the count and a chevron on the right. The chevron points right
 * while the section is collapsed.
 */
export function SidebarSectionHeader(props: {
  section: "working" | "snoozed" | "settled";
  label: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <li data-thread-selection-safe className={cn("relative mx-0.5 h-8 list-none", props.className)}>
      <button
        type="button"
        onClick={props.onToggle}
        aria-expanded={props.expanded}
        data-testid={`sidebar-v2-${props.section}-shelf-toggle`}
        className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-xs font-medium text-sidebar-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
      >
        <span className="min-w-0 truncate">{props.label}</span>
        <span aria-hidden className="min-w-2 flex-1" />
        <span className="font-normal tabular-nums">{props.count}</span>
        <ChevronDownIcon
          aria-hidden
          className={cn("size-3 shrink-0 transition-transform", !props.expanded && "-rotate-90")}
        />
      </button>
    </li>
  );
}
