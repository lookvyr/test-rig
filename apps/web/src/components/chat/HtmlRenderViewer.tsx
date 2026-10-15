import { ExpandIcon, MinusIcon, PanelRightIcon, PlusIcon, XIcon } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";

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
}) {
  const [expanded, setExpanded] = useState(false);
  const [zoom, setZoom] = useState(1);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

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
            className={
              expanded
                ? "min-h-0 flex-1 overflow-auto overscroll-contain [container-type:size] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                : "size-full"
            }
          >
            <div
              className={expanded ? "h-[100cqh] w-[100cqw]" : "size-full"}
              style={{ zoom: expanded ? zoom : 1 }}
            >
              {props.src !== null ? (
                <HtmlRenderDocument
                  src={props.src}
                  title={props.title}
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
                onClick={() => setZoom((value) => value - 0.25)}
              >
                <MinusIcon />
              </Button>
              <Button aria-label="Reset zoom" size="sm" variant="ghost" onClick={() => setZoom(1)}>
                {Math.round(zoom * 100)}%
              </Button>
              <Button
                aria-label="Zoom in"
                size="icon-sm"
                variant="ghost"
                disabled={zoom === 2}
                onClick={() => setZoom((value) => value + 0.25)}
              >
                <PlusIcon />
              </Button>
            </div>
          ) : null}
        </dialog>
      </div>
    </>
  );
}
