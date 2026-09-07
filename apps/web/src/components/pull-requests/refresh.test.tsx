import type { ReactElement, ReactNode } from "react";
import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  type GitGetPullRequestDetailsResult,
  type GitListPullRequestsResult,
} from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  refresh: vi.fn(),
  version: 0,
  ref: null as { current: number } | null,
  data: null as GitGetPullRequestDetailsResult | null,
  listData: null as GitListPullRequestsResult | null,
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useMemo: (create: () => unknown) => create(),
  useCallback: (callback: unknown) => callback,
  useDebugValue: () => {},
  useRef: (initial: number) => (state.ref ??= { current: initial }),
  useEffect: (effect: () => void) => effect(),
  useState: () => [
    state.version,
    (next: (value: number) => number) => {
      state.version = next(state.version);
    },
  ],
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}));
vi.mock("./workspaceStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./workspaceStore")>();
  return {
    ...actual,
    usePullRequestQueueStore: Object.assign(
      () => actual.usePullRequestQueueStore.getState(),
      actual.usePullRequestQueueStore,
    ),
  };
});
vi.mock("../../pullRequestWorkspaceStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../pullRequestWorkspaceStore")>();
  return {
    ...actual,
    usePullRequestWorkspaceStore: Object.assign(
      (
        selector?: (
          value: ReturnType<typeof actual.usePullRequestWorkspaceStore.getState>,
        ) => unknown,
      ) =>
        selector
          ? selector(actual.usePullRequestWorkspaceStore.getState())
          : actual.usePullRequestWorkspaceStore.getState(),
      actual.usePullRequestWorkspaceStore,
    ),
  };
});
vi.mock("react/compiler-runtime", () => ({
  c: (size: number) => Array.from({ length: size }, () => Symbol.for("react.memo_cache_sentinel")),
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (target: { kind: string }) => ({
    data: target.kind === "list" ? state.listData : state.data,
    error: null,
    isPending: false,
    refresh: state.refresh,
  }),
}));
vi.mock("../../state/git", () => ({
  gitEnvironment: {
    pullRequests: () => ({ kind: "list" }),
    pullRequestDetails: () => ({ kind: "detail" }),
  },
}));
vi.mock("../../state/entities", () => ({
  useThreadShells: () => [],
  useAllEnvironmentShellsBootstrapped: () => true,
  useProjects: () => [
    { environmentId: "env", id: "project", workspaceRoot: "/repo", title: "Repo" },
  ],
}));
vi.mock("../../hooks/usePullRequestHandoff", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../hooks/usePullRequestHandoff")>()),
  usePullRequestHandoff: () => ({}),
}));

import { PullRequestInspector } from "./PullRequestInspector";
import { PullRequestConversationActions } from "./PullRequestConversationActions";
import { PullRequestWorkspace } from "./PullRequestWorkspace";
import { DEFAULT_QUEUE_FILTERS, usePullRequestQueueStore } from "./workspaceStore";
import {
  pullRequestWorkspaceKey,
  usePullRequestWorkspaceStore,
} from "../../pullRequestWorkspaceStore";

const selection = {
  environmentId: EnvironmentId.make("env"),
  projectId: ProjectId.make("project"),
  projectName: "Repo",
  cwd: "/repo",
  reference: "https://github.com/owner/repo/pull/1",
};
const scope = {
  environmentId: selection.environmentId,
  cwd: selection.cwd,
  reference: selection.reference,
};
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...elements(element.props.children as ReactNode)];
}
function details(headSha: string): GitGetPullRequestDetailsResult {
  return {
    repository: "https://github.com/owner/repo",
    pullRequest: {
      number: 1,
      title: "Change",
      url: selection.reference,
      state: "open",
      isDraft: true,
      author: "me",
      baseRefName: "main",
      headRefName: "feature",
      headSha,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
      additions: 1,
      deletions: 0,
      changedFiles: 1,
      labels: [],
    },
    body: "Description",
    checks: [],
    timeline: [],
    files: [],
    truncated: false,
  };
}
beforeEach(() => {
  state.refresh.mockClear();
  state.version = 0;
  state.ref = null;
  state.data = details("before");
  state.listData = { repository: "repo", pullRequests: [], truncated: false };
  usePullRequestQueueStore.setState({
    filters: DEFAULT_QUEUE_FILTERS,
    selection,
    panelOpen: true,
    panelExpanded: false,
  });
  usePullRequestWorkspaceStore.setState({ entriesByKey: {} });
});
describe("pull request refresh lifecycle", () => {
  it("global and inspector refresh use the same revision for visible list and details", () => {
    const first = elements(PullRequestWorkspace());
    const refresh = first.find(
      (element) => element.props["aria-label"] === "Refresh pull requests",
    )!;
    (refresh.props.onClick as () => void)();
    const second = elements(PullRequestWorkspace());
    const inspector = second.find((element) => element.type === PullRequestInspector)!;
    const projectQueue = second.find((element) => element.props.project !== undefined)!;
    expect(inspector.props.refreshVersion).toBe(1);
    expect(projectQueue.props.refreshVersion).toBe(1);
    (inspector.props.onRefresh as () => void)();
    const third = elements(PullRequestWorkspace());
    expect(
      third.find((element) => element.type === PullRequestInspector)?.props.refreshVersion,
    ).toBe(2);
    expect(third.find((element) => element.props.project !== undefined)?.props.refreshVersion).toBe(
      2,
    );
  });
  it("refreshes details once per revision while preserving content identity and unsaved note/tab state", () => {
    const store = usePullRequestWorkspaceStore.getState();
    store.setTab(scope, "code");
    store.setNoteDraft(scope, {
      body: "Keep editing",
      headSha: "before",
      filePath: "a.ts",
      line: 2,
      side: "new",
    });
    const first = elements(
      PullRequestInspector({ selection, onClose: () => {}, refreshVersion: 0 }),
    );
    const originalContents = first.find((element) => element.props.details !== undefined)!;
    expect(state.refresh).not.toHaveBeenCalled();
    PullRequestInspector({ selection, onClose: () => {}, refreshVersion: 1 });
    expect(state.refresh).toHaveBeenCalledTimes(1);
    state.data = {
      ...details("after"),
      timeline: [
        {
          id: "comment:2",
          kind: "comment",
          author: "reviewer",
          body: "New comment",
          createdAt: "2026-01-02",
          url: selection.reference,
          state: null,
          path: null,
          line: null,
          side: null,
        },
      ],
    };
    const updated = elements(
      PullRequestInspector({ selection, onClose: () => {}, refreshVersion: 1 }),
    ).find((element) => element.props.details !== undefined)!;
    expect(state.refresh).toHaveBeenCalledTimes(1);
    expect(updated.key).toBe(originalContents.key);
    expect(updated.props.details).toMatchObject({
      pullRequest: { headSha: "after" },
      timeline: [{ body: "New comment" }],
    });
    expect(
      usePullRequestWorkspaceStore.getState().entriesByKey[pullRequestWorkspaceKey(scope)],
    ).toMatchObject({ tab: "code", noteDraft: { body: "Keep editing", headSha: "before" } });
  });
  it("standalone conversation inspector refresh falls back to its detail query", () => {
    const button = elements(PullRequestInspector({ selection, onClose: () => {} })).find(
      (element) => element.props["aria-label"] === "Refresh pull request details",
    )!;
    (button.props.onClick as () => void)();
    expect(state.refresh).toHaveBeenCalledOnce();
  });
  it("linked inspection only adds selected feedback to its host composer without changing the PR link", () => {
    const store = usePullRequestWorkspaceStore.getState();
    store.addNote(scope, {
      body: "Check the changed line",
      headSha: "before",
      filePath: "a.ts",
      line: 2,
      side: "new",
    });
    store.addNote(scope, { body: "Leave this out", headSha: "before", selected: false });
    store.setInstructions(scope, "Initial review instructions");
    store.link(scope, {
      environmentId: selection.environmentId,
      projectId: selection.projectId,
      threadId: ThreadId.make("linked-thread"),
    });
    const before =
      usePullRequestWorkspaceStore.getState().entriesByKey[pullRequestWorkspaceKey(scope)];
    const addToMessage = vi.fn();
    const inspector = elements(
      PullRequestInspector({ selection, onClose: () => {}, onAddToMessage: addToMessage }),
    );
    const contents = inspector.find((element) => element.props.details !== undefined)!;
    const renderContents = contents.type as (props: typeof contents.props) => ReactNode;
    const controls = elements(renderContents(contents.props));
    expect(controls.some((element) => element.type === PullRequestConversationActions)).toBe(false);
    expect(controls.some((element) => element.props.id === "pr-destination")).toBe(false);
    const add = controls.find((element) => element.props.children === "Add to message")!;
    expect(add.props.disabled).toBe(false);
    (add.props.onClick as () => void)();
    expect(addToMessage).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("a.ts:2 (new): Check the changed line"),
    );
    const context = addToMessage.mock.calls[0]?.[0];
    expect(context).not.toContain("Leave this out");
    expect(context).not.toContain("Description");
    expect(context).not.toContain("Initial review instructions");
    expect(
      usePullRequestWorkspaceStore.getState().entriesByKey[pullRequestWorkspaceKey(scope)],
    ).toBe(before);
  });
  it("keeps preparation in the global inspector and disables empty linked feedback", () => {
    for (const onAddToMessage of [undefined, vi.fn()]) {
      const contents = elements(
        PullRequestInspector({ selection, onClose: () => {}, onAddToMessage }),
      ).find((element) => element.props.details !== undefined)!;
      const renderContents = contents.type as (props: typeof contents.props) => ReactNode;
      const controls = elements(renderContents(contents.props));
      expect(controls.some((element) => element.type === PullRequestConversationActions)).toBe(
        !onAddToMessage,
      );
      if (onAddToMessage)
        expect(
          controls.find((element) => element.props.children === "Add to message")?.props.disabled,
        ).toBe(true);
    }
  });
  it("clears a closed PR excluded by the Open queue without deleting local notes", () => {
    usePullRequestWorkspaceStore
      .getState()
      .setNoteDraft(scope, { body: "Preserve unsaved note", headSha: "before" });
    usePullRequestQueueStore.getState().setPanelOpen(false);
    const root = elements(PullRequestWorkspace());
    const queue = root.find((element) => element.props.project !== undefined)!;
    const renderQueue = queue.type as (props: {
      project: { environmentId: string; id: string; title: string; workspaceRoot: string };
      refreshVersion: number;
    }) => ReactNode;
    renderQueue(queue.props as Parameters<typeof renderQueue>[0]);
    expect(usePullRequestQueueStore.getState()).toMatchObject({
      selection: null,
      panelOpen: false,
      panelExpanded: false,
    });
    expect(
      usePullRequestWorkspaceStore.getState().entriesByKey[pullRequestWorkspaceKey(scope)]
        ?.noteDraft?.body,
    ).toBe("Preserve unsaved note");
    expect(
      elements(PullRequestWorkspace()).some(
        (element) => element.props.children === "Reopen review",
      ),
    ).toBe(false);
  });
  it("shows Closed for a closed draft in both queue and inspector", () => {
    const closed = {
      ...details("after"),
      pullRequest: { ...details("after").pullRequest, state: "closed" as const },
    };
    state.data = closed;
    state.listData = { repository: "repo", pullRequests: [closed.pullRequest], truncated: false };
    const queue = elements(PullRequestWorkspace()).find(
      (element) => element.props.project !== undefined,
    )!;
    const renderQueue = queue.type as (props: typeof queue.props) => ReactNode;
    expect(
      elements(renderQueue(queue.props)).some((element) => element.props.children === "closed"),
    ).toBe(true);
    const contents = elements(PullRequestInspector({ selection, onClose: () => {} })).find(
      (element) => element.props.details !== undefined,
    )!;
    const renderContents = contents.type as (props: typeof contents.props) => ReactNode;
    expect(
      elements(renderContents(contents.props)).some(
        (element) => element.props.children === "closed",
      ),
    ).toBe(true);
  });
});
