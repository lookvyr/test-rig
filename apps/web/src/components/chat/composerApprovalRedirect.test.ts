import { RuntimeRequestId } from "@t3tools/contracts";
import type { ApprovalResponder } from "@t3tools/client-runtime/state/thread-requests";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";
import type { PendingApproval } from "../../session-logic";
import {
  answerShownApprovalsWithMessage,
  approvalRedirectNotice,
  draftAttachmentLists,
  draftAttachmentListsChanged,
} from "./composerApprovalRedirect";

const command: PendingApproval = {
  requestId: RuntimeRequestId.make("command"),
  requestKind: "command",
  createdAt: "2026-11-01T00:00:00Z",
  detail: "rm -rf build",
  responseCapability: "live",
};
const second: PendingApproval = { ...command, requestId: RuntimeRequestId.make("second") };
const withFeedback: PendingApproval = { ...command, supportsFeedback: true };

const succeed = () => vi.fn<ApprovalResponder>(async () => AsyncResult.success(undefined));
const answer = (
  shownApprovals: ReadonlyArray<PendingApproval>,
  respond: ApprovalResponder,
  overrides: Partial<Parameters<typeof answerShownApprovalsWithMessage>[0]> = {},
) =>
  answerShownApprovalsWithMessage({
    shownApprovals,
    text: "Use the safer flag",
    hasAttachmentsOrContext: false,
    respondingRequestIds: [],
    respond,
    draftChanged: () => false,
    readShownApprovalIds: () => shownApprovals.map((approval) => approval.requestId),
    ...overrides,
  });

describe("answerShownApprovalsWithMessage", () => {
  it("sends normally when no approval is shown", async () => {
    const respond = succeed();
    expect(await answer([], respond)).toEqual({ type: "send" });
    expect(respond).not.toHaveBeenCalled();
  });

  it("declines every shown approval, then lets the message redirect the agent", async () => {
    const respond = succeed();
    expect(await answer([command, second], respond)).toEqual({ type: "send" });
    expect(respond.mock.calls).toEqual([
      [command.requestId, "decline"],
      [second.requestId, "decline"],
    ]);
  });

  it("sends the message as feedback to an approval that takes it, without a new turn", async () => {
    const respond = succeed();
    expect(await answer([withFeedback, second], respond)).toEqual({ type: "feedback-sent" });
    expect(respond.mock.calls).toEqual([[command.requestId, "decline", "Use the safer flag"]]);
  });

  it("refuses feedback with attachments or added context", async () => {
    const respond = succeed();
    expect(await answer([withFeedback], respond, { hasAttachmentsOrContext: true })).toMatchObject({
      type: "stopped",
      error: "Send approval feedback without attachments or added context.",
    });
    expect(respond).not.toHaveBeenCalled();
  });

  it("does not send when a decline fails", async () => {
    const respond = vi.fn<ApprovalResponder>(async () =>
      AsyncResult.failure(Cause.fail("decline failed")),
    );
    expect(await answer([command], respond)).toEqual({ type: "stopped", notice: null });
  });

  it("does not answer an approval already being answered", async () => {
    const respond = succeed();
    expect(await answer([command], respond, { respondingRequestIds: [command.requestId] })).toEqual(
      {
        type: "stopped",
        notice: "An approval is already being answered, so your message wasn't sent.",
      },
    );
    expect(respond).not.toHaveBeenCalled();
  });

  it("keeps the draft when it changed or another approval arrived during the decline", async () => {
    expect(await answer([command], succeed(), { draftChanged: () => true })).toEqual({
      type: "stopped",
      notice: "Approval declined. Your message changed, so it wasn't sent.",
    });
    expect(
      await answer([command], succeed(), {
        readShownApprovalIds: () => [command.requestId, second.requestId],
      }),
    ).toEqual({
      type: "stopped",
      notice: "Another approval arrived, so your message wasn't sent.",
    });
  });
});

describe("approvalRedirectNotice", () => {
  const settled = {
    draftChanged: false,
    declined: true,
    approvalResponding: false,
    approvalArrived: false,
  };

  it("says whether the decline went through when the draft changed", () => {
    expect(approvalRedirectNotice({ ...settled, draftChanged: true, declined: false })).toBe(
      "Your message changed, so it wasn't sent.",
    );
  });

  it("stays quiet when the decline failed", () => {
    expect(approvalRedirectNotice({ ...settled, declined: false })).toBeNull();
    expect(approvalRedirectNotice(settled)).toBeNull();
  });
});

describe("draftAttachmentListsChanged", () => {
  const draft = {
    images: [],
    terminalContexts: [],
    elementContexts: [],
    previewAnnotations: [],
    reviewComments: [],
    threadContexts: [],
  };

  it("stays unchanged while the same lists are in place", () => {
    const before = draftAttachmentLists(draft);
    expect(draftAttachmentListsChanged(before, draftAttachmentLists({ ...draft }))).toBe(false);
  });

  it("notices an attachment added while an answer was in flight", () => {
    const before = draftAttachmentLists(draft);
    const after = draftAttachmentLists({ ...draft, reviewComments: [] });
    expect(draftAttachmentListsChanged(before, after)).toBe(true);
  });

  it("notices a draft that disappeared", () => {
    expect(
      draftAttachmentListsChanged(draftAttachmentLists(draft), draftAttachmentLists(null)),
    ).toBe(true);
  });
});
