import type { ScopedThreadRef } from "@t3tools/contracts";
import { SquarePenIcon } from "lucide-react";
import { useThreadHasUnsentDraft } from "../composerDraftStore";

export function ThreadDraftIndicator({
  threadRef,
  isActive,
}: {
  threadRef: ScopedThreadRef;
  isActive: boolean;
}) {
  const hasDraft = useThreadHasUnsentDraft(threadRef);
  if (!hasDraft || isActive) return null;

  return (
    <span
      role="img"
      aria-label="Unsent draft"
      title="Unsent draft"
      className="inline-flex shrink-0 text-amber-600 dark:text-amber-300/80"
    >
      <SquarePenIcon aria-hidden className="size-3" />
    </span>
  );
}
