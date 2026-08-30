import type { ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useMemo, type RefObject } from "react";
import { create } from "zustand";
import {
  buildPendingUserInputAnswers,
  derivePendingUserInputProgress,
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
  type PendingUserInputDraftAnswer,
} from "../../pendingUserInput";
import type { PendingUserInput } from "../../session-logic";
import type { ChatComposerHandle } from "./ChatComposer";

type QuestionDraft = { answers: Record<string, PendingUserInputDraftAnswer>; index: number };
const EMPTY_DRAFT: QuestionDraft = { answers: {}, index: 0 };
// Question drafts outlive panel mounts, including promotion into the main view.
// The provider owns the pending request; this stores only unfinished local answers.
const useQuestionDrafts = create<{ drafts: Record<string, QuestionDraft> }>(() => ({ drafts: {} }));

export function clearPendingUserInputDrafts(threadRef: ScopedThreadRef) {
  const prefix = `${scopedThreadKey(threadRef)}:`;
  useQuestionDrafts.setState(({ drafts }) => ({
    drafts: Object.fromEntries(Object.entries(drafts).filter(([key]) => !key.startsWith(prefix))),
  }));
}

export function usePendingUserInput(input: {
  threadRef: ScopedThreadRef;
  request: PendingUserInput | null;
  composerRef: RefObject<ChatComposerHandle | null>;
  promptRef: RefObject<string>;
  onRespond: (
    requestId: PendingUserInput["requestId"],
    answers: Record<string, unknown>,
  ) => unknown;
}) {
  const { request, composerRef, promptRef, onRespond } = input;
  const key = `${scopedThreadKey(input.threadRef)}:${request?.requestId ?? ""}`;
  const draft = useQuestionDrafts((state) => state.drafts[key] ?? EMPTY_DRAFT);
  const update = (fn: (draft: QuestionDraft) => QuestionDraft) => {
    if (!request) return;
    useQuestionDrafts.setState(({ drafts }) => ({
      drafts: { ...drafts, [key]: fn(drafts[key] ?? EMPTY_DRAFT) },
    }));
  };
  const activePendingProgress = useMemo(
    () =>
      request
        ? derivePendingUserInputProgress(request.questions, draft.answers, draft.index)
        : null,
    [request, draft],
  );
  const activePendingResolvedAnswers = useMemo(
    () => (request ? buildPendingUserInputAnswers(request.questions, draft.answers) : null),
    [request, draft.answers],
  );

  return {
    activePendingDraftAnswers: draft.answers,
    activePendingQuestionIndex: draft.index,
    activePendingProgress,
    activePendingResolvedAnswers,
    onSelectActivePendingUserInputOption(questionId: string, label: string) {
      const question = request?.questions.find((entry) => entry.id === questionId);
      if (!question) return;
      update((current) => ({
        ...current,
        answers: {
          ...current.answers,
          [questionId]: togglePendingUserInputOptionSelection(
            question,
            current.answers[questionId],
            label,
          ),
        },
      }));
      promptRef.current = "";
      composerRef.current?.resetCursorState({ cursor: 0 });
    },
    onChangeActivePendingUserInputCustomAnswer(
      questionId: string,
      value: string,
      nextCursor: number,
      expandedCursor: number,
      _cursorAdjacentToMention: boolean,
    ) {
      if (!request) return;
      promptRef.current = value;
      update((current) => ({
        ...current,
        answers: {
          ...current.answers,
          [questionId]: setPendingUserInputCustomAnswer(current.answers[questionId], value),
        },
      }));
      const snapshot = composerRef.current?.readSnapshot();
      if (
        snapshot?.value !== value ||
        snapshot.cursor !== nextCursor ||
        snapshot.expandedCursor !== expandedCursor
      ) {
        composerRef.current?.focusAt(nextCursor);
      }
    },
    onAdvanceActivePendingUserInput() {
      if (!request || !activePendingProgress) return;
      if (activePendingProgress.isLastQuestion) {
        if (activePendingResolvedAnswers)
          void onRespond(request.requestId, activePendingResolvedAnswers);
      } else update((current) => ({ ...current, index: activePendingProgress.questionIndex + 1 }));
    },
    onPreviousActivePendingUserInputQuestion() {
      update((current) => ({ ...current, index: Math.max(0, current.index - 1) }));
    },
  };
}
