import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vite-plus/test";
import { RuntimeRequestId } from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import type {
  ApprovalResponder,
  ThreadPendingApproval,
} from "@t3tools/client-runtime/state/thread-requests";
import { ComposerApprovalFeedback } from "./ComposerApprovalFeedback";

vi.mock("../ui/button", () => ({
  Button: (props: React.ComponentProps<"button">) => <button {...props} />,
}));
const approval: ThreadPendingApproval = {
  requestId: RuntimeRequestId.make("child-request"),
  requestKind: "command",
  createdAt: "2026-10-24T00:00:00Z",
  responseCapability: "live",
  supportsFeedback: true,
};

it("targets the displayed request and preserves feedback edited during a reply", async () => {
  let finish!: () => void;
  const reply = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const respond = vi.fn<ApprovalResponder>(async () => {
    await reply;
    return AsyncResult.success(undefined);
  });
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <ComposerApprovalFeedback approval={approval} respond={respond} disabled={false} />,
    );
  });
  act(() =>
    renderer.root
      .findByType("textarea")
      .props.onChange({ target: { value: "  Use a safer command.  " } }),
  );
  act(() => renderer.root.findByType("button").props.onClick());
  expect(respond.mock.calls).toEqual([[approval.requestId, "decline", "Use a safer command."]]);
  act(() =>
    renderer.root.findByType("textarea").props.onChange({ target: { value: "New feedback" } }),
  );
  await act(async () => {
    finish();
    await reply;
  });
  expect(renderer.root.findByType("textarea").props.value).toBe("New feedback");
  act(() => renderer.unmount());
});

it("retains rejected feedback and starts blank for a different request", async () => {
  const respond = vi.fn<ApprovalResponder>(async () => {
    throw new Error("Request expired");
  });
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <ComposerApprovalFeedback
        key={approval.requestId}
        approval={approval}
        respond={respond}
        disabled={false}
      />,
    );
  });
  act(() =>
    renderer.root.findByType("textarea").props.onChange({ target: { value: "Try another way" } }),
  );
  await act(async () => {
    renderer.root.findByType("button").props.onClick();
  });
  expect(renderer.root.findByType("textarea").props.value).toBe("Try another way");
  const next = { ...approval, requestId: RuntimeRequestId.make("other-request") };
  act(() => {
    renderer.update(
      <ComposerApprovalFeedback
        key={next.requestId}
        approval={next}
        respond={respond}
        disabled={false}
      />,
    );
  });
  expect(renderer.root.findByType("textarea").props.value).toBe("");
  expect(respond).toHaveBeenCalledTimes(1);
  act(() => renderer.unmount());
});
