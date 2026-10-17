import { ExpandIcon, HandIcon, MinusIcon, PanelRightIcon, PlusIcon, XIcon } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import { HtmlRenderDocument } from "../files/BrowserDocumentFrame";
import { Button } from "../ui/button";

export function HtmlRenderViewer(props: {
  readonly src: string | null;
  readonly title: string;
  readonly height: number;
  readonly failed: boolean;
  readonly onContentHeight: (height: number) => void;
  readonly onOpenInPanel: () => void;
  readonly onFullscreenChange?: ((fullscreen: boolean) => void) | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  const fullscreen = expanded || imageOpen;
  const { onFullscreenChange } = props;
  useEffect(() => {
    if (!fullscreen) return;
    onFullscreenChange?.(true);
    return () => onFullscreenChange?.(false);
  }, [fullscreen, onFullscreenChange]);
  const [zoom, setZoom] = useState(1);
  const [panning, setPanning] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const panActive = expanded && panning;

  const changeZoom = (next: number) => {
    setZoom(next);
    if (next <= 1) setPanning(false);
    else if (next > zoom) setPanning(true);
  };

  // Promote the same document into the top layer: reparenting or a second
  // iframe would reload it and lose the reader's interactive state.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (expanded) {
      dialog.close();
      dialog.showModal();
      closeButtonRef.current?.focus({ preventScroll: true });
    } else if (dialog.matches(":modal")) {
      dialog.close();
      dialog.show();
      expandButtonRef.current?.focus({ preventScroll: true });
    }
  }, [expanded]);

  return (
    <>
      <div className="flex justify-end gap-1 pb-1">
        <Button
          ref={expandButtonRef}
          aria-label={`Expand ${props.title}`}
          title="Expand visualization"
          size="icon-xs"
          variant="ghost"
          disabled={props.src === null}
          onClick={() => {
            setZoom(1);
            setPanning(false);
            setExpanded(true);
          }}
        >
          <ExpandIcon className="size-3.5" />
        </Button>
        <Button
          aria-label="Open in panel"
          title="Open in panel"
          size="icon-xs"
          variant="ghost"
          disabled={props.src === null}
          onClick={props.onOpenInPanel}
        >
          <PanelRightIcon className="size-3.5" />
        </Button>
      </div>
      <div style={{ height: props.height }}>
        <dialog
          ref={dialogRef}
          open
          role={expanded ? "dialog" : "presentation"}
          aria-labelledby={expanded ? titleId : undefined}
          onKeyDown={expanded ? (event) => event.stopPropagation() : undefined}
          className={cn(
            "max-h-none max-w-none border-0 p-0 text-foreground",
            expanded
              ? "fixed inset-0 m-auto flex h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl bg-background shadow-2xl ring-1 ring-border backdrop:bg-black/70 [-webkit-app-region:no-drag]"
              : "static m-0 block size-full bg-transparent",
          )}
          onClose={(event) => {
            // Native Escape closes the dialog before notifying React. Our own
            // close/show transitions already reopened it by the time this runs.
            if (!event.currentTarget.open) {
              event.currentTarget.show();
              expandButtonRef.current?.focus({ preventScroll: true });
              setExpanded(false);
            }
          }}
        >
          {expanded ? (
            <div className="flex shrink-0 items-center gap-3 border-b px-3 py-2">
              <h2 id={titleId} className="min-w-0 flex-1 truncate text-sm font-medium">
                {props.title}
              </h2>
              <Button
                ref={closeButtonRef}
                aria-label="Close expanded visualization"
                size="icon-sm"
                variant="ghost"
                onClick={() => setExpanded(false)}
              >
                <XIcon />
              </Button>
            </div>
          ) : null}
          <div
            role={expanded ? "region" : undefined}
            aria-label={expanded ? "Visualization pan area" : undefined}
            aria-description={
              panActive
                ? "Drag to pan, or use the arrow keys to scroll. Turn off the Hand tool to interact with the page."
                : undefined
            }
            tabIndex={panActive ? 0 : undefined}
            className={cn(
              expanded
                ? "min-h-0 flex-1 overflow-auto overscroll-contain [container-type:size] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                : "size-full",
              panActive && "cursor-grab touch-none select-none active:cursor-grabbing",
            )}
            onKeyDownCapture={panActive ? (event) => event.stopPropagation() : undefined}
            onPointerDown={
              panActive
                ? (event) => {
                    if (event.button !== 0 || dragRef.current) return;
                    const viewport = event.currentTarget;
                    event.preventDefault();
                    viewport.focus({ preventScroll: true });
                    dragRef.current = {
                      pointerId: event.pointerId,
                      x: event.clientX,
                      y: event.clientY,
                      left: viewport.scrollLeft,
                      top: viewport.scrollTop,
                    };
                    viewport.setPointerCapture(event.pointerId);
                  }
                : undefined
            }
            onPointerMove={
              panActive
                ? (event) => {
                    const drag = dragRef.current;
                    if (!drag || drag.pointerId !== event.pointerId) return;
                    event.currentTarget.scrollLeft = drag.left - (event.clientX - drag.x);
                    event.currentTarget.scrollTop = drag.top - (event.clientY - drag.y);
                  }
                : undefined
            }
            onPointerUp={(event) => {
              if (dragRef.current?.pointerId !== event.pointerId) return;
              dragRef.current = null;
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            onLostPointerCapture={(event) => {
              if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
            }}
          >
            <div
              className={expanded ? "h-[100cqh] w-[100cqw]" : "size-full"}
              style={{ zoom: expanded ? zoom : 1 }}
              inert={panActive}
            >
              {props.src !== null ? (
                <HtmlRenderDocument
                  src={props.src}
                  title={props.title}
                  onImageOpenChange={setImageOpen}
                  className="block size-full"
                  {...(expanded ? {} : { onContentHeight: props.onContentHeight })}
                  {...(expanded ? { onEscape: () => setExpanded(false) } : {})}
                />
              ) : props.failed ? (
                <p className="flex size-full items-center justify-center text-xs text-muted-foreground">
                  Unable to load {props.title}
                </p>
              ) : null}
            </div>
          </div>
          {expanded ? (
            <div className="flex shrink-0 items-center justify-center gap-1 border-t px-3 py-2">
              <Button
                aria-label="Zoom out"
                size="icon-sm"
                variant="ghost"
                disabled={zoom === 0.5}
                onClick={() => changeZoom(zoom - 0.25)}
              >
                <MinusIcon />
              </Button>
              <Button
                aria-label="Reset zoom"
                size="sm"
                variant="ghost"
                onClick={() => changeZoom(1)}
              >
                {Math.round(zoom * 100)}%
              </Button>
              <Button
                aria-label="Zoom in"
                size="icon-sm"
                variant="ghost"
                disabled={zoom === 2}
                onClick={() => changeZoom(zoom + 0.25)}
              >
                <PlusIcon />
              </Button>
              <span aria-hidden="true" className="mx-1 h-4 w-px bg-border" />
              <Button
                aria-label="Hand tool"
                aria-pressed={panning}
                title={
                  panning
                    ? "Turn off Hand tool to interact with the page"
                    : "Hand tool: drag to pan"
                }
                size="icon-sm"
                variant={panning ? "secondary" : "ghost"}
                disabled={zoom <= 1}
                onClick={() => setPanning((value) => !value)}
              >
                <HandIcon />
              </Button>
              <span aria-live="polite" className="ml-1 text-xs text-muted-foreground">
                {panning ? (
                  <>
                    Drag to pan
                    <span className="sr-only">
                      . Turn off the Hand tool to interact with the page.
                    </span>
                  </>
                ) : zoom > 1 ? (
                  "Interact with page"
                ) : null}
              </span>
            </div>
          ) : null}
        </dialog>
      </div>
    </>
  );
}
