import { useRef, useState } from "react";
import {
  sendApprovalFeedback,
  type ApprovalResponder,
  type ThreadPendingApproval,
} from "@t3tools/client-runtime/state/thread-requests";
import { Button } from "../ui/button";

/** Mounted per request so feedback never consumes or redirects the conversation draft. */
export function ComposerApprovalFeedback({
  approval,
  respond,
  disabled,
}: {
  approval: ThreadPendingApproval;
  respond: ApprovalResponder;
  disabled: boolean;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);
  const send = async () => {
    if (disabled || inFlight.current || !text.trim()) return;
    const submitted = text;
    inFlight.current = true;
    setSending(true);
    try {
      if (await sendApprovalFeedback(approval, submitted, respond).catch(() => false)) {
        setText((current) => (current === submitted ? "" : current));
      }
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };
  return (
    <div className="flex w-full items-end gap-2">
      <textarea
        aria-label="Approval feedback"
        placeholder="Send feedback to decline this request"
        value={text}
        onChange={(event) => setText(event.target.value)}
        disabled={disabled}
        className="min-h-16 flex-1 resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-none"
      />
      <Button
        type="button"
        size="sm"
        disabled={disabled || sending || !text.trim()}
        onClick={() => void send()}
      >
        Send feedback
      </Button>
    </div>
  );
}
