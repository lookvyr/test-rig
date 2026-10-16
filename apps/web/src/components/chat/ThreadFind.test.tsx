import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { EMPTY_ENVIRONMENT_THREAD_STATE } from "@t3tools/client-runtime/state/threadState";
import { ThreadFind } from "./ThreadFind";

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
  orchestrationEnvironment: { threadSearchMessages: {} },
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
  vi.stubGlobal("window", { setTimeout, clearTimeout });
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
