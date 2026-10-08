import { act, useEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import * as Option from "effect/Option";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useEnvironmentQuery } from "./query";

const state = vi.hoisted(() => ({ result: null as unknown, refresh: vi.fn() }));
vi.mock("@effect/atom-react", async (original) => ({
  ...(await original<typeof import("@effect/atom-react")>()),
  useAtomValue: () => state.result,
  useAtomRefresh: () => state.refresh,
}));
const atom = Atom.make(AsyncResult.initial<string, Error>());
let renderer: ReactTestRenderer | null = null;
let view: ReturnType<typeof useEnvironmentQuery<string, Error>>;
function Probe() {
  const result = useEnvironmentQuery(atom);
  useEffect(() => {
    view = result;
  }, [result]);
  return null;
}
function render(result: AsyncResult.AsyncResult<string, Error>) {
  state.result = result;
  act(() => {
    if (renderer) renderer.update(<Probe />);
    else renderer = create(<Probe />);
  });
}
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
  state.refresh.mockReset();
});

describe("canceled environment query recovery", () => {
  it("refreshes a canceled scope and returns its recovered data", () => {
    render(AsyncResult.failure(Cause.interrupt()));
    expect(state.refresh).toHaveBeenCalledTimes(1);
    render(AsyncResult.success("uncommitted changes"));
    expect(view.data).toBe("uncommitted changes");
    expect(view.error).toBeNull();
    expect(view.isPending).toBe(false);
  });
  it("bounds retries and keeps repeated cancellation actionable", () => {
    render(AsyncResult.failure(Cause.interrupt()));
    render(AsyncResult.failure(Cause.interrupt()));
    expect(state.refresh).toHaveBeenCalledTimes(1);
    expect(view.error).toBe("The request was canceled. Refresh to try again.");
    view.refresh();
    expect(state.refresh).toHaveBeenCalledTimes(2);
  });
  it("retains cached data during recovery and still reports actual failures", () => {
    const previous = AsyncResult.success("cached changes");
    render(
      AsyncResult.waiting(
        AsyncResult.failureWithPrevious(Cause.interrupt(), { previous: Option.some(previous) }),
      ),
    );
    expect(view.data).toBe("cached changes");
    expect(view.error).toBeNull();
    expect(view.isPending).toBe(true);
    expect(state.refresh).not.toHaveBeenCalled();
    render(AsyncResult.failure(Cause.fail(new Error("Git permission denied"))));
    expect(view.error).toBe("Git permission denied");
    expect(state.refresh).not.toHaveBeenCalled();
  });
});
