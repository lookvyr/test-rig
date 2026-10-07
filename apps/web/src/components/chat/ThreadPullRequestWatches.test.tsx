import { EnvironmentId, ThreadId, type ThreadPullRequestLink } from "@t3tools/contracts";
import { PauseIcon } from "lucide-react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { visitElements } from "../../test/reactElementTree";
import { reactHookHarness as hooks } from "../../test/reactHookHarness";
import { ThreadPullRequestWatches } from "./ThreadPullRequestWatches";

const mocks = vi.hoisted(() => ({
  links: [] as ThreadPullRequestLink[],
  settledOverride: null as "settled" | "active" | null,
  settledAt: null as string | null,
  stop: vi.fn(),
  open: vi.fn(),
}));
vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return { ...actual, useState: reactHookHarness.useState, useRef: reactHookHarness.useRef };
});
vi.mock("react/compiler-runtime", async () => {
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return { c: reactHookHarness.useMemoCache };
});
vi.mock("../../state/entities", () => ({
  useThreadShell: () => ({
    pullRequests: mocks.links,
    settledOverride: mocks.settledOverride,
    settledAt: mocks.settledAt,
  }),
}));
vi.mock("../../state/threads", () => ({ threadEnvironment: { watchPullRequest: "watch" } }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => mocks.stop }));
vi.mock("../../lib/openPullRequestLink", () => ({ useOpenPrLink: () => mocks.open }));

const threadRef = {
  environmentId: EnvironmentId.make("environment"),
  threadId: ThreadId.make("thread"),
};
const link: ThreadPullRequestLink = {
  host: "github.com",
  repository: "owner/repo",
  number: 7,
  url: "https://github.com/owner/repo/pull/7",
  source: "manual",
  linkedAt: "2026-10-06T12:00:00Z",
  snapshot: null,
  stack: null,
  watch: {
    startedAt: "2026-10-06T12:00:00Z",
    headSha: null,
    failedChecks: [],
    passed: false,
    remarksThrough: "2026-10-06T12:00:00Z",
    remarkIds: [],
    conflicting: false,
    wakes: 0,
  },
};
function render() {
  hooks.beginRender();
  return ThreadPullRequestWatches({ threadRef });
}
describe("thread PR watch controls", () => {
  beforeEach(() => {
    hooks.reset();
    mocks.links = [link];
    mocks.settledOverride = null;
    mocks.settledAt = null;
    mocks.stop.mockReset().mockResolvedValue({ _tag: "Success" });
  });
  it("stops only the selected PR's watch without unlinking it", async () => {
    const control = visitElements(
      render(),
      (element) => element.props["aria-label"] === "Stop watching #7",
    );
    if (!control) throw new Error("Missing watch control");
    await (control.props.onClick as () => Promise<void>)();
    expect(mocks.stop).toHaveBeenCalledExactlyOnceWith({
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        host: link.host,
        repository: link.repository,
        number: link.number,
        watching: false,
      },
    });
    expect(mocks.links).toEqual([link]);
  });
  it("removes the eye once the server records a stopped watch", () => {
    const { watch: _watch, ...unwatched } = link;
    mocks.links = [unwatched];
    expect(render()).toEqual([]);
  });
  it.each(["override", "timestamp"] as const)(
    "shows a paused watch for settlement by %s while keeping Stop available",
    (settlement) => {
      if (settlement === "override") mocks.settledOverride = "settled";
      else mocks.settledAt = "2026-10-06T12:30:00Z";
      const tree = render();
      expect(visitElements(tree, (element) => element.type === PauseIcon)).not.toBeNull();
      expect(
        visitElements(
          tree,
          (element) =>
            element.props.children ===
            "Watching paused while this thread is settled. Un-settle the thread to resume watching.",
        ),
      ).not.toBeNull();
      expect(
        visitElements(tree, (element) => element.props["aria-label"] === "Stop watching #7")?.props
          .disabled,
      ).toBe(false);
    },
  );
});
