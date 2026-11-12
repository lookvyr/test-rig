import {
  declinePendingApprovals,
  sendApprovalFeedback,
  type ApprovalResponder,
} from "@t3tools/client-runtime/state/thread-requests";
import type { RuntimeRequestId } from "@t3tools/contracts";
import type { ComposerThreadDraftState } from "../../composerDraftStore";
import type { PendingApproval } from "../../session-logic";

/** Why a message sent over pending approvals did not go out, or null to stop quietly. */
export function approvalRedirectNotice(input: {
  readonly draftChanged: boolean;
  readonly declined: boolean;
  readonly approvalResponding: boolean;
  readonly approvalArrived: boolean;
}): string | null {
  if (input.draftChanged) {
    return input.declined
      ? "Approval declined. Your message changed, so it wasn't sent."
      : "Your message changed, so it wasn't sent.";
  }
  if (input.approvalResponding) {
    return "An approval is already being answered, so your message wasn't sent.";
  }
  if (input.declined && input.approvalArrived) {
    return "Another approval arrived, so your message wasn't sent.";
  }
  return null;
}

export type ApprovalRedirectOutcome =
  /** Nothing was shown, or every shown approval was declined: send the message as a steer. */
  | { readonly type: "send" }
  /** The message was the shown approval's feedback and declined it; no turn starts. */
  | { readonly type: "feedback-sent" }
  /** The message must not go out. Keep the draft and show the notice or error, if any. */
  | { readonly type: "stopped"; readonly notice: string | null; readonly error?: string };

/**
 * A message sent while approvals are shown in the timeline answers them. When the first shown
 * approval takes feedback, the message is that feedback. Otherwise every shown approval is
 * declined so the message can redirect the agent. Call it only after the send passed every
 * local check, because declining cannot be undone.
 */
export async function answerShownApprovalsWithMessage(input: {
  readonly shownApprovals: ReadonlyArray<PendingApproval>;
  readonly text: string;
  readonly hasAttachmentsOrContext: boolean;
  readonly respondingRequestIds: ReadonlyArray<RuntimeRequestId>;
  readonly respond: ApprovalResponder;
  /** Read after responding: whether the draft no longer holds the message that was sent. */
  readonly draftChanged: () => boolean;
  /** Read after responding: the approvals shown now. */
  readonly readShownApprovalIds: () => ReadonlyArray<RuntimeRequestId>;
}): Promise<ApprovalRedirectOutcome> {
  const [first] = input.shownApprovals;
  if (first === undefined) return { type: "send" };
  const approvalResponding = input.shownApprovals.some((approval) =>
    input.respondingRequestIds.includes(approval.requestId),
  );
  if (first.supportsFeedback === true && first.responseCapability === "live") {
    if (input.hasAttachmentsOrContext) {
      return {
        type: "stopped",
        notice: null,
        error: "Send approval feedback without attachments or added context.",
      };
    }
    if (approvalResponding) {
      return {
        type: "stopped",
        notice: approvalRedirectNotice({
          draftChanged: false,
          declined: false,
          approvalResponding,
          approvalArrived: false,
        }),
      };
    }
    const sent = await sendApprovalFeedback(first, input.text, input.respond).catch(() => false);
    return sent ? { type: "feedback-sent" } : { type: "stopped", notice: null };
  }
  const shownIds = new Set<string>(input.shownApprovals.map((approval) => approval.requestId));
  const declined =
    !approvalResponding &&
    (await declinePendingApprovals(input.shownApprovals, input.respond).catch(() => false));
  const draftChanged = input.draftChanged();
  // An approval that arrived during the decline would block the redirect; keep the draft so
  // the next send declines it too.
  const approvalArrived = input.readShownApprovalIds().some((id) => !shownIds.has(id));
  if (!declined || draftChanged || approvalArrived) {
    return {
      type: "stopped",
      notice: approvalRedirectNotice({
        draftChanged,
        declined,
        approvalResponding,
        approvalArrived,
      }),
    };
  }
  return { type: "send" };
}

type DraftAttachmentFields = Pick<
  ComposerThreadDraftState,
  | "images"
  | "terminalContexts"
  | "elementContexts"
  | "previewAnnotations"
  | "reviewComments"
  | "threadContexts"
>;

/**
 * The draft's attachment lists, captured before an approval answer is awaited. The draft store
 * replaces a list whenever it changes, so comparing these by identity afterwards tells whether
 * anything was attached while the answer was in flight.
 */
export function draftAttachmentLists(draft: DraftAttachmentFields | null): readonly unknown[] {
  if (!draft) return [];
  return [
    draft.images,
    draft.terminalContexts,
    draft.elementContexts,
    draft.previewAnnotations,
    draft.reviewComments,
    draft.threadContexts,
  ];
}

export function draftAttachmentListsChanged(
  before: readonly unknown[],
  after: readonly unknown[],
): boolean {
  return before.length !== after.length || before.some((list, index) => list !== after[index]);
}
