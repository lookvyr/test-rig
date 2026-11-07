import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { usePullRequestRefresh } from "./usePullRequestRefresh";

const state = vi.hoisted(() => ({
  notification: null as number | null,
  invalidate: vi.fn(async () => ({ _tag: "Success" })),
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: () => ({ data: state.notification }),
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => state.invalidate }));
vi.mock("../../state/pullRequests", () => ({
  pullRequestEnvironment: { invalidate: {}, refreshes: () => ({}) },
}));

let environmentId: EnvironmentId;
const reference = { projectId: ProjectId.make("project"), repository: "owner/repo", number: 1 };
const onRefresh = vi.fn();
const onBackgroundRefresh = vi.fn();
let renderer: ReactTestRenderer;
let windowTarget: EventTarget;
let documentTarget: EventTarget & { visibilityState: string };
function Harness({
  version = 0,
  revision = "A",
  pending = false,
}: {
  version?: number;
  revision?: string;
  pending?: boolean;
}) {
  const { refresh } = usePullRequestRefresh({
    environmentId,
    reference,
    refreshVersion: version,
    refreshRelated: onRefresh,
    refreshDetail: onBackgroundRefresh,
    revision,
    detailPending: pending,
  });
  return <button onClick={() => refresh()}>Refresh</button>;
}
beforeEach(({ task }) => {
  environmentId = EnvironmentId.make(task.id);
  vi.useFakeTimers();
  vi.clearAllMocks();
  state.notification = null;
  windowTarget = new EventTarget();
  documentTarget = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("window", Object.assign(windowTarget, { setInterval, clearInterval }));
  vi.stubGlobal("document", documentTarget);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("mounted PR freshness", () => {
  it("revalidates the first host notification and each later revision once", async () => {
    await act(async () => {
      renderer = create(<Harness />);
    });
    expect(onRefresh).not.toHaveBeenCalled();
    state.notification = 1;
    await act(async () => renderer.update(<Harness />));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await act(async () => renderer.update(<Harness />));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    state.notification = 2;
    await act(async () => renderer.update(<Harness />));
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });
  it("refreshes related data once when a host write and a background check overlap", async () => {
    await act(async () => {
      renderer = create(<Harness />);
    });
    await vi.advanceTimersByTimeAsync(15_000);
    windowTarget.dispatchEvent(new Event("focus"));
    await act(async () => renderer.update(<Harness pending />));
    state.notification = 3;
    await act(async () => renderer.update(<Harness pending />));
    await act(async () => renderer.update(<Harness revision="B" />));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15_000);
    windowTarget.dispatchEvent(new Event("focus"));
    await act(async () => renderer.update(<Harness revision="C" />));
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });
  it("invalidates on explicit refresh and a changed workspace revision", async () => {
    await act(async () => {
      renderer = create(<Harness />);
    });
    await act(async () => {
      await renderer.root.findByType("button").props.onClick();
    });
    expect(state.invalidate).toHaveBeenCalledWith({ environmentId, input: { reference } });
    await act(async () => renderer.update(<Harness version={1} />));
    expect(state.invalidate).toHaveBeenCalledTimes(2);
    await act(async () => renderer.update(<Harness version={1} />));
    expect(state.invalidate).toHaveBeenCalledTimes(2);
  });
  it("refreshes only detail on return and avoids repeated, hidden, and idle reads", async () => {
    await act(async () => {
      renderer = create(<Harness />);
    });
    await vi.advanceTimersByTimeAsync(15_000);
    windowTarget.dispatchEvent(new Event("focus"));
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    expect(onBackgroundRefresh).toHaveBeenCalledTimes(1);
    documentTarget.visibilityState = "hidden";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(6 * 60_000);
    expect(onBackgroundRefresh).toHaveBeenCalledTimes(1);
    documentTarget.visibilityState = "visible";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    expect(onBackgroundRefresh).toHaveBeenCalledTimes(1);
    documentTarget.dispatchEvent(new Event("pointerdown"));
    expect(onBackgroundRefresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(onBackgroundRefresh).toHaveBeenCalledTimes(3);
    expect(state.invalidate).not.toHaveBeenCalled();
    await act(async () => renderer.unmount());
    windowTarget.dispatchEvent(new Event("focus"));
    expect(onBackgroundRefresh).toHaveBeenCalledTimes(3);
  });
});
