import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  ThreadId,
  MessageId,
  TurnItemId,
  type OrchestrationV2ThreadSearchMessage,
} from "@t3tools/contracts";
import { EMPTY_ENVIRONMENT_THREAD_STATE } from "@t3tools/client-runtime/state/threadState";
import { requestThreadFindQuery } from "./threadFindActionBus";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";
import * as DateTime from "effect/DateTime";
import { ThreadFind } from "./ThreadFind";

vi.mock("../ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  TooltipTrigger: () => null,
  TooltipPopup: () => null,
}));

const state = vi.hoisted(() => ({
  shellExists: false,
  readThread: vi.fn(),
  runSearch: vi.fn(),
}));
vi.mock("../../state/entities", () => ({
  useThreadShell: () => (state.shellExists ? { id: "thread" } : null),
}));
vi.mock("../../state/threads", () => ({
  useEnvironmentThread: (environmentId: unknown, threadId: unknown) => {
    state.readThread(environmentId, threadId);
    return EMPTY_ENVIRONMENT_THREAD_STATE;
  },
}));
vi.mock("../../state/orchestration", () => ({
  orchestrationEnvironment: { threadSearchMessages: {}, threadSearchContext: vi.fn(() => ({})) },
}));
vi.mock("../../state/query", () => ({ useEnvironmentQuery: () => ({}) }));
vi.mock("../../state/use-atom-query-runner", () => ({
  useAtomQueryRunner: () => state.runSearch,
}));

let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
  state.shellExists = false;
  state.readThread.mockClear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const target = new EventTarget();
  vi.stubGlobal("window", {
    setTimeout,
    clearTimeout,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  });
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

it("does not request an unsaved thread when the optimistic first-message timeline mounts", () => {
  const threadRef = {
    environmentId: EnvironmentId.make("local"),
    threadId: ThreadId.make("new-claude-thread"),
  };
  const props = {
    request: 0,
    markdownCwd: undefined,
    threadRef,
    viewport: null,
    listRef: { current: null },
    rows: [],
    onSelectMessage: vi.fn(),
    onManualNavigation: vi.fn(),
    onClose: vi.fn(),
    onSearchHistory: vi.fn(),
  };
  act(() => {
    renderer = create(<ThreadFind {...props} />);
  });
  // An early 404 becomes a retained deleted state. Even a hidden find bar
  // must wait until the shell confirms that the first send created the thread.
  expect(state.readThread).toHaveBeenCalledWith(null, null);
  expect(state.readThread).not.toHaveBeenCalledWith(threadRef.environmentId, threadRef.threadId);

  state.shellExists = true;
  state.readThread.mockClear();
  act(() => renderer?.update(<ThreadFind {...props} />));
  expect(state.readThread).toHaveBeenCalledWith(threadRef.environmentId, threadRef.threadId);
});

it("opens a palette match at its specified historical message rather than the first hit", async () => {
  state.shellExists = true;
  const threadRef = {
    environmentId: EnvironmentId.make("local"),
    threadId: ThreadId.make("searched"),
  };
  const messages: OrchestrationV2ThreadSearchMessage[] = ["first", "selected"].map(
    (id, position) => ({
      id: MessageId.make(id),
      sourceThreadId: threadRef.threadId,
      sourceItemId: TurnItemId.make(id),
      position,
      role: "assistant",
      text: "A needle in the history",
      createdAt: DateTime.makeUnsafe("2026-10-24T12:00:00Z"),
    }),
  );
  state.runSearch.mockResolvedValue({ _tag: "Success", value: { messages, nextCursor: null } });
  const scrollToIndex = vi.fn();
  const onSelectMessage = vi.fn();
  const props = {
    request: 0,
    markdownCwd: undefined,
    threadRef,
    viewport: null,
    listRef: { current: { scrollToIndex } } as unknown as React.RefObject<
      import("@legendapp/list/react").LegendListRef | null
    >,
    rows: messages.map((message) => ({
      kind: "message",
      message,
    })) as unknown as MessagesTimelineRow[],
    onSelectMessage,
    onManualNavigation: vi.fn(),
    onClose: vi.fn(),
    onSearchHistory: vi.fn(),
  };
  requestThreadFindQuery(scopedThreadKey(threadRef), { query: "needle", messageId: "selected" });
  await act(async () => {
    renderer = create(<ThreadFind {...props} />);
  });
  expect(renderer!.root.findByType("input").props.value).toBe("needle");
  expect(onSelectMessage).toHaveBeenLastCalledWith("selected");
  expect(scrollToIndex).toHaveBeenLastCalledWith({ index: 1, animated: false, viewPosition: 0.4 });
});
