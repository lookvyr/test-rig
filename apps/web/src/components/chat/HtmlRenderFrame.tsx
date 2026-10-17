import type { EnvironmentId } from "@t3tools/contracts";
import {
  HTML_RENDER_COLUMN_WIDTH,
  htmlRenderFileName,
  htmlRenderFrameHeight,
  type HtmlRenderReference,
} from "@t3tools/shared/htmlRender";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useAssetUrlRefresh, useAssetUrlState } from "~/assets/assetUrls";
import type { ChatFileAttachment } from "~/types";

import { HtmlRenderViewer } from "./HtmlRenderViewer";
import { flushSync } from "react-dom";

// A frame may load its URL a little after mounting.
const MIN_URL_LIFE_MS = 5 * 60_000;

/**
 * An agent's HTML render inline in the thread: the page itself on the thread's
 * own background, at the server's measured height for this width until the
 * page reports its own. Loading and failure hold the same box so nothing below
 * it moves.
 */
export function HtmlRenderFrame(props: {
  readonly environmentId: EnvironmentId;
  readonly htmlRender: HtmlRenderReference;
  readonly onOpen: (attachment: ChatFileAttachment) => void;
  readonly onFullscreenChange?: ((fullscreen: boolean) => void) | undefined;
}) {
  const { attachmentId, title } = props.htmlRender;
  // The frame takes the page's measured height at its own width, read before
  // first paint so the reserved box is already the right size.
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(HTML_RENDER_COLUMN_WIDTH);
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    setWidth(box.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) flushSync(() => setWidth(entry.contentRect.width));
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  // Client fonts can wrap a page taller than the server measured it; a frame
  // left short would scroll inside the thread and take the reader's scroll.
  const [contentHeight, setContentHeight] = useState<number>();
  const height = htmlRenderFrameHeight(props.htmlRender, width, contentHeight);
  const fileName = htmlRenderFileName(title);
  const resource = useMemo(
    () => ({
      _tag: "attachment" as const,
      attachmentId,
      fileName,
      mimeType: "text/html",
      disposition: "inline" as const,
    }),
    [attachmentId, fileName],
  );
  // A cached URL with life left is reused, so the browser's cache serves the
  // page again; one near expiry is minted afresh, since a frame cannot report a
  // failed load. The page keeps its first URL for its lifetime.
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const assetUrl = useAssetUrlState(src === null ? props.environmentId : null, resource);
  const cachedUrl = assetUrl._tag === "Success" ? assetUrl.url : null;
  const cachedExpiresAt = assetUrl._tag === "Success" ? assetUrl.expiresAt : 0;
  const cacheFailed = assetUrl._tag === "Failure";
  const refresh = useAssetUrlRefresh(props.environmentId, resource);
  // At most one mint per mount: expiry is server time and the check uses the
  // client clock, so a skewed clock must not mint again on every update.
  const minting = useRef(false);
  useEffect(() => {
    if (src !== null || minting.current) return;
    if (cacheFailed) {
      // oxlint-disable-next-line react/set-state-in-effect -- Mirrors the cached URL's failure.
      setFailed(true);
      return;
    }
    if (cachedUrl === null) return;
    if (cachedExpiresAt - Date.now() > MIN_URL_LIFE_MS) {
      setSrc(cachedUrl);
      return;
    }
    minting.current = true;
    void refresh().then(
      (url) => (url === null ? setFailed(true) : setSrc(url)),
      () => setFailed(true),
    );
  }, [cacheFailed, cachedExpiresAt, cachedUrl, refresh, src]);

  return (
    <div ref={boxRef}>
      <HtmlRenderViewer
        src={src}
        title={title}
        height={height}
        failed={failed}
        onContentHeight={setContentHeight}
        onFullscreenChange={props.onFullscreenChange}
        onOpenInPanel={() =>
          props.onOpen({
            type: "file",
            id: attachmentId,
            name: fileName,
            mimeType: "text/html",
            sizeBytes: 0,
            htmlRender: true,
          })
        }
      />
    </div>
  );
}
