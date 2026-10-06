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
import { resolveThreadDetailsCardLayout } from "./threadDetailsCardLayout";

/** One persistent controls tree: moving between card and popover must not discard open forms. */
export function ThreadDetailsCard({
  threadRef,
  toggleContainer,
  children,
}: {
  threadRef: ScopedThreadRef;
  children: ReactNode;
  toggleContainer: HTMLElement | null;
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
  const inline = placement !== null;
  const inlineOpen = useThreadDetailsStore(
    (state) => !state.hiddenByThreadKey[scopedThreadKey(threadRef)],
  );
  const [popoverOpen, setPopoverOpen] = useState(false);
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
      if (content.offsetHeight > 0) setContentHeight(content.offsetHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [content]);
  useLayoutEffect(() => {
    reportDetailsCard?.(
      inlineOpen &&
        contentHeight > 0 &&
        left !== undefined &&
        top !== undefined &&
        width !== undefined &&
        height !== undefined
        ? { left, right: left + width, bottom: top + Math.min(contentHeight, height) }
        : null,
    );
  }, [contentHeight, inlineOpen, left, top, width, height, reportDetailsCard]);
  useLayoutEffect(() => () => reportDetailsCard?.(null), [reportDetailsCard]);
  if (inline && popoverOpen) setPopoverOpen(false);

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
        } else setPopoverOpen(next);
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
              <TooltipPopup>Thread details</TooltipPopup>
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
        className="w-70 rounded-3xl bg-transparent shadow-none before:hidden [backdrop-filter:none]"
        positionerClassName={inline ? "z-20" : ""}
        role={inline ? "complementary" : "dialog"}
        aria-label="Thread details"
        initialFocus={false}
        finalFocus={false}
        keepMounted
      >
        <div data-thread-details-panel={inline ? "inline" : "popover"}>
          <div
            data-thread-details-card
            className="dropdown-glass isolate contain-paint grid max-h-full grid-rows-[minmax(0,1fr)] overflow-hidden rounded-3xl shadow-none"
            style={{ maxHeight: placement?.height ?? "min(70dvh, var(--available-height))" }}
          >
            <ScrollArea scrollFade className="min-h-0">
              <div ref={setContent}>{children}</div>
            </ScrollArea>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
