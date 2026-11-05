import { RegistryContext } from "@effect/atom-react";
import type { ChildThreadApproval } from "@t3tools/client-runtime/state/thread-requests";
import { EnvironmentId, RuntimeRequestId, ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  respond: vi.fn(),
  canRespond: true,
  approvalsAtom: null as unknown,
}));
vi.mock("../../state/session", () => ({ useEnvironmentScope: () => state.canRespond }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => state.respond }));
vi.mock("../../state/threads", () => ({
  childThreadApprovalsAtom: () => state.approvalsAtom,
  threadEnvironment: { respondToApproval: {} },
}));
vi.mock("./ComposerPendingApprovalActions", () => ({
  ComposerPendingApprovalActions: (props: {
    canRespond: boolean;
    isResponding: boolean;
    requestId: RuntimeRequestId;
    onRespondToApproval: (id: RuntimeRequestId, decision: "accept") => Promise<unknown>;
  }) => (
    <button
      disabled={!props.canRespond || props.isResponding}
      onClick={() => props.onRespondToApproval(props.requestId, "accept")}
    >
      Approve
    </button>
  ),
}));
import { ChildThreadApprovals } from "./ChildThreadApprovals";

it("routes child decisions to their environment and permits retry after failure", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const child = {
    environmentId: EnvironmentId.make("child-env"),
    threadId: ThreadId.make("child"),
  };
  const parent = {
    environmentId: EnvironmentId.make("parent-env"),
    threadId: ThreadId.make("parent"),
  };
  const requestId = RuntimeRequestId.make("approval");
  state.approvalsAtom = Atom.make<ReadonlyArray<ChildThreadApproval>>([
    {
      thread: child,
      title: "Compile task",
      approval: {
        requestId,
        requestKind: "command",
        detail: "Run compiler",
        createdAt: "2026-11-05T00:00:00Z",
        responseCapability: "live",
      },
    },
  ]);
  state.canRespond = true;
  state.respond.mockReset();
  state.respond
    .mockResolvedValueOnce(AsyncResult.failure(Cause.fail(new Error("Offline"))))
    .mockResolvedValueOnce(AsyncResult.success(undefined));
  const registry = AtomRegistry.make();
  let renderer: ReactTestRenderer | undefined;
  try {
    await act(async () => {
      renderer = create(
        <RegistryContext.Provider value={registry}>
          <ChildThreadApprovals threadRef={parent} />
        </RegistryContext.Provider>,
      );
    });
    await act(async () => {
      await renderer!.root.findByType("button").props.onClick();
    });
    expect(state.respond).toHaveBeenCalledWith({
      environmentId: child.environmentId,
      input: { threadId: child.threadId, requestId, decision: "accept" },
    });
    expect(renderer!.root.findByProps({ role: "alert" }).children).toEqual(["Offline"]);
    await act(async () => {
      await renderer!.root.findByType("button").props.onClick();
    });
    expect(renderer!.root.findAllByProps({ role: "alert" })).toEqual([]);
    state.canRespond = false;
    await act(async () => {
      renderer!.update(
        <RegistryContext.Provider value={registry}>
          <ChildThreadApprovals threadRef={parent} />
        </RegistryContext.Provider>,
      );
    });
    expect(renderer!.root.findByType("button").props.disabled).toBe(true);
  } finally {
    await act(async () => renderer?.unmount());
    registry.dispose();
    vi.unstubAllGlobals();
  }
});
