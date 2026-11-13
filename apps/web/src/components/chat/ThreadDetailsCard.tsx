import { createPortal } from "react-dom";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useLayoutEffect, useState, type MouseEventHandler, type ReactNode } from "react";
import { SquareMenuIcon } from "lucide-react";
import { requestWorkspaceFocus, workspaceAreaProps } from "../../lib/workspaceFocus";
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

export type ThreadDetailsDensity = "full" | "compact" | "essential";

// Lists that scroll as they grow. Counting them toward density would hide the workspace
// controls whenever a list gets long, so the fit measurement leaves them out.
const SCROLLING_LISTS_SELECTOR =
  "[data-thread-relationships-panel], [data-thread-automations-panel], [data-thread-details-server-overflow], [data-thread-pr-watch]";

/** One persistent controls tree: moving between card and popover must not discard open forms. */
export function ThreadDetailsCard({
  threadRef,
  toggleContainer,
  children,
  shortcutLabel,
  contentKey,
  onContextMenu,
  findBarOpen = false,
}: {
  threadRef: ScopedThreadRef;
  /** Renders the rows that fit the card's density. */
  children: (density: ThreadDetailsDensity) => ReactNode;
  toggleContainer: HTMLElement | null;
  shortcutLabel?: string | undefined;
  /** Changes when the set of rendered items changes, so cached heights are measured again. */
  contentKey: string;
  onContextMenu?: MouseEventHandler<HTMLDivElement> | undefined;
  /** The thread's find bar is open; the card moves below it. */
  findBarOpen?: boolean;
}) {
  const canvas = useChatCanvas();
  // The find bar sits at the top right of the conversation, where the card goes.
  const [findClearance, setFindClearance] = useState({ inline: 0, popover: 0 });
  const getContainerRect = canvas?.getContainerRect;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the open find bar's position from the DOM
  useLayoutEffect(() => {
    const bar = findBarOpen
      ? document.querySelector<HTMLElement>("[data-thread-find-bar]")?.getBoundingClientRect()
      : undefined;
    const containerTop = getContainerRect?.()?.top;
    const toggleBottom = toggleContainer?.getBoundingClientRect().bottom;
    setFindClearance({
      inline: bar && containerTop !== undefined ? Math.max(0, bar.bottom - containerTop) : 0,
      popover: bar && toggleBottom !== undefined ? Math.max(0, bar.bottom - toggleBottom) : 0,
    });
  }, [findBarOpen, getContainerRect, toggleContainer]);
  const detailsArea = workspaceAreaProps("details", 3, "Thread details");
  const placement = canvas
    ? resolveThreadDetailsCardLayout({
        container: canvas.container,
        lane: canvas.lane,
        frame: canvas.layout.frame,
        overlapsDetailsCard: canvas.layout.overlapsDetailsCard,
        topInset: findClearance.inline,
      })
    : null;
  const preferredPlacement = canvas
    ? resolveThreadDetailsCardLayout({
        container: canvas.container,
        lane: canvas.lane,
        frame: null,
        topInset: findClearance.inline,
      })
    : null;
  const inline = placement !== null;
  const measurementKey = `${scopedThreadKey(threadRef)}:${preferredPlacement?.width ?? "popup"}:${contentKey}`;
  const [measurements, setMeasurements] = useState({ key: measurementKey, full: 0, compact: 0 });
  const contentHeights =
    measurements.key === measurementKey ? measurements : { full: 0, compact: 0 };
  // The popover drops below the header, so it gets the chat height minus the header.
  const availableHeight = placement?.height ?? Math.max(0, (canvas?.container.height ?? 0) - 52);
  const density = canvas
    ? resolveThreadDetailsCardDensity(availableHeight, contentHeights)
    : "full";
  const inlineOpen = useThreadDetailsStore(
    (state) => !state.hiddenByThreadKey[scopedThreadKey(threadRef)],
  );
  const popoverOpen = useThreadDetailsStore(
    (state) => state.popoverOpenByThreadKey[scopedThreadKey(threadRef)] ?? false,
  );
  useLayoutEffect(() => {
    useThreadDetailsStore.getState().setPresentation(threadRef, inline ? "inline" : "popover");
    if (inline) useThreadDetailsStore.getState().setPopoverOpen(threadRef, false);
  }, [inline, threadRef.environmentId, threadRef.threadId]);
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
      if (content.offsetHeight === 0) return;
      setContentHeight(content.offsetHeight);
      if (density === "essential") return;
      const lists = content.querySelectorAll<HTMLElement>(SCROLLING_LISTS_SELECTOR);
      const fittingHeight =
        content.offsetHeight - Array.from(lists).reduce((sum, list) => sum + list.offsetHeight, 0);
      setMeasurements((current) => {
        const base =
          current.key === measurementKey ? current : { key: measurementKey, full: 0, compact: 0 };
        return base[density] === fittingHeight ? base : { ...base, [density]: fittingHeight };
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [content, density, measurementKey]);
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
          return;
        }
        // Using the find bar keeps the popover open beside it.
        const target =
          details.reason === "focus-out"
            ? (details.event as FocusEvent).relatedTarget
            : details.reason === "outside-press"
              ? details.event.target
              : null;
        if (!next && target instanceof Element && target.closest("[data-thread-find-bar]")) {
          details.cancel();
          return;
        }
        useThreadDetailsStore.getState().setPopoverOpen(threadRef, next);
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
                        className="shrink-0 [-webkit-app-region:no-drag]"
                        aria-label="Toggle thread details panel"
                        pressed={open}
                      >
                        <SquareMenuIcon className="size-3.5" />
                      </Toggle>
                    }
                  />
                }
              />
              <TooltipPopup side="bottom">
                Toggle thread details{shortcutLabel ? ` (${shortcutLabel})` : ""}
              </TooltipPopup>
            </Tooltip>,
            toggleContainer,
          )
        : null}
      <PopoverPopup
        anchor={anchor}
        align={inline ? "start" : "end"}
        side="bottom"
        sideOffset={inline ? 0 : 8 + findClearance.popover}
        collisionAvoidance={inline ? { side: "none", align: "none" } : undefined}
        padding="none"
        className="w-70 rounded-3xl redesign:rounded-xl bg-transparent shadow-none transition-none before:hidden data-starting-style:scale-100 data-starting-style:opacity-100 [backdrop-filter:none]"
        positionerClassName={inline ? "z-20 transition-none" : "z-40 transition-none"}
        role={inline ? "complementary" : "dialog"}
        aria-label="Thread details"
        data-workspace-area-host
        initialFocus={
          inline
            ? false
            : () => {
                requestWorkspaceFocus({ area: "details" });
                return false;
              }
        }
        // The popover took focus when it opened, so closing it hands focus back to the toggle.
        finalFocus={!inline}
        keepMounted
      >
        <div
          {...detailsArea}
          data-workspace-focus-key={`details:${scopedThreadKey(threadRef)}`}
          data-thread-details-panel={inline ? "inline" : "popover"}
          data-density={density}
          className="outline-none"
        >
          <div
            data-thread-details-card
            className="dropdown-glass isolate contain-paint grid max-h-full grid-rows-[minmax(0,1fr)] overflow-hidden rounded-3xl redesign:rounded-xl shadow-none"
            style={{ maxHeight: inline ? placement.height : "min(70dvh, var(--available-height))" }}
            onContextMenu={onContextMenu}
          >
            <ScrollArea scrollFade className="min-h-0">
              <div ref={setContent}>{children(density)}</div>
            </ScrollArea>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
