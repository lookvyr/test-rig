import { ChevronDownIcon, ChevronUpIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LegendListRef } from "@legendapp/list/react";
import type {
  MessageId,
  ScopedThreadRef,
  OrchestrationThread,
  OrchestrationThreadSearchMessage,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { useEnvironmentThread } from "../../state/threads";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  findMessageRanges,
  findTextOffsets,
  normalizeFindText,
  threadMessageFindText,
  type ThreadFindMatch,
} from "./ThreadFind.logic";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";

interface ThreadFindProps {
  request: number;
  markdownCwd: string | undefined;
  threadRef: ScopedThreadRef;
  viewport: HTMLDivElement | null;
  listRef: React.RefObject<LegendListRef | null>;
  rows: readonly MessagesTimelineRow[];
  onSelectMessage: (id: MessageId | null) => void;
  onManualNavigation: () => void;
  onClose: () => void;
  onSearchHistory: (thread: OrchestrationThread | null) => void;
}

export function ThreadFind({
  request,
  markdownCwd,
  threadRef,
  viewport,
  listRef,
  rows,
  onSelectMessage,
  onManualNavigation,
  onClose,
  onSearchHistory,
}: ThreadFindProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [settledQuery, setSettledQuery] = useState("");
  const [matches, setMatches] = useState<readonly ThreadFindMatch[]>([]);
  const [index, setIndex] = useState(0);
  const [indexing, setIndexing] = useState(false);
  const [navigationRequest, setNavigationRequest] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const navigationRef = useRef(false);
  const textCache = useRef(
    new Map<string, { source: string; cwd: string | undefined; text: string }>(),
  );
  const state = useEnvironmentThread(threadRef.environmentId, threadRef.threadId);
  const normalizedQuery = normalizeFindText(query);
  const runSearch = useAtomQueryRunner(orchestrationEnvironment.threadSearchMessages, {
    reportFailure: false,
  });
  const [search, setSearch] = useState<{
    messages: readonly OrchestrationThreadSearchMessage[];
    pending: boolean;
    error: boolean;
  }>({ messages: [], pending: false, error: false });
  useEffect(() => {
    let cancelled = false;
    if (!open || !settledQuery) {
      setSearch({ messages: [], pending: false, error: false });
      return;
    }
    setSearch({ messages: [], pending: true, error: false });
    async function load() {
      const messages: OrchestrationThreadSearchMessage[] = [];
      let cursor: { createdAt: string; id: MessageId } | undefined;
      do {
        const result = await runSearch({
          environmentId: threadRef.environmentId,
          input: {
            threadId: threadRef.threadId,
            query: settledQuery,
            ...(cursor ? { cursor } : {}),
          },
        });
        if (cancelled) return;
        if (result._tag !== "Success") {
          setSearch({ messages: [], pending: false, error: true });
          return;
        }
        messages.push(...result.value.messages);
        cursor = result.value.nextCursor ?? undefined;
      } while (cursor);
      if (!cancelled) setSearch({ messages, pending: false, error: false });
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, settledQuery, runSearch, threadRef]);

  useEffect(() => {
    if (request === 0) return;
    if (
      document.activeElement instanceof HTMLElement &&
      !document.activeElement.closest('[role="search"][aria-label="Find in thread"]')
    ) {
      returnFocusRef.current = document.activeElement;
    }
    setOpen(true);
  }, [request]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [open, request]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSettledQuery(normalizedQuery), 120);
    return () => window.clearTimeout(timer);
  }, [normalizedQuery]);

  const messages = useMemo(() => {
    if (!open) return [];
    const byId = new Map(search.messages.map((message) => [message.id, message]));
    // The subscription owns live text, including a response still streaming.
    for (const message of Option.getOrNull(state.data)?.messages ?? []) {
      if (message.role === "user" || message.role === "assistant")
        byId.set(message.id, { ...message, role: message.role });
    }
    return [...byId.values()].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
  }, [open, search.messages, state.data]);

  useEffect(() => {
    let cancelled = false;
    if (!open || !settledQuery || search.pending) {
      setMatches([]);
      setIndexing(false);
      return;
    }
    setIndexing(true);
    async function buildMatches() {
      const found: ThreadFindMatch[] = [];
      let yieldedAt = performance.now();
      for (const message of messages) {
        let cached = textCache.current.get(message.id);
        if (cached?.source !== message.text || cached?.cwd !== markdownCwd) {
          cached = {
            source: message.text,
            cwd: markdownCwd,
            text: threadMessageFindText(message, markdownCwd),
          };
          textCache.current.set(message.id, cached);
        }
        findTextOffsets(cached.text, settledQuery).forEach((_, occurrence) =>
          found.push({ messageId: message.id, occurrence }),
        );
        if (performance.now() - yieldedAt > 8) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          yieldedAt = performance.now();
        }
        if (cancelled) return;
      }
      setMatches(found);
      setIndex((current) => Math.min(current, Math.max(0, found.length - 1)));
      setIndexing(false);
    }
    void buildMatches();
    return () => {
      cancelled = true;
    };
  }, [messages, open, search.pending, settledQuery, markdownCwd]);

  const pending = normalizedQuery !== settledQuery || search.pending || indexing;
  const active = open && !pending ? matches[index] : undefined;
  const activeMessageId = active?.messageId ?? null;
  useEffect(() => {
    onSelectMessage(activeMessageId);
  }, [activeMessageId, onSelectMessage]);

  const activeIsLive = active
    ? (Option.getOrNull(state.data)?.messages.some((message) => message.id === active.messageId) ??
      false)
    : false;
  const context = useEnvironmentQuery(
    active && !activeIsLive
      ? orchestrationEnvironment.threadSearchContext({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId, messageId: active.messageId },
        })
      : null,
  );
  useEffect(() => {
    if (!active || !navigationRef.current) return;
    if (activeIsLive) onSearchHistory(null);
    else if (context.data?.thread) onSearchHistory(context.data.thread);
  }, [active, activeIsLive, context.data, onSearchHistory, navigationRequest]);
  const navigationError = Boolean(
    context.error || (active && !activeIsLive && context.data && !context.data.thread),
  );

  const rowIndex = active
    ? rows.findIndex((row) => row.kind === "message" && row.message.id === active.messageId)
    : -1;
  useEffect(() => {
    if (!active || rowIndex < 0 || !navigationRef.current) return;
    onManualNavigation();
    void listRef.current?.scrollToIndex({ index: rowIndex, animated: false, viewPosition: 0.4 });
  }, [active, rowIndex, listRef, onManualNavigation, navigationRequest]);

  useEffect(() => {
    if (!viewport || !open || !settledQuery || pending || typeof Highlight === "undefined") return;
    let frame = 0;
    const update = () => {
      const allRanges: Range[] = [];
      let activeRange: Range | undefined;
      for (const element of viewport.querySelectorAll("[data-message-id]")) {
        if (
          element.getAttribute("data-message-id") === active?.messageId &&
          navigationRef.current
        ) {
          element
            .querySelectorAll<HTMLButtonElement>(
              '[data-markdown-details-open="false"] > [data-markdown-details-summary]',
            )
            .forEach((button) => button.click());
        }
        const bodies = [...element.querySelectorAll(".chat-markdown")];
        const ranges = bodies.flatMap((body) => findMessageRanges(body, settledQuery));
        allRanges.push(...ranges);
        if (element.getAttribute("data-message-id") === active?.messageId)
          activeRange = ranges[active.occurrence];
      }
      CSS.highlights.set("thread-find", new Highlight(...allRanges));
      CSS.highlights.set(
        "thread-find-current",
        new Highlight(...(activeRange ? [activeRange] : [])),
      );
      if (activeRange && navigationRef.current) {
        const scroll = listRef.current?.getScrollableNode();
        if (scroll instanceof HTMLElement) {
          const bounds = scroll.getBoundingClientRect();
          const hit = activeRange.getBoundingClientRect();
          if (hit.height > 0) {
            scroll.scrollTop += hit.top - bounds.top - Math.max(64, bounds.height * 0.4);
            navigationRef.current = false;
          }
        }
      }
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(viewport, { childList: true, subtree: true, characterData: true });
    schedule();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      CSS.highlights.delete("thread-find");
      CSS.highlights.delete("thread-find-current");
    };
  }, [viewport, open, settledQuery, pending, active, listRef, navigationRequest]);

  const close = useCallback(() => {
    setOpen(false);
    onSelectMessage(null);
    navigationRef.current = false;
    if (returnFocusRef.current?.isConnected && returnFocusRef.current !== document.body)
      returnFocusRef.current.focus({ preventScroll: true });
    else onClose();
  }, [onClose, onSelectMessage]);

  function move(delta: number) {
    if (!matches.length || pending) return;
    navigationRef.current = true;
    setNavigationRequest((request) => request + 1);
    setIndex((current) => (current + delta + matches.length) % matches.length);
  }

  if (!open) return null;
  const loadingMatch = Boolean(active && rowIndex < 0 && !navigationError);
  const label = search.error
    ? "Search failed"
    : pending
      ? "Searching…"
      : navigationError
        ? "Match unavailable"
        : loadingMatch
          ? "Loading…"
          : normalizedQuery
            ? matches.length
              ? `${index + 1} of ${matches.length}`
              : "No results"
            : "";
  return (
    <div
      role="search"
      aria-label="Find in thread"
      className="absolute top-2 right-3 z-50 flex h-[34px] w-[310px] max-w-[calc(100%-1.5rem)] items-center gap-0.5 rounded-md border border-border bg-popover px-1 pl-2.5 text-popover-foreground shadow-md"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
        if (
          event.key === "Enter" &&
          event.target === inputRef.current &&
          !event.nativeEvent.isComposing
        ) {
          event.preventDefault();
          event.stopPropagation();
          move(event.shiftKey ? -1 : 1);
        }
      }}
    >
      <input
        ref={inputRef}
        aria-label="Find in thread"
        placeholder="Find in thread…"
        value={query}
        maxLength={200}
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent py-1 text-xs outline-none placeholder:text-muted-foreground"
        onChange={(event) => {
          setQuery(event.target.value);
          setIndex(0);
          navigationRef.current = true;
          setNavigationRequest((request) => request + 1);
        }}
      />
      <span
        role="status"
        aria-live="polite"
        className="shrink-0 px-1.5 text-[11px] text-muted-foreground tabular-nums"
      >
        {label}
      </span>
      <div className="mr-0.5 h-4 w-px shrink-0 bg-border" />
      {(
        [
          {
            label: "Previous match",
            tip: "Previous match (Shift+Enter)",
            Icon: ChevronUpIcon,
            run: () => move(-1),
            disabled: pending || !matches.length,
          },
          {
            label: "Next match",
            tip: "Next match (Enter)",
            Icon: ChevronDownIcon,
            run: () => move(1),
            disabled: pending || !matches.length,
          },
          { label: "Close find", tip: "Close (Escape)", Icon: XIcon, run: close, disabled: false },
        ] as const
      ).map(({ label: action, tip, Icon, run, disabled }) => (
        <Tooltip key={action}>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={action}
                disabled={disabled}
                onClick={run}
                className="flex size-6 shrink-0 items-center justify-center rounded hover:bg-accent disabled:opacity-35"
              />
            }
          >
            <Icon className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup>{tip}</TooltipPopup>
        </Tooltip>
      ))}
    </div>
  );
}
