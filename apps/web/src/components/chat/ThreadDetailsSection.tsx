import type { ComponentProps, ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";

import { cn } from "../../lib/utils";

/** Sections share header and content insets in both the sidebar and popover. */
export function ThreadDetailsSection({
  headingId,
  title,
  actions,
  separated = true,
  showHeading = true,
  collapsible = false,
  children,
  ...props
}: Omit<ComponentProps<"section">, "className" | "style" | "title" | "aria-labelledby"> & {
  headingId: string;
  title: string;
  actions?: ReactNode;
  separated?: boolean;
  showHeading?: boolean;
  collapsible?: boolean;
}) {
  if (collapsible) {
    return (
      <Collapsible
        defaultOpen
        render={
          <section
            {...props}
            aria-labelledby={headingId}
            className={cn("px-2 pt-2 pb-2.5", separated && "border-t border-border/65")}
          />
        }
      >
        <h3 id={headingId}>
          <CollapsibleTrigger className="group flex min-h-8 w-full items-center justify-between gap-2 rounded-md px-1.5 text-left text-2xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="min-w-0 truncate">{title}</span>
            <ChevronRightIcon
              aria-hidden
              className="size-3 shrink-0 transition-transform duration-200 motion-reduce:transition-none group-data-panel-open:rotate-90"
            />
          </CollapsibleTrigger>
        </h3>
        <CollapsiblePanel className="ease-out">{children}</CollapsiblePanel>
      </Collapsible>
    );
  }
  return (
    <section
      {...props}
      aria-labelledby={showHeading ? headingId : undefined}
      aria-label={showHeading ? undefined : title}
      className={cn("px-2 pt-2 pb-2.5", separated && "border-t border-border/65")}
    >
      <div
        className={cn(
          "mb-1 flex min-h-8 min-w-0 items-center justify-between gap-2 px-1.5",
          !showHeading && "hidden",
        )}
      >
        <h3
          id={headingId}
          className="min-w-0 truncate text-2xs font-medium text-muted-foreground select-none"
        >
          {title}
        </h3>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
