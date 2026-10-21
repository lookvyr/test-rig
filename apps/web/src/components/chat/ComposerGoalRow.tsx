import type { ProviderGoalPresentation } from "@t3tools/client-runtime/state/thread-execution";
import { TargetIcon } from "lucide-react";
import { memo } from "react";

import { Button } from "../ui/button";

/**
 * A native `/goal`, shown above the composer while one is set. Once the thread
 * is idle it offers the native follow-ups: resume a stopped goal, or clear it.
 */
export const ComposerGoalRow = memo(function ComposerGoalRow({
  presentation,
  working,
  onResume,
  onClear,
}: {
  readonly presentation: ProviderGoalPresentation;
  readonly working: boolean;
  readonly onResume: () => void;
  readonly onClear: () => void;
}) {
  return (
    <div
      className="mx-auto mb-2 flex max-w-3xl items-center gap-2 rounded-[18px] border border-border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-sm"
      data-composer-goal="true"
    >
      <TargetIcon className="size-3.5 shrink-0 text-primary" aria-hidden />
      <span className="shrink-0 font-medium text-foreground/85">
        {/* Usage stays beside the title so a long objective cannot clip it. */}
        {presentation.usage === null
          ? presentation.title
          : `${presentation.title} · ${presentation.usage}`}
      </span>
      <span
        className="min-w-0 flex-1 truncate text-muted-foreground"
        title={presentation.objective}
      >
        {presentation.objective}
      </span>
      {working ? null : (
        <span className="flex shrink-0 items-center gap-1">
          {presentation.canResume ? (
            <Button size="xs" variant="ghost" onClick={onResume}>
              Resume
            </Button>
          ) : null}
          <Button size="xs" variant="ghost" onClick={onClear}>
            Clear
          </Button>
        </span>
      )}
    </div>
  );
});
