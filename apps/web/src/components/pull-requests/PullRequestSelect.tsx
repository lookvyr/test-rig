import { ChevronDownIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export function PullRequestSelect({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <span className={cn("relative inline-flex min-w-0", className)}>
      <select
        {...props}
        className="h-8 w-full min-w-0 appearance-none truncate rounded-md border border-input bg-background pl-2 pr-8 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        {children}
      </select>
      <ChevronDownIcon
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
    </span>
  );
}
