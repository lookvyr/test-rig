import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
} from "react";
import { flushSync } from "react-dom";
import { ChatCanvasContext } from "./ChatCanvasContext";
import { resolveChatCanvasLayout, type ChatCanvasPreview } from "./chatCanvasLayout";
import type { PreviewMiniPlayerObstacles } from "../preview/previewMiniPlayerLayout";

/**
 * Owns the available conversation space. Cards only report where they sit; the
 * canvas decides when chat moves over to make room for them.
 */
export function ChatCanvas({
  composerOverlayElement,
  children,
  ...props
}: Omit<ComponentProps<"div">, "className" | "style" | "ref"> & {
  composerOverlayElement: HTMLElement | null;
}) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const widthProbeRef = useRef<HTMLDivElement | null>(null);
  const [timelineElement, registerTimeline] = useState<HTMLElement | null>(null);
  const [preview, setPreview] = useState<ChatCanvasPreview | null>(null);
  const [detailsCard, setDetailsCard] = useState<PreviewMiniPlayerObstacles["detailsCard"]>(null);
  const reportDetailsCard = useCallback((next: PreviewMiniPlayerObstacles["detailsCard"]) => {
    setDetailsCard((current) =>
      current?.left === next?.left &&
      current?.right === next?.right &&
      current?.bottom === next?.bottom
        ? current
        : next,
    );
  }, []);
  const [measurements, setMeasurements] = useState({
    width: 0,
    height: 0,
    padding: 20,
    maxChatWidth: 768,
    minChatWidth: 640,
    composerHeight: 0,
    timelineGutter: 0,
  });
  const reportPreview = useCallback((next: ChatCanvasPreview) => {
    setPreview((current) =>
      current?.key === next.key &&
      current.width === next.width &&
      current.lastInteraction === next.lastInteraction &&
      current.position?.x === next.position?.x &&
      current.position?.y === next.position?.y &&
      current.source.width === next.source.width &&
      current.source.height === next.source.height
        ? current
        : next,
    );
  }, []);
  const clearPreview = useCallback(
    (key: string) => setPreview((current) => (current?.key === key ? null : current)),
    [],
  );
  useLayoutEffect(() => {
    const probe = widthProbeRef.current;
    if (!element || !probe) return;
    const composer =
      composerOverlayElement?.querySelector<HTMLElement>("[data-chat-composer-form]") ??
      composerOverlayElement;
    const measure = () => {
      const styles = getComputedStyle(probe);
      const next = {
        width: element.clientWidth,
        height: element.clientHeight,
        padding: Number.parseFloat(styles.paddingLeft),
        maxChatWidth:
          getComputedStyle(element).getPropertyValue("--chat-content-max-width").trim() === "none"
            ? element.clientWidth
            : Number.parseFloat(styles.width),
        minChatWidth: Number.parseFloat(styles.minWidth),
        composerHeight: composer
          ? Math.max(
              0,
              element.getBoundingClientRect().bottom - composer.getBoundingClientRect().top,
            )
          : 0,
        timelineGutter: timelineElement
          ? (timelineElement.offsetWidth - timelineElement.clientWidth) / 2
          : 0,
      };
      setMeasurements((current) =>
        Object.keys(next).every(
          (key) => current[key as keyof typeof current] === next[key as keyof typeof next],
        )
          ? current
          : next,
      );
    };
    measure();
    const observer = new ResizeObserver(() => flushSync(measure));
    observer.observe(element);
    observer.observe(probe);
    if (composerOverlayElement) observer.observe(composerOverlayElement);
    if (composer) observer.observe(composer);
    if (timelineElement) observer.observe(timelineElement);
    return () => observer.disconnect();
  }, [element, composerOverlayElement, timelineElement]);
  const getContainerRect = useCallback(() => element?.getBoundingClientRect(), [element]);
  const context = useMemo(() => {
    const container = { width: measurements.width, height: measurements.height };
    return {
      container,
      getContainerRect,
      lane: { padding: measurements.padding, minChatWidth: measurements.minChatWidth },
      layout: resolveChatCanvasLayout({ ...measurements, container, preview, detailsCard }),
      previewKey: preview?.key ?? null,
      reportPreview,
      clearPreview,
      registerTimeline,
      reportDetailsCard,
    };
  }, [
    measurements,
    preview,
    detailsCard,
    reportPreview,
    clearPreview,
    reportDetailsCard,
    getContainerRect,
  ]);
  const { layout } = context;
  return (
    <ChatCanvasContext value={context}>
      <div
        {...props}
        ref={setElement}
        data-chat-canvas
        data-preview-overlaps-chat={layout.overlapsChat || undefined}
        className="relative flex min-h-0 min-w-0 flex-1 flex-col"
        style={
          {
            "--chat-timeline-gutter": `${measurements.timelineGutter}px`,
            "--chat-lane-inset-start": `${layout.chat.insetStart}px`,
            "--chat-lane-inset-end": `${layout.chat.insetEnd}px`,
          } as CSSProperties
        }
      >
        <div
          ref={widthProbeRef}
          aria-hidden
          className="pointer-events-none invisible absolute h-0 w-(--chat-content-max-width) min-w-[40rem] box-content ps-3 sm:ps-5"
        />
        {children}
      </div>
    </ChatCanvasContext>
  );
}
