import type { ApprovalRequestId, ScopedThreadRef } from "@t3tools/contracts";
import { useState } from "react";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import type { PendingUserInput } from "../../session-logic";
import { Button } from "../ui/button";
import { ComposerPendingUserInputPanel } from "./ComposerPendingUserInputPanel";
import { usePendingUserInput } from "./usePendingUserInput";

export function AsyncUserInputPanel({
  threadRef,
  requests,
  respondingRequestIds,
  onRespond,
}: {
  threadRef: ScopedThreadRef;
  requests: PendingUserInput[];
  respondingRequestIds: ApprovalRequestId[];
  onRespond: (requestId: ApprovalRequestId, answers: Record<string, unknown>) => unknown;
}) {
  const request = requests[0] ?? null;
  const [expanded, setExpanded] = useState(true);
  const draft = usePendingUserInput({ threadRef, request, onRespond });
  const progress = draft.activePendingProgress;
  if (!request || !progress?.activeQuestion) return null;
  const responding = respondingRequestIds.includes(request.requestId);
  const question = progress.activeQuestion;
  return (
    <section
      aria-label="Questions from Codex"
      className="mx-auto mb-2 w-full max-w-3xl overflow-hidden rounded-2xl border border-border bg-background shadow-sm"
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-2 text-sm text-secondary-label"
      >
        <span>
          {requests.length > 1 ? `${requests.length} question sets` : "Question from Codex"}
          <span className="ml-2 text-xs">Reply when ready</span>
        </span>
        {expanded ? <ChevronUpIcon className="size-4" /> : <ChevronDownIcon className="size-4" />}
      </button>
      {expanded && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (progress.canAdvance && !responding) draft.onAdvanceActivePendingUserInput();
          }}
        >
          <ComposerPendingUserInputPanel
            pendingUserInputs={requests}
            respondingRequestIds={respondingRequestIds}
            answers={draft.activePendingDraftAnswers}
            questionIndex={draft.activePendingQuestionIndex}
            onToggleOption={draft.onSelectActivePendingUserInputOption}
            onAdvance={draft.onAdvanceActivePendingUserInput}
            autoAdvance={false}
            globalShortcuts={false}
          />
          <div className="px-4 pb-3 sm:px-5">
            <input
              aria-label={question.options.length ? "Other answer" : "Your answer"}
              placeholder={
                question.options.length ? "Other — write your answer" : "Write your answer"
              }
              value={progress.customAnswer}
              disabled={responding}
              onChange={(event) =>
                draft.onChangeActivePendingUserInputCustomAnswer(question.id, event.target.value)
              }
              className="w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <div className="mt-3 flex justify-end gap-2">
              {progress.questionIndex > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={draft.onPreviousActivePendingUserInputQuestion}
                  disabled={responding}
                >
                  Back
                </Button>
              )}
              <Button
                type="submit"
                disabled={
                  responding ||
                  !progress.canAdvance ||
                  (progress.isLastQuestion && !draft.activePendingResolvedAnswers)
                }
              >
                {responding ? "Sending…" : progress.isLastQuestion ? "Send answer" : "Next"}
              </Button>
            </div>
          </div>
        </form>
      )}
    </section>
  );
}
