import type { ReactElement, ReactNode } from "react";
import {
  EnvironmentId,
  ProjectId,
  type GitGetPullRequestDetailsResult,
  type GitListPullRequestsResult,
} from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";

const state = vi.hoisted(() => ({
  refresh: vi.fn(),
  version: 0,
  ref: null as { current: number } | null,
  data: null as GitGetPullRequestDetailsResult | null,
  listData: null as GitListPullRequestsResult | null,
  detailsPending: false,
  detailsError: null as string | null,
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
vi.mock("react/compiler-runtime", () => ({
  c: (size: number) => Array.from({ length: size }, () => Symbol.for("react.memo_cache_sentinel")),
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQueries: (targets: unknown[]) =>
    targets.map(() => ({
      data: state.listData,
      error: null,
      isPending: false,
      refresh: state.refresh,
    })),
  useEnvironmentQuery: (target: { kind: string }) => ({
    data: target.kind === "list" ? state.listData : state.data,
    error: state.detailsError,
    isPending: state.detailsPending,
    refresh: state.refresh,
  }),
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => DEFAULT_RESOLVED_KEYBINDINGS }));
vi.mock("../../shortcutModifierState", () => ({
  useShortcutModifierState: () => ({
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
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
import { StartPullRequestThreadButton } from "./StartPullRequestThreadButton";
import { PullRequestChecks, PullRequestFiles } from "./PullRequestSummary";
import { PullRequestMarkdown } from "./PullRequestMarkdown";
import { PullRequestWorkspace } from "./PullRequestWorkspace";
import { DEFAULT_QUEUE_FILTERS, usePullRequestQueueStore } from "./workspaceStore";

const selection = {
  environmentId: EnvironmentId.make("env"),
  projectId: ProjectId.make("project"),
  projectName: "Repo",
  cwd: "/repo",
  reference: "https://github.com/owner/repo/pull/1",
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
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", { platform: "MacIntel" });
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
  state.detailsPending = false;
  state.detailsError = null;
});
afterEach(() => vi.unstubAllGlobals());
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
  it("refreshes details once per revision and replaces the visible snapshot", () => {
    const first = elements(
      PullRequestInspector({ selection, onClose: () => {}, refreshVersion: 0 }),
    );
    const originalContents = first.find((element) => element.props.details !== undefined)!;
    expect(state.refresh).not.toHaveBeenCalled();
    PullRequestInspector({ selection, onClose: () => {}, refreshVersion: 1 });
    expect(state.refresh).toHaveBeenCalledTimes(1);
    state.data = { ...details("after"), body: "Updated description" };
    const updated = elements(
      PullRequestInspector({ selection, onClose: () => {}, refreshVersion: 1 }),
    ).find((element) => element.props.details !== undefined)!;
    expect(state.refresh).toHaveBeenCalledTimes(1);
    expect(updated.key).toBe(originalContents.key);
    expect(updated.props.details).toMatchObject({
      pullRequest: { headSha: "after" },
      body: "Updated description",
    });
  });
  it("keeps description, checks and the file tree without review tabs or note controls", () => {
    const contents = elements(PullRequestInspector({ selection, onClose: () => {} })).find(
      (element) => element.props.details !== undefined,
    )!;
    const renderContents = contents.type as (props: typeof contents.props) => ReactNode;
    const controls = elements(renderContents(contents.props));
    expect(controls.find((element) => element.type === PullRequestMarkdown)?.props.text).toBe(
      "Description",
    );
    expect(controls.find((element) => element.type === PullRequestChecks)?.props.checks).toEqual(
      [],
    );
    expect(controls.find((element) => element.type === PullRequestFiles)?.props.details).toBe(
      state.data,
    );
    expect(
      controls.some((element) =>
        ["tab", "tablist", "tabpanel"].includes(String(element.props.role)),
      ),
    ).toBe(false);
    expect(controls.some((element) => element.type === "textarea")).toBe(false);
    expect(controls.some((element) => element.type === StartPullRequestThreadButton)).toBe(false);
    expect(
      controls.some(
        (element) => element.type === "a" && element.props.href === selection.reference,
      ),
    ).toBe(true);
  });
  it("standalone conversation inspector refresh falls back to its detail query", () => {
    const button = elements(PullRequestInspector({ selection, onClose: () => {} })).find(
      (element) => element.props["aria-label"] === "Refresh pull request details",
    )!;
    (button.props.onClick as () => void)();
    expect(state.refresh).toHaveBeenCalledOnce();
  });
  it.each(["loading", "failed"])(
    "offers a review thread directly from the list while details are %s",
    (status) => {
      state.listData = {
        repository: "repo",
        pullRequests: [details("head").pullRequest],
        truncated: false,
      };
      state.data = null;
      state.detailsPending = status === "loading";
      state.detailsError = status === "failed" ? "GitHub is unavailable" : null;
      const queue = elements(PullRequestWorkspace()).find(
        (element) => element.props.project !== undefined,
      )!;
      const renderQueue = queue.type as (props: typeof queue.props) => ReactNode;
      const start = elements(renderQueue(queue.props)).find(
        (element) => element.type === StartPullRequestThreadButton,
      )!;
      expect(start.props).toMatchObject({
        environmentId: selection.environmentId,
        projectId: selection.projectId,
        cwd: selection.cwd,
        reference: selection.reference,
      });
      expect(start.props.disabled).toBeUndefined();
    },
  );
  it("clears a selected PR that is no longer in the queue", () => {
    usePullRequestQueueStore.getState().setPanelOpen(false);
    const root = elements(PullRequestWorkspace());
    const queue = root.find((element) => element.props.project !== undefined)!;
    const renderQueue = queue.type as (props: typeof queue.props) => ReactNode;
    renderQueue(queue.props);
    expect(usePullRequestQueueStore.getState()).toMatchObject({
      selection: null,
      panelOpen: false,
      panelExpanded: false,
    });
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
