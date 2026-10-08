import { createPortal } from "react-dom";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useLayoutEffect, useState, type ReactNode } from "react";
import { NotepadTextIcon } from "lucide-react";
import { useThreadDetailsStore } from "../../threadDetailsStore";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { ScrollArea } from "../ui/scroll-area";
import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useChatCanvas } from "./ChatCanvasContext";
import {
  resolveThreadDetailsCardLayout,
  resolveThreadDetailsCardDensity,
} from "./threadDetailsCardLayout";

/** One persistent controls tree: moving between card and popover must not discard open forms. */
export function ThreadDetailsCard({
  threadRef,
  toggleContainer,
  children,
  shortcutLabel,
  contentKey,
}: {
  threadRef: ScopedThreadRef;
  children: ReactNode;
  toggleContainer: HTMLElement | null;
  shortcutLabel?: string | undefined;
  contentKey?: string | undefined;
}) {
  const canvas = useChatCanvas();
  const placement = canvas
    ? resolveThreadDetailsCardLayout({
        container: canvas.container,
        lane: canvas.lane,
        frame: canvas.layout.frame,
        overlapsDetailsCard: canvas.layout.overlapsDetailsCard,
      })
    : null;
  const preferredPlacement = canvas
    ? resolveThreadDetailsCardLayout({
        container: canvas.container,
        lane: canvas.lane,
        frame: null,
      })
    : null;
  const [showAll, setShowAll] = useState(false);
  const inline = placement !== null && !showAll;
  const measurementKey = `${scopedThreadKey(threadRef)}:${preferredPlacement?.width ?? "popup"}:${contentKey ?? ""}`;
  const [measurements, setMeasurements] = useState({ key: measurementKey, full: 0, compact: 0 });
  const contentHeights =
    measurements.key === measurementKey ? measurements : { full: 0, compact: 0 };
  const density = inline
    ? resolveThreadDetailsCardDensity(placement.height, contentHeights)
    : "full";
  const inlineOpen = useThreadDetailsStore(
    (state) => !state.hiddenByThreadKey[scopedThreadKey(threadRef)],
  );
  const popoverOpen = useThreadDetailsStore(
    (state) => state.popoverOpenByThreadKey[scopedThreadKey(threadRef)] ?? false,
  );
  const setPopoverOpen = (open: boolean) =>
    useThreadDetailsStore.getState().setPopoverOpen(threadRef, open);
  useLayoutEffect(() => {
    useThreadDetailsStore.getState().setPresentation(threadRef, inline ? "inline" : "popover");
    if (inline) useThreadDetailsStore.getState().setPopoverOpen(threadRef, false);
  }, [inline, threadRef.environmentId, threadRef.threadId]);
  useLayoutEffect(() => {
    if (showAll && !popoverOpen) {
      setShowAll(false);
      useThreadDetailsStore.getState().setOpen(threadRef, false);
    }
  }, [showAll, popoverOpen, threadRef.environmentId, threadRef.threadId]);
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const [contentHeight, setContentHeight] = useState(0);
  const reportDetailsCard = canvas?.reportDetailsCard;
  const left = preferredPlacement?.x;
  const top = preferredPlacement?.y;
  const width = preferredPlacement?.width;
  const height = preferredPlacement?.height;
  useLayoutEffect(() => {
    if (!content) return;
    const measure = () => {
      // A closed popover has no layout. Keep the last measured height so hiding it
      // cannot remove the obstacle and oscillate between inline and popover.
      if (content.offsetHeight > 0) {
        setContentHeight(content.offsetHeight);
        if (density !== "essential" && !showAll)
          setMeasurements((current) => {
            const base =
              current.key === measurementKey
                ? current
                : { key: measurementKey, full: 0, compact: 0 };
            return base[density] === content.offsetHeight
              ? base
              : { ...base, [density]: content.offsetHeight };
          });
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [content, density, showAll, measurementKey]);
  useLayoutEffect(() => {
    reportDetailsCard?.(
      inline &&
        inlineOpen &&
        contentHeight > 0 &&
        left !== undefined &&
        top !== undefined &&
        width !== undefined &&
        height !== undefined
        ? { left, right: left + width, bottom: top + Math.min(contentHeight, height) }
        : null,
    );
  }, [contentHeight, inline, inlineOpen, left, top, width, height, reportDetailsCard]);
  useLayoutEffect(() => () => reportDetailsCard?.(null), [reportDetailsCard]);

  const open = inline ? inlineOpen : popoverOpen;
  const anchor =
    placement && canvas
      ? {
          getBoundingClientRect: () => {
            const rect = canvas.getContainerRect();
            return new DOMRect(
              (rect?.left ?? 0) + placement.x,
              (rect?.top ?? 0) + placement.y,
              placement.width,
              0,
            );
          },
        }
      : undefined;
  return (
    <Popover
      modal={false}
      open={open}
      onOpenChange={(next, details) => {
        if (inline) {
          if (details.reason === "trigger-press")
            useThreadDetailsStore.getState().setOpen(threadRef, next);
        } else {
          setPopoverOpen(next);
          if (!next && showAll) {
            setShowAll(false);
            useThreadDetailsStore.getState().setOpen(threadRef, false);
          }
        }
      }}
    >
      {toggleContainer
        ? createPortal(
            <Tooltip>
              <TooltipTrigger
                render={
                  <PopoverTrigger
                    render={
                      <Toggle
                        size="sm"
                        variant="ghost"
                        aria-label="Toggle thread details panel"
                        pressed={open}
                      >
                        <NotepadTextIcon className="size-3.5" />
                      </Toggle>
                    }
                  />
                }
              />
              <TooltipPopup>
                Thread details{shortcutLabel ? ` (${shortcutLabel})` : ""}
              </TooltipPopup>
            </Tooltip>,
            toggleContainer,
          )
        : null}
      <PopoverPopup
        anchor={anchor}
        align={inline ? "start" : "end"}
        side="bottom"
        sideOffset={inline ? 0 : 8}
        collisionAvoidance={inline ? { side: "none", align: "none" } : undefined}
        padding="none"
        className="w-70 rounded-3xl bg-transparent shadow-none transition-none before:hidden data-starting-style:scale-100 data-starting-style:opacity-100 [backdrop-filter:none]"
        positionerClassName={inline ? "z-20 transition-none" : "transition-none"}
        role={inline ? "complementary" : "dialog"}
        aria-label="Thread details"
        initialFocus={false}
        finalFocus={false}
        keepMounted
      >
        <div data-thread-details-panel={inline ? "inline" : "popover"} data-density={density}>
          <div
            data-thread-details-card
            className="dropdown-glass isolate contain-paint grid max-h-full grid-rows-[minmax(0,1fr)] overflow-hidden rounded-3xl shadow-none"
            style={{ maxHeight: inline ? placement.height : "min(70dvh, var(--available-height))" }}
          >
            <ScrollArea scrollFade className="min-h-0">
              <div
                ref={setContent}
                className={
                  density === "full"
                    ? ""
                    : density === "compact"
                      ? "[&_[data-details-full]]:hidden"
                      : "[&_[data-details-full]]:hidden [&_[data-details-secondary]]:hidden"
                }
              >
                {children}
                {inline && density !== "full" ? (
                  <button
                    type="button"
                    className="w-full px-3 pb-2 text-left text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setShowAll(true);
                      setPopoverOpen(true);
                    }}
                  >
                    Show all details
                  </button>
                ) : null}
              </div>
            </ScrollArea>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
