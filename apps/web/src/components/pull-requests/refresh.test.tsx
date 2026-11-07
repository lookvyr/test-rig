import type { ReactElement, ReactNode } from "react";
import {
  EnvironmentId,
  ProjectId,
  type GitGetPullRequestDetailsResult,
  type GitListPullRequestsResult,
  type GitGetPullRequestStatsResult,
} from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";

const state = vi.hoisted(() => ({
  refresh: vi.fn(),
  invalidate: vi.fn(async () => ({ _tag: "Success" })),
  statsRefresh: vi.fn(),
  statsData: null as GitGetPullRequestStatsResult | null,
  statsPending: true,
  statsError: null as string | null,
  statsInputs: [] as { input: { pullRequests: unknown[] } }[],
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
  useEffectEvent: (callback: unknown) => callback,
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
  useEnvironmentQueries: (targets: { kind: string }[]) =>
    targets.map((target) =>
      target.kind === "stats"
        ? {
            data: state.statsData,
            error: state.statsError,
            isPending: state.statsPending,
            refresh: state.statsRefresh,
          }
        : { data: state.listData, error: null, isPending: false, refresh: state.refresh },
    ),
  useEnvironmentQuery: (target: { kind: string }) => ({
    data:
      target.kind === "list"
        ? state.listData
        : state.data && {
            ...state.data.pullRequest,
            body: state.data.body,
            repository: state.data.repository,
            checks: state.data.checks,
            headBranch: state.data.pullRequest.headRefName,
            baseBranch: state.data.pullRequest.baseRefName,
            author: { login: state.data.pullRequest.author },
          },
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
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => state.invalidate }));
vi.mock("./reviewStore", () => ({
  usePullRequestReviewStore: (select: (state: unknown) => unknown) =>
    select({ tabByPr: {}, setTab: vi.fn() }),
}));
vi.mock("../../state/git", () => ({
  gitEnvironment: {
    pullRequestStats: (input: { input: { pullRequests: unknown[] } }) => {
      state.statsInputs.push(input);
      return { kind: "stats" };
    },
    pullRequests: () => ({ kind: "list" }),
    pullRequestDetail: () => ({ kind: "detail" }),
  },
}));
vi.mock("../../state/entities", () => ({
  useThreadShells: () => [],
  useAllEnvironmentShellsBootstrapped: () => true,
  useProjects: () => [
    { environmentId: "env", id: "project", workspaceRoot: "/repo", title: "Repo" },
  ],
}));
vi.mock("../../state/environments", () => ({
  useEnvironments: () => ({ environments: [] }),
}));
vi.mock("../../hooks/usePullRequestHandoff", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../hooks/usePullRequestHandoff")>()),
  usePullRequestHandoff: () => ({}),
}));

import { PullRequestInspector } from "./PullRequestInspector";
import { StartPullRequestThreadButton } from "./StartPullRequestThreadButton";
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
  state.invalidate.mockClear();
  state.statsRefresh.mockClear();
  state.statsData = null;
  state.statsPending = true;
  state.statsError = null;
  state.statsInputs = [];
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
  it("keeps the visible project and expanded inspector on the selected stack layer, and refreshes its queue after an action", () => {
    usePullRequestQueueStore.setState({ panelExpanded: true });
    const inspector = elements(PullRequestWorkspace()).find(
      (element) => element.type === PullRequestInspector,
    )!;
    const next = "https://github.com/owner/repo/pull/2";
    (inspector.props.onSelectStackLayer as (url: string, number: number) => void)(next, 2);
    expect(usePullRequestQueueStore.getState()).toMatchObject({
      panelExpanded: true,
      selection: { ...selection, reference: next },
    });
    (inspector.props.onActionCompleted as () => void)();
    expect(state.refresh).toHaveBeenCalledTimes(1);
  });
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
  it("shows Closed for a closed draft in the queue", () => {
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
  });
});

function renderProject() {
  const queue = elements(PullRequestWorkspace()).find(
    (element) => element.props.project !== undefined,
  )!;
  return elements((queue.type as (props: typeof queue.props) => ReactNode)(queue.props));
}
describe("progressive pull request counts", () => {
  beforeEach(() => {
    state.listData = {
      repository: "repo",
      pullRequests: [details("head").pullRequest],
      truncated: false,
    };
  });
  it("keeps the row actionable while counts load, then reveals actual zero counts", () => {
    const loading = renderProject();
    expect(loading.some((e) => e.props["data-pr-counts"] === "loading")).toBe(true);
    expect(loading.some((e) => e.type === StartPullRequestThreadButton)).toBe(true);
    state.statsData = {
      pullRequests: [{ number: 1, headSha: "head", additions: 0, deletions: 0, changedFiles: 0 }],
    };
    state.statsPending = false;
    expect(renderProject().some((e) => e.props["data-pr-counts"] === "ready")).toBe(true);
  });
  it.each(["failure", "missing", "changed-head"])(
    "settles %s counts without misleading zeroes or endless loading",
    (status) => {
      state.statsPending = false;
      state.statsError = status === "failure" ? "Unavailable" : null;
      state.statsData =
        status === "failure"
          ? null
          : {
              pullRequests:
                status === "missing"
                  ? []
                  : [
                      {
                        number: 1,
                        headSha: "different",
                        additions: 5,
                        deletions: 1,
                        changedFiles: 2,
                      },
                    ],
            };
      const rows = renderProject();
      expect(rows.some((e) => e.props["data-pr-counts"] === "unavailable")).toBe(true);
      expect(rows.some((e) => e.props["data-pr-counts"] === "loading")).toBe(false);
    },
  );
  it("batches 26 rows as 25 plus 1 and refreshes counts with the list", () => {
    state.listData = {
      ...state.listData!,
      pullRequests: Array.from({ length: 26 }, (_, i) => ({
        ...details("head").pullRequest,
        number: i + 1,
        url: `https://github.com/owner/repo/pull/${i + 1}`,
      })),
    };
    const queue = elements(PullRequestWorkspace()).find(
      (element) => element.props.project !== undefined,
    )!;
    const renderQueue = queue.type as (props: typeof queue.props) => ReactNode;
    state.ref = null;
    renderQueue(queue.props);
    expect(state.statsInputs.map((target) => target.input.pullRequests.length)).toEqual([25, 1]);
    renderQueue({ ...queue.props, refreshVersion: 1 });
    expect(state.refresh).toHaveBeenCalledOnce();
    expect(state.statsRefresh).toHaveBeenCalledTimes(2);
  });
});
