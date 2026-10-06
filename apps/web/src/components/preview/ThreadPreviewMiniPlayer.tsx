"use client";

import { useBrowserSurfaceStore } from "~/browser/browserSurfaceStore";
import type { BrowserViewportResizeDirection } from "~/browser/browserViewportLayout";

import { FILL_PREVIEW_VIEWPORT, type ScopedThreadRef } from "@t3tools/contracts";
import { PanelRightIcon, PictureInPicture2, XIcon } from "lucide-react";
import { type PointerEvent as ReactPointerEvent, useLayoutEffect, useRef, useState } from "react";

import { BrowserSurfaceSlot } from "~/browser/BrowserSurfaceSlot";
import { previewRuntimeTabId } from "~/browser/previewRuntimeTabId";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { useThreadPreviewState } from "~/previewStateStore";
import { selectThreadPreviewMiniPlayer, usePreviewMiniPlayerStore } from "~/previewMiniPlayerStore";
import { useRightPanelStore } from "~/rightPanelStore";

import { previewBridge } from "./previewBridge";
import { useChatCanvas } from "../chat/ChatCanvasContext";
import {
  resizePreviewMiniPlayer,
  resolvePreviewMiniPlayerSourceSize,
  type PreviewMiniPlayerFrame,
} from "./previewMiniPlayerLayout";
const PREVIEW_MINI_PLAYER_DEFAULT_SIZE = { width: 320, height: 200 };

interface DragState {
  readonly pointerId: number;
  readonly pointerX: number;
  readonly pointerY: number;
  readonly playerX: number;
  readonly playerY: number;
}

interface ResizeState {
  readonly pointerId: number;
  readonly pointerX: number;
  readonly pointerY: number;
  readonly frame: PreviewMiniPlayerFrame;
  readonly direction: BrowserViewportResizeDirection;
}

interface Props {
  readonly threadRef: ScopedThreadRef;
  readonly tabId: string;
}

export function ThreadPreviewMiniPlayer({ threadRef, tabId }: Props) {
  const canvas = useChatCanvas();
  const [lastInteraction, setLastInteraction] = useState<"drag" | "resize">("drag");
  const rootRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const resizeRef = useRef<ResizeState | null>(null);
  const miniPlayer = usePreviewMiniPlayerStore((state) =>
    selectThreadPreviewMiniPlayer(state.byThreadKey, threadRef),
  );
  const previewState = useThreadPreviewState(threadRef);
  const snapshot = previewState.sessions[tabId] ?? null;
  const runtimeTabId = previewRuntimeTabId(threadRef, previewState.serverEpoch, tabId);
  const desktopOverlay = previewState.desktopByTabId[tabId] ?? null;
  const fittedSourceContent = useBrowserSurfaceStore(
    (state) => state.byTabId[runtimeTabId]?.fittedSourceContent ?? null,
  );
  const sourceSize = resolvePreviewMiniPlayerSourceSize(
    snapshot?.viewport ?? FILL_PREVIEW_VIEWPORT,
    fittedSourceContent,
    desktopOverlay?.zoomFactor ?? 1,
  );
  const position = miniPlayer?.tabId === tabId ? miniPlayer.position : null;
  const size =
    miniPlayer?.tabId === tabId && miniPlayer.size
      ? miniPlayer.size
      : PREVIEW_MINI_PLAYER_DEFAULT_SIZE;
  const close = () => {
    usePreviewMiniPlayerStore.getState().close(threadRef);
  };

  const openInPanel = () => {
    usePreviewMiniPlayerStore.getState().close(threadRef);
    useRightPanelStore.getState().openBrowser(threadRef, tabId);
  };

  const toggleNativePictureInPicture = () => {
    if (!previewBridge) return;
    const operation = desktopOverlay?.pictureInPicture
      ? previewBridge.pictureInPicture.close
      : previewBridge.pictureInPicture.open;
    void operation(runtimeTabId).catch((error) => {
      toastManager.add({
        type: "error",
        title: "Unable to update popped-out preview",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    });
  };

  const reportPreview = canvas?.reportPreview;
  const clearPreview = canvas?.clearPreview;
  useLayoutEffect(() => {
    if (!snapshot) return;
    reportPreview?.({
      key: tabId,
      width: size.width,
      source: { width: sourceSize.width, height: sourceSize.height },
      position,
      lastInteraction,
    });
  }, [
    snapshot,
    reportPreview,
    tabId,
    size.width,
    sourceSize.width,
    sourceSize.height,
    position,
    lastInteraction,
  ]);
  useLayoutEffect(() => () => clearPreview?.(tabId), [clearPreview, tabId]);
  const frame = canvas?.previewKey === tabId ? canvas.layout.frame : null;

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const root = rootRef.current;
    const parent = root?.offsetParent;
    if (!root || !(parent instanceof HTMLElement)) return;
    const rootRect = root.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    setLastInteraction("drag");
    dragRef.current = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      playerX: rootRect.left - parentRect.left,
      playerY: rootRect.top - parentRect.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const root = rootRef.current;
    const parent = root?.offsetParent;
    if (!drag || drag.pointerId !== event.pointerId || !root || !(parent instanceof HTMLElement)) {
      return;
    }
    usePreviewMiniPlayerStore.getState().move(threadRef, tabId, {
      x: drag.playerX + event.clientX - drag.pointerX,
      y: drag.playerY + event.clientY - drag.pointerY,
    });
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleResizePointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    direction: BrowserViewportResizeDirection,
  ) => {
    if (event.button !== 0) return;
    const root = rootRef.current;
    if (!root || !frame) return;
    setLastInteraction("resize");
    resizeRef.current = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      frame,
      direction,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };

  const handleResizePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const resize = resizeRef.current;
    const root = rootRef.current;
    const parent = root?.offsetParent;
    if (
      !resize ||
      resize.pointerId !== event.pointerId ||
      !root ||
      !(parent instanceof HTMLElement)
    ) {
      return;
    }
    const next = resizePreviewMiniPlayer({
      start: resize.frame,
      direction: resize.direction,
      delta: { x: event.clientX - resize.pointerX, y: event.clientY - resize.pointerY },
      source: sourceSize,
      container: { width: parent.clientWidth, height: parent.clientHeight },
    });
    usePreviewMiniPlayerStore
      .getState()
      .resize(threadRef, tabId, { width: next.width, height: next.height });
    usePreviewMiniPlayerStore.getState().move(threadRef, tabId, { x: next.x, y: next.y });
  };

  const endResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (resizeRef.current?.pointerId !== event.pointerId) return;
    resizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  if (!snapshot || miniPlayer?.tabId !== tabId || !frame) return null;

  return (
    <section
      ref={rootRef}
      aria-label="Floating browser preview"
      data-preview-mini-player={tabId}
      className="pointer-events-none absolute select-none"
      style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
    >
      <div className="group pointer-events-auto absolute right-2 top-2 z-[34] size-3">
        <div
          aria-hidden="true"
          className="absolute right-0 top-0 size-2 rounded-full bg-foreground/25 shadow-sm ring-1 ring-background/70 transition-opacity group-hover:opacity-0 group-focus-within:opacity-0"
        />
        <div
          className="pointer-events-none absolute right-0 top-0 flex h-8 cursor-grab items-center gap-0.5 rounded-lg border border-border/80 bg-popover/92 p-0.5 opacity-0 shadow-lg/20 backdrop-blur-xl transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 active:cursor-grabbing"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Open preview in right panel"
            title="Open in right panel"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={openInPanel}
          >
            <PanelRightIcon />
          </Button>
          <Button
            variant={desktopOverlay?.pictureInPicture ? "secondary" : "ghost"}
            size="icon-xs"
            aria-label={
              desktopOverlay?.pictureInPicture
                ? "Close popped-out preview"
                : "Pop preview into separate window"
            }
            title={
              desktopOverlay?.pictureInPicture
                ? "Close separate window"
                : "Pop into separate window"
            }
            disabled={!desktopOverlay?.hasWebContents}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={toggleNativePictureInPicture}
          >
            <PictureInPicture2 />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Close floating preview"
            title="Close floating preview"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={close}
          >
            <XIcon />
          </Button>
        </div>
      </div>

      <div className="relative h-full min-h-0">
        <div className="absolute inset-0 z-[29] rounded-xl bg-muted shadow-2xl/35" />
        <BrowserSurfaceSlot
          tabId={runtimeTabId}
          visible={Boolean(desktopOverlay?.hasWebContents)}
          cornerRadius={12}
          fitSourceContent
          layoutVersion={`${frame.x}:${frame.y}:${frame.width}:${frame.height}`}
          className="absolute inset-0"
        />
        <div className="pointer-events-none absolute inset-0 z-[31] rounded-xl ring-1 ring-inset ring-border/80" />
        {!desktopOverlay?.hasWebContents ? (
          <div className="pointer-events-none absolute inset-0 z-[32] flex items-center justify-center rounded-xl bg-muted text-xs text-muted-foreground">
            Reconnecting preview…
          </div>
        ) : null}
        {(
          [
            ["northwest", "left-0 top-0 cursor-nwse-resize"],
            ["northeast", "right-0 top-0 cursor-nesw-resize"],
            ["southwest", "left-0 bottom-0 cursor-nesw-resize"],
            ["southeast", "right-0 bottom-0 cursor-nwse-resize"],
          ] as const
        ).map(([direction, className]) => (
          <button
            key={direction}
            type="button"
            aria-label={`Resize floating preview ${direction}`}
            className={`pointer-events-auto absolute z-[33] size-3 ${className}`}
            onPointerDown={(event) => handleResizePointerDown(event, direction)}
            onPointerMove={handleResizePointerMove}
            onPointerUp={endResize}
            onPointerCancel={endResize}
          />
        ))}
      </div>
    </section>
  );
}
