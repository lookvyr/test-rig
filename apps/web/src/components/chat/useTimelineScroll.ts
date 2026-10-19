import type { LegendListRef } from "@legendapp/list/react";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { resolveTimelineIsAtEnd } from "./MessagesTimeline.logic";
import {
  readTimelinePosition,
  timelineContentOverflowsViewport,
  type TimelineScrollMode,
} from "./timelineScrollAnchoring";

/** Follow is user intent; content growing beyond the viewport does not cancel it. */
export function useTimelineScroll({
  threadKey,
  listRef,
  composerInset = 0,
  anchorOffset = 0,
  onManualNavigation,
}: {
  threadKey: string | null;
  listRef: RefObject<LegendListRef | null>;
  composerInset?: number;
  anchorOffset?: number;
  onManualNavigation?: () => void;
}) {
  const modeRef = useRef<TimelineScrollMode>("following-end");
  const [liveFollowEnabled, setLiveFollowEnabled] = useState(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [scrollNode, onScrollElementChange] = useState<HTMLElement | null>(null);
  const scrollFrame = useRef<number | null>(null);
  const navigationScrollOffset = useRef<number | null>(null);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelButtonReveal = useCallback(() => {
    if (revealTimer.current !== null) {
      clearTimeout(revealTimer.current);
      revealTimer.current = null;
    }
  }, []);
  const cancelPendingScroll = useCallback(() => {
    if (scrollFrame.current !== null) {
      cancelAnimationFrame(scrollFrame.current);
      scrollFrame.current = null;
    }
  }, []);
  const resumeFollowing = useCallback(
    (mode: "following-end" | "anchoring-new-turn" = "following-end") => {
      cancelPendingScroll();
      modeRef.current = mode;
      navigationScrollOffset.current = null;
      setLiveFollowEnabled(true);
      cancelButtonReveal();
      setShowScrollToBottom(false);
    },
    [cancelPendingScroll, cancelButtonReveal],
  );
  const cancelForUserNavigation = useCallback(() => {
    cancelPendingScroll();
    modeRef.current = "free-scrolling";
    navigationScrollOffset.current = listRef.current?.getState().scroll ?? null;
    setLiveFollowEnabled(false);
    onManualNavigation?.();
  }, [cancelPendingScroll, listRef, onManualNavigation]);
  const onIsAtEndChange = useCallback(
    (isAtEnd: boolean) => {
      if (modeRef.current !== "free-scrolling") return;
      const offset = listRef.current?.getState().scroll ?? null;
      const movedDown =
        offset !== null &&
        navigationScrollOffset.current !== null &&
        offset > navigationScrollOffset.current;
      navigationScrollOffset.current = offset;
      // PageUp/wheel-up can report "at end" before moving out of the bottom band.
      // Only returning toward the end should re-arm follow, even for a tiny scroll.
      if (isAtEnd && movedDown) {
        resumeFollowing();
      } else if (!isAtEnd && revealTimer.current === null) {
        // Schedule once per departure; stream/scroll reports must not postpone the button.
        revealTimer.current = setTimeout(() => setShowScrollToBottom(true), 150);
      }
    },
    [listRef, resumeFollowing],
  );
  const scrollToEnd = useCallback(
    (animated = false) => {
      resumeFollowing();
      scrollFrame.current = requestAnimationFrame(() => {
        scrollFrame.current = null;
        void listRef.current?.scrollToEnd({ animated });
      });
    },
    [listRef, resumeFollowing],
  );

  useEffect(() => {
    if (threadKey !== null && readTimelinePosition(threadKey)?.atEnd === false) {
      cancelForUserNavigation();
    } else {
      resumeFollowing();
    }
    return () => {
      cancelPendingScroll();
      cancelButtonReveal();
    };
  }, [
    threadKey,
    cancelForUserNavigation,
    resumeFollowing,
    cancelPendingScroll,
    cancelButtonReveal,
  ]);

  // The timeline supplies its actual node, including when an empty/loading list mounts later.
  useEffect(() => {
    if (!scrollNode) return;
    const contentScrollsUp = () =>
      timelineContentOverflowsViewport(listRef.current?.getState(), {
        composerInset,
        anchorOffset,
      });
    const viewportIsAwayFromEnd = () =>
      resolveTimelineIsAtEnd(listRef.current?.getState()) === false;
    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY < 0 && contentScrollsUp()) cancelForUserNavigation();
    };
    const handleTouchMove = () => {
      if (viewportIsAwayFromEnd()) cancelForUserNavigation();
    };
    // A margin click must not count as a scrollbar drag. Wait for upward movement.
    let pointerScrollStart: number | null = null;
    const clearPointerScroll = () => {
      pointerScrollStart = null;
    };
    const handlePointerScroll = () => {
      if (pointerScrollStart !== null && scrollNode.scrollTop < pointerScrollStart) {
        clearPointerScroll();
        cancelForUserNavigation();
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      pointerScrollStart = event.target === scrollNode ? scrollNode.scrollTop : null;
      if (viewportIsAwayFromEnd()) cancelForUserNavigation();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        !((event.metaKey || event.ctrlKey) && ["ArrowUp", "ArrowDown"].includes(event.key)) &&
        ["PageUp", "Home", "ArrowUp"].includes(event.key) &&
        !(
          event.target instanceof Element &&
          event.target.closest("input, textarea, [contenteditable=true]")
        ) &&
        contentScrollsUp()
      ) {
        cancelForUserNavigation();
      }
    };
    scrollNode.addEventListener("wheel", handleWheel, { passive: true });
    scrollNode.addEventListener("touchmove", handleTouchMove, { passive: true });
    scrollNode.addEventListener("pointerdown", handlePointerDown, { passive: true });
    scrollNode.addEventListener("scroll", handlePointerScroll, { passive: true });
    scrollNode.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerup", clearPointerScroll);
    window.addEventListener("pointercancel", clearPointerScroll);
    window.addEventListener("blur", clearPointerScroll);
    return () => {
      scrollNode.removeEventListener("wheel", handleWheel);
      scrollNode.removeEventListener("touchmove", handleTouchMove);
      scrollNode.removeEventListener("pointerdown", handlePointerDown);
      scrollNode.removeEventListener("scroll", handlePointerScroll);
      scrollNode.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerup", clearPointerScroll);
      window.removeEventListener("pointercancel", clearPointerScroll);
      window.removeEventListener("blur", clearPointerScroll);
    };
  }, [scrollNode, listRef, composerInset, anchorOffset, cancelForUserNavigation]);

  return {
    modeRef,
    liveFollowEnabled,
    showScrollToBottom,
    resumeFollowing,
    scrollToEnd,
    cancelForUserNavigation,
    onIsAtEndChange,
    onScrollElementChange,
  };
}
