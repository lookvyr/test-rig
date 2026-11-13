import {
  type ContextWindowSnapshot,
  formatContextWindowCompactionMessage,
  formatContextWindowTokens,
} from "../../lib/contextWindow";
import { cn } from "../../lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ThreadDetailsSection } from "./ThreadDetailsSection";

/** The thread's context window. The bar fills as context is used; the tick marks auto-compaction. */
export function ThreadDetailsContext({ usage }: { readonly usage: ContextWindowSnapshot }) {
  const maxTokens = usage.maxTokens != null && usage.maxTokens > 0 ? usage.maxTokens : null;
  const used =
    maxTokens !== null && usage.usedPercentage !== null
      ? Math.round(Math.max(0, Math.min(100, usage.usedPercentage)))
      : null;
  const threshold = usage.autoCompactThreshold ?? null;
  const tick =
    maxTokens !== null && threshold !== null && threshold > 0 && threshold < maxTokens
      ? (threshold / maxTokens) * 100
      : null;
  const usedTokens = formatContextWindowTokens(usage.usedTokens);
  const tone = used === null ? null : used >= 90 ? "error" : used >= 80 ? "warning" : null;
  const value =
    maxTokens !== null ? `${usedTokens} / ${formatContextWindowTokens(maxTokens)}` : usedTokens;
  const summary = used !== null ? `${used}% used` : `${usedTokens} tokens used`;
  return (
    <ThreadDetailsSection
      headingId="thread-details-context-heading"
      title="Context window"
      showHeading={false}
    >
      <div className="grid grid-cols-[auto_minmax(3rem,1fr)_auto] gap-x-3 text-xs">
        <Tooltip>
          <TooltipTrigger
            render={
              <div
                tabIndex={0}
                aria-label={`Context: ${summary}`}
                className="col-span-3 grid h-6 cursor-default grid-cols-subgrid items-center rounded-lg px-2.5 outline-none hover:bg-black/[0.035] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-popup-open:bg-black/[0.035] dark:hover:bg-white/[0.08] dark:data-popup-open:bg-white/[0.08]"
              />
            }
          >
            <span className="text-muted-foreground">Context</span>
            {used !== null ? (
              <span className="relative h-[3px] rounded-full bg-muted-foreground/30 dark:bg-muted-foreground/20">
                {used > 0 ? (
                  <span
                    className={cn(
                      "absolute inset-y-0 left-0 rounded-full",
                      tone === "error"
                        ? "bg-error"
                        : tone === "warning"
                          ? "bg-warning"
                          : "bg-muted-foreground",
                    )}
                    style={{ width: `max(${used}%, 6px)` }}
                  />
                ) : null}
                {tick !== null ? (
                  <span
                    aria-hidden
                    className="absolute -top-[3px] h-[9px] w-px -translate-x-1/2 bg-foreground/60"
                    style={{ left: `${tick}%` }}
                  />
                ) : null}
              </span>
            ) : null}
            <span
              className={cn(
                // Without a bar, the value spans the bar column too.
                "text-end font-medium tabular-nums",
                used === null && "col-span-2",
                tone === "error"
                  ? "text-error-foreground"
                  : tone === "warning"
                    ? "text-warning-foreground"
                    : "text-foreground/80",
              )}
            >
              {value}
            </span>
          </TooltipTrigger>
          {/* Rows sit 8px inside the card; clear its edge instead of overlapping it. */}
          <TooltipPopup side="left" sideOffset={16}>
            <div className="flex flex-col gap-0.5">
              <span className="text-foreground">Context: {summary}</span>
              {maxTokens !== null ? (
                <span className="text-muted-foreground">
                  {usage.usedTokens.toLocaleString("en-US")} of {maxTokens.toLocaleString("en-US")}{" "}
                  tokens
                </span>
              ) : null}
              {usage.totalProcessedTokens ? (
                <span className="text-muted-foreground">
                  {formatContextWindowTokens(usage.totalProcessedTokens)} processed in total
                </span>
              ) : null}
              {usage.compactsAutomatically ? (
                <span className="text-muted-foreground">
                  {formatContextWindowCompactionMessage({ autoCompactThreshold: threshold })}
                </span>
              ) : null}
            </div>
          </TooltipPopup>
        </Tooltip>
      </div>
    </ThreadDetailsSection>
  );
}
