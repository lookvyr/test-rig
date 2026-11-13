import { resumableThreadRunId } from "../ChatView.logic";
import {
  canSendThreadFollowUp,
  resolveLatestMergeBackRun,
} from "@t3tools/client-runtime/state/thread-workflows";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  ProviderDriverKind,
  type RuntimeRequestId,
  type MessageId,
  type ProviderApprovalDecision,
  type ScopedThreadRef,
  type ServerProvider,
  type RunId,
  type ThreadId,
} from "@t3tools/contracts";
import type { LegendListRef } from "@legendapp/list/react";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { ChevronDownIcon, Trash2Icon, Undo2Icon, XIcon } from "lucide-react";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import {
  resolvePickedModelSelection,
  useComposerDraftStore,
  type ComposerImageAttachment,
} from "../../composerDraftStore";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useTheme } from "../../hooks/useTheme";
import { useEnvironment } from "../../state/environments";
import { useProject, useThread } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { threadEnvironment, useEnvironmentThread } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { derivePendingThreadRequests } from "@t3tools/client-runtime/state/threadRequests";
import { deriveThreadCheckpointSummaries } from "@t3tools/client-runtime/state/thread-checkpoints";

import {
  derivePendingApprovals,
  derivePendingUserInputs,
  isBlockingUserInput,
  derivePhase,
  deriveCanInterruptRunningThread,
  selectThreadMessages,
  deriveActiveWorkStartedAt,
  isLatestRunSettled,
} from "../../session-logic";
import {
  buildThreadTurnInterruptInput,
  deriveComposerSendState,
  getStartedThreadModelChangeBlockReason,
  readFileAsDataUrl,
} from "../ChatView.logic";
import { type TerminalContextDraft } from "../../lib/terminalContext";
import { type ElementContextDraft } from "../../lib/elementContext";
import { newMessageId } from "../../lib/utils";
import { resolveShortcutCommand } from "../../keybindings";
import { parseStandaloneComposerSlashCommand } from "../../composer-logic";
import type { Thread, TurnDiffSummary } from "../../types";
import { ChatComposer, type ChatComposerHandle } from "./ChatComposer";
import { MessagesTimeline } from "./MessagesTimeline";
import { useTimelineScroll } from "./useTimelineScroll";
import {
  answerShownApprovalsWithMessage,
  draftAttachmentLists,
  draftAttachmentListsChanged,
} from "./composerApprovalRedirect";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";
import { useLocalDispatchState } from "./useLocalDispatchState";
import { usePersistThreadSettings } from "./usePersistThreadSettings";
import { useThreadTimeline } from "./useThreadTimeline";
import { useMessagesWithImages } from "./useMessagesWithImages";
import { usePendingUserInput, clearPendingUserInputDrafts } from "./usePendingUserInput";
import { AsyncUserInputPanel } from "./AsyncUserInputPanel";
import {
  formatOutgoingPrompt,
  serializeComposerPrompt,
  prepareComposerMessage,
} from "./composerMessage";
import { parseSideChatCommand } from "../../composer-logic";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const EMPTY_PROVIDERS: ServerProvider[] = [];

/** Side chats opened with `/side <question>`; each sends its seeded draft once it can. */
const pendingSends = new Set<string>();

export function requestSideChatSend(threadRef: ScopedThreadRef): void {
  pendingSends.add(scopedThreadKey(threadRef));
}

export function SideChatPanel(props: {
  threadRef: ScopedThreadRef;
  parentThread: Thread;
  focusRequest: number;
  onDelete: () => void;
  onClose: () => void;
  onOpenThread: (threadId: ThreadId) => void;
  onForkFromRun: (input: {
    readonly sourceThreadId: ThreadId;
    readonly runId: RunId;
  }) => Promise<void>;
  onOpenTurnDiff: (runId: RunId, filePath?: string) => void;
  onExpandImage: (image: ExpandedImagePreview) => void;
}) {
  const { threadRef } = props;
  const thread = useThread(threadRef, { waitForShell: true });
  const page = useEnvironmentThread(
    thread ? threadRef.environmentId : null,
    thread ? threadRef.threadId : null,
  );
  const settingsThread = thread ?? props.parentThread;
  const project = useProject(scopeProjectRef(threadRef.environmentId, settingsThread.projectId));
  const environment = useEnvironment(threadRef.environmentId);
  const config = useAtomValue(serverEnvironment.configValueAtom(threadRef.environmentId));
  const settings = useEnvironmentSettings(threadRef.environmentId);
  // Like the main composer, the permissions chip shows only when it differs from the default.
  const projectDefaultRuntimeMode = resolveProjectSettings(
    config?.settings ?? settings,
    settingsThread.projectId,
    project,
  ).settings.defaultRuntimeMode;
  const { resolvedTheme } = useTheme();
  const keybindings = config?.keybindings ?? DEFAULT_RESOLVED_KEYBINDINGS;
  const providers = config?.providers ?? EMPTY_PROVIDERS;
  const composerRef = useRef<ChatComposerHandle | null>(null);
  const promptRef = useRef("");
  const imagesRef = useRef<ComposerImageAttachment[]>([]);
  const terminalContextsRef = useRef<TerminalContextDraft[]>([]);
  const elementContextsRef = useRef<ElementContextDraft[]>([]);
  const listRef = useRef<LegendListRef | null>(null);
  const sending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [bringingBack, setBringingBack] = useState(false);
  const [respondingRequestIds, setRespondingRequestIds] = useState<RuntimeRequestId[]>([]);
  const [respondingInputIds, setRespondingInputIds] = useState<RuntimeRequestId[]>([]);
  const scroll = useTimelineScroll({ threadKey: scopedThreadKey(threadRef), listRef });
  const runtimeModeDraft = useComposerDraftStore(
    (store) => store.getComposerDraft(threadRef)?.runtimeMode,
  );
  const interactionModeDraft = useComposerDraftStore(
    (store) => store.getComposerDraft(threadRef)?.interactionMode,
  );
  const runtimeMode = runtimeModeDraft ?? settingsThread.runtimeMode ?? "full-access";
  const interactionMode = settings.planModeEnabled
    ? (interactionModeDraft ?? settingsThread.interactionMode ?? "default")
    : "default";
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const persistSettings = usePersistThreadSettings(threadRef.environmentId, thread);
  const interrupt = useAtomCommand(threadEnvironment.interruptTurn, { reportFailure: false });
  const respondApproval = useAtomCommand(threadEnvironment.respondToApproval, {
    reportFailure: false,
  });
  const respondInput = useAtomCommand(threadEnvironment.respondToUserInput, {
    reportFailure: false,
  });
  const phase = derivePhase(thread?.runtime ?? null);
  const projection = thread?.projection;
  const pendingRequests = useMemo(
    () =>
      projection ? derivePendingThreadRequests(projection) : { approvals: [], userInputs: [] },
    [projection],
  );
  const pendingApprovals = derivePendingApprovals(pendingRequests.approvals);
  // The composer holds approvals that arrive mid-typing; the timeline shows them once released.
  const [heldApprovalRequestIds, setHeldApprovalRequestIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const onHeldRequestIdsChange = useCallback((requestIds: ReadonlySet<string>) => {
    setHeldApprovalRequestIds((current) =>
      current.size === requestIds.size && [...requestIds].every((id) => current.has(id))
        ? current
        : requestIds,
    );
  }, []);
  const allPendingUserInputs = derivePendingUserInputs(pendingRequests.userInputs);
  const pendingUserInputs = allPendingUserInputs.filter(isBlockingUserInput);
  const nonBlockingUserInputs = allPendingUserInputs.filter(
    (request) => !isBlockingUserInput(request),
  );
  const onRespondToUserInput = async (
    requestId: RuntimeRequestId,
    answers: Record<string, unknown>,
  ) => {
    const request = allPendingUserInputs.find((input) => input.requestId === requestId);
    if (!request || request.responseCapability === "not_resumable") return;
    if (respondingInputIds.includes(requestId)) return;
    setRespondingInputIds((ids) => [...ids, requestId]);
    const result = await respondInput({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, requestId, answers },
    });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result))
      setError(String(squashAtomCommandFailure(result)));
    if (result._tag === "Success") clearPendingUserInputDrafts(threadRef, requestId);
    setRespondingInputIds((ids) => ids.filter((id) => id !== requestId));
  };
  const pending = usePendingUserInput({
    threadRef,
    request: pendingUserInputs[0] ?? null,
    composerRef,
    promptRef,
    onRespond: onRespondToUserInput,
  });
  const dispatch = useLocalDispatchState({
    activeThread: thread ?? undefined,
    activeLatestRun: thread?.latestRun ?? null,
    phase,
    activePendingApproval: pendingApprovals[0]?.requestId ?? null,
    activePendingUserInput: pendingUserInputs[0]?.requestId ?? null,
    threadError: error ?? thread?.runtime?.lastError,
  });
  // The side chat's context is captured at its first send, so it is ready once its thread exists.
  const preparing = !thread || !projection;
  const unavailable = environment?.connection.phase !== "connected";
  const isWorking = phase === "running" || dispatch.isSendBusy;
  const messages = useMessagesWithImages(threadRef.environmentId, selectThreadMessages(projection));
  const timelineEntries = useThreadTimeline(projection, messages);
  const diffs = useMemo(
    () =>
      new Map<MessageId, TurnDiffSummary>(
        (projection ? deriveThreadCheckpointSummaries(projection) : []).flatMap((checkpoint) =>
          checkpoint.assistantMessageId
            ? [[checkpoint.assistantMessageId, checkpoint] as const]
            : [],
        ),
      ),
    [projection],
  );
  const loadEarlierHistory = useAtomCommand(threadEnvironment.loadEarlierHistory);
  const focus = () => composerRef.current?.focusAtEnd();
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      composerRef.current?.focusAtEnd();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [props.focusRequest]);

  const resumableRunId = resumableThreadRunId(projection, thread?.runtime?.lastErrorClass);
  const sendStandaloneCommand = async (text: string, continuationOfRunId?: RunId) => {
    const context = composerRef.current?.getSendContext();
    if (
      !thread ||
      !context?.providerAvailable ||
      preparing ||
      unavailable ||
      sending.current ||
      dispatch.isSendBusy ||
      phase === "running" ||
      pendingApprovals.length > 0 ||
      pendingUserInputs.length > 0
    )
      return;
    sending.current = true;
    dispatch.beginLocalDispatch();
    scroll.prepareForSend();
    setError(null);
    try {
      const createdAt = new Date().toISOString();
      const settingsResult = await persistSettings({
        threadId: threadRef.threadId,
        createdAt,
        runtimeMode,
        interactionMode,
      });
      if (settingsResult._tag === "Failure") throw squashAtomCommandFailure(settingsResult);
      const result = await startTurn({
        environmentId: threadRef.environmentId,
        input: {
          threadId: threadRef.threadId,
          message: { messageId: newMessageId(), role: "user", text, attachments: [] },
          modelSelection: context.selectedModelSelection,
          runtimeMode,
          interactionMode,
          dispatchMode: "start",
          createdAt,
          ...(continuationOfRunId === undefined
            ? {}
            : { manualContinuationOfRunId: continuationOfRunId }),
        },
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result))
        throw squashAtomCommandFailure(result);
    } catch (error) {
      dispatch.resetLocalDispatch();
      setError(error instanceof Error ? error.message : "Failed to start the turn.");
    } finally {
      sending.current = false;
    }
  };

  const send = async (event?: { preventDefault: () => void }) => {
    event?.preventDefault();
    const context = composerRef.current?.getSendContext();
    if (pending.activePendingProgress && context?.answeringPendingUserInput !== false) {
      pending.onAdvanceActivePendingUserInput();
      return;
    }
    if (
      !thread ||
      !context?.providerAvailable ||
      preparing ||
      unavailable ||
      sending.current ||
      dispatch.isSendBusy ||
      !canSendThreadFollowUp(projection)
    )
      return;
    const snapshot = deriveComposerSendState({
      prompt: context.prompt,
      imageCount: context.images.length,
      terminalContexts: context.terminalContexts,
      elementContextCount:
        context.elementContexts.length +
        context.previewAnnotations.length +
        context.reviewComments.length,
    });
    const hasOnlyText =
      context.images.length === 0 &&
      snapshot.sendableTerminalContexts.length === 0 &&
      context.elementContexts.length === 0 &&
      context.previewAnnotations.length === 0 &&
      context.reviewComments.length === 0;
    if (hasOnlyText && parseSideChatCommand(context.prompt) !== null) {
      setError("Side chats cannot start side chats.");
      return;
    }
    const modeCommand =
      settings.planModeEnabled && hasOnlyText
        ? parseStandaloneComposerSlashCommand(context.prompt)
        : null;
    if (modeCommand) {
      useComposerDraftStore.getState().setInteractionMode(threadRef, modeCommand);
      useComposerDraftStore.getState().clearComposerContent(threadRef);
      promptRef.current = "";
      composerRef.current?.resetCursorState();
      return;
    }
    if (!snapshot.hasSendableContent) return;
    const prepared = prepareComposerMessage(
      serializeComposerPrompt({ ...context, terminalContexts: snapshot.sendableTerminalContexts }),
      context.threadContexts,
      threadRef.environmentId,
    );
    if (prepared.error) {
      setError(prepared.error);
      return;
    }
    // A message sent while approvals are shown answers them: feedback for an approval that
    // takes it, otherwise a decline that lets the message redirect the agent.
    const shownApprovals = pendingApprovals.filter((approval) =>
      context.shownPendingApprovalIds.includes(approval.requestId),
    );
    if (shownApprovals.length > 0) {
      sending.current = true;
      const readAttachmentLists = () =>
        draftAttachmentLists(useComposerDraftStore.getState().getComposerDraft(threadRef));
      const attachmentListsForSend = readAttachmentLists();
      const draftChanged = () =>
        promptRef.current !== context.prompt ||
        draftAttachmentListsChanged(attachmentListsForSend, readAttachmentLists());
      const outcome = await answerShownApprovalsWithMessage({
        shownApprovals,
        text: prepared.text,
        hasAttachmentsOrContext:
          context.images.length > 0 ||
          snapshot.sendableTerminalContexts.length > 0 ||
          context.elementContexts.length > 0 ||
          context.previewAnnotations.length > 0 ||
          context.reviewComments.length > 0 ||
          prepared.context !== undefined,
        respondingRequestIds,
        respond: onRespondToApproval,
        draftChanged,
        readShownApprovalIds: () =>
          composerRef.current?.getSendContext().shownPendingApprovalIds ?? [],
      });
      sending.current = false;
      if (outcome.type === "feedback-sent") {
        if (!draftChanged()) {
          useComposerDraftStore.getState().clearComposerContent(threadRef);
          promptRef.current = "";
          composerRef.current?.resetCursorState();
        }
        return;
      }
      if (outcome.type === "stopped") {
        const message = outcome.error ?? outcome.notice;
        if (message) setError(message);
        return;
      }
    }
    sending.current = true;
    setError(null);
    dispatch.beginLocalDispatch();
    scroll.prepareForSend();
    const draftStore = useComposerDraftStore.getState();
    const submittedDraft = draftStore.getComposerDraft(threadRef);
    draftStore.clearComposerContent(threadRef);
    promptRef.current = "";
    composerRef.current?.resetCursorState();
    const restoreDraft = () => {
      const current = useComposerDraftStore.getState().getComposerDraft(threadRef);
      if (
        !submittedDraft ||
        current?.prompt ||
        current?.images.length ||
        current?.terminalContexts.length ||
        current?.elementContexts.length ||
        current?.previewAnnotations.length ||
        current?.reviewComments.length
      )
        return;
      useComposerDraftStore.setState((state) => ({
        draftsByThreadKey: {
          ...state.draftsByThreadKey,
          [scopedThreadKey(threadRef)]: submittedDraft,
        },
      }));
    };
    try {
      const text = prepared.text;
      const attachments = await Promise.all(
        context.images.map(async (image) => ({
          type: "image" as const,
          name: image.name,
          mimeType: image.mimeType,
          sizeBytes: image.sizeBytes,
          dataUrl: await readFileAsDataUrl(image.file),
        })),
      );
      const settingsResult = await persistSettings({
        threadId: threadRef.threadId,
        createdAt: new Date().toISOString(),
        runtimeMode,
        interactionMode,
      });
      if (settingsResult._tag === "Failure") throw squashAtomCommandFailure(settingsResult);
      const result = await startTurn({
        environmentId: threadRef.environmentId,
        input: {
          threadId: threadRef.threadId,
          message: {
            messageId: newMessageId(),
            role: "user",
            text: formatOutgoingPrompt({
              provider: context.selectedProvider,
              model: context.selectedModel,
              models: context.selectedProviderModels,
              effort: context.selectedPromptEffort,
              text: text || "Respond using the conversation context and the attached images.",
            }),
            attachments,
            ...(prepared.context ? { context: prepared.context } : {}),
          },
          ...(projection?.messages.some((message) => message.role === "user")
            ? {}
            : { titleSeed: context.prompt.trim().slice(0, 80) || "Side chat" }),
          modelSelection: context.selectedModelSelection,
          runtimeMode,
          interactionMode,
          createdAt: new Date().toISOString(),
        },
      });
      if (result._tag === "Failure") {
        restoreDraft();
        dispatch.resetLocalDispatch();
        if (!isAtomCommandInterrupted(result)) setError(String(squashAtomCommandFailure(result)));
      } else {
        for (const image of context.images) URL.revokeObjectURL(image.previewUrl);
      }
    } catch (cause) {
      restoreDraft();
      setError(cause instanceof Error ? cause.message : String(cause));
      dispatch.resetLocalDispatch();
    } finally {
      sending.current = false;
    }
  };
  const onInterrupt = async () => {
    if (!thread) return;
    const result = await interrupt({
      environmentId: threadRef.environmentId,
      input: buildThreadTurnInterruptInput(thread),
    });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result))
      setError(String(squashAtomCommandFailure(result)));
  };
  const onRespondToApproval = async (
    requestId: RuntimeRequestId,
    decision: ProviderApprovalDecision,
    feedback?: string,
  ) => {
    setRespondingRequestIds((ids) => [...ids, requestId]);
    const result = await respondApproval({
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        requestId,
        decision,
        ...(feedback === undefined ? {} : { feedback }),
      },
    });
    setRespondingRequestIds((ids) => ids.filter((id) => id !== requestId));
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result))
      setError(String(squashAtomCommandFailure(result)));
    return result;
  };
  // Before its first turn a side chat may switch to any provider; after it, the usual rules apply.
  const hasStartedSession = (projection?.runs.length ?? 0) > 0;
  // A question from `/side <question>` sends once the side chat and its composer are ready.
  const sendSeededQuestion = useEffectEvent(() => void send());
  const threadKey = scopedThreadKey(threadRef);
  const canAutoSend = !preparing && !unavailable;
  useEffect(() => {
    if (!canAutoSend || !pendingSends.has(threadKey)) return;
    const frame = window.requestAnimationFrame(() => {
      if (pendingSends.delete(threadKey)) sendSeededQuestion();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [canAutoSend, threadKey]);

  const mergeBack = useAtomCommand(threadEnvironment.mergeBack, { reportFailure: false });
  const mergeRun = projection ? resolveLatestMergeBackRun(projection) : null;
  // A pending merge-back waits for the parent's next message, so the server needs it idle.
  const bringBackBlockedReason = threadRuntimeIsActive(props.parentThread.runtime)
    ? "Available when the main thread is idle."
    : mergeRun === null
      ? "Available after a finished reply."
      : null;
  const bringBack = async () => {
    if (bringBackBlockedReason !== null || mergeRun === null || bringingBack) return;
    setBringingBack(true);
    const result = await mergeBack({
      environmentId: threadRef.environmentId,
      input: {
        sourceThreadId: threadRef.threadId,
        targetThreadId: props.parentThread.id,
        runId: mergeRun.id,
      },
    });
    setBringingBack(false);
    if (result._tag === "Success") {
      toastManager.add({
        type: "success",
        title: "Brought back",
        description: "The main thread gets this side chat with your next message there.",
      });
    } else if (!isAtomCommandInterrupted(result)) {
      const failure = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: "Could not bring back the side chat",
        description: failure instanceof Error ? failure.message : String(failure),
      });
    }
  };
  const cwd = settingsThread.worktreePath ?? project?.workspaceRoot;
  const shownError = error ?? thread?.runtime?.lastError;
  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      data-side-chat="true"
      onKeyDownCapture={(event) => {
        const command = resolveShortcutCommand(event.nativeEvent, keybindings, {
          context: {
            terminalFocus: false,
            terminalOpen: false,
            modelPickerOpen: composerRef.current?.isModelPickerOpen() ?? false,
          },
        });
        if (
          command === "modelPicker.toggle" ||
          command === "composer.increaseEffort" ||
          command === "composer.decreaseEffort"
        ) {
          event.preventDefault();
          event.stopPropagation();
          if (command === "modelPicker.toggle") composerRef.current?.toggleModelPicker();
          else if (!event.repeat)
            composerRef.current?.stepReasoningEffort(
              command === "composer.increaseEffort" ? 1 : -1,
            );
        }
      }}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/50 pr-1.5 pl-3">
        <span className="min-w-0 flex-1 truncate text-xs font-medium" title={thread?.title}>
          {thread?.title ?? "Side chat"}
        </span>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-disabled={bringBackBlockedReason !== null || bringingBack}
                onClick={() => void bringBack()}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground aria-disabled:cursor-default aria-disabled:opacity-50 aria-disabled:hover:bg-transparent aria-disabled:hover:text-muted-foreground"
              />
            }
          >
            <Undo2Icon className="size-3.5" /> Bring back
          </TooltipTrigger>
          <TooltipPopup side="bottom">
            {bringBackBlockedReason ?? "Adds this side chat to the main thread's next message."}
          </TooltipPopup>
        </Tooltip>
        <button
          type="button"
          aria-label="Delete side chat"
          title="Delete side chat"
          onClick={props.onDelete}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Trash2Icon className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="Close side chat"
          title="Close side chat"
          onClick={props.onClose}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>
      <div className="flex shrink-0 items-center gap-2 px-3 pt-2 text-[11px] text-muted-foreground">
        <span className="h-px flex-1 bg-border/60" />
        <span className="min-w-0 truncate">Context from {props.parentThread.title}</span>
        <span className="h-px flex-1 bg-border/60" />
      </div>
      {shownError ? (
        <div role="alert" className="border-b border-border/50 px-3 py-2 text-xs text-destructive">
          {shownError}
        </div>
      ) : null}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {timelineEntries.length === 0 ? (
          <div className="flex min-h-24 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-sm">Ask a side question</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              It starts with what the main thread knows, and the main thread keeps working.
            </p>
          </div>
        ) : (
          <MessagesTimeline
            isWorking={isWorking}
            activeTurnInProgress={
              isWorking || !isLatestRunSettled(thread?.latestRun ?? null, thread?.runtime ?? null)
            }
            activeTurnStartedAt={deriveActiveWorkStartedAt(
              thread?.latestRun ?? null,
              thread?.runtime ?? null,
              dispatch.localDispatchStartedAt,
            )}
            listRef={listRef}
            timelineEntries={timelineEntries}
            latestRun={thread?.latestRun ?? null}
            runningRunId={thread?.runtime?.activeRunId ?? null}
            turnDiffSummaries={[...diffs.values()]}
            providerStatuses={providers}
            runs={projection?.runs ?? []}
            onOpenThread={props.onOpenThread}
            onForkFromRun={props.onForkFromRun}
            routeThreadKey={scopedThreadKey(threadRef)}
            onOpenTurnDiff={props.onOpenTurnDiff}
            onImageExpand={props.onExpandImage}
            activeThreadEnvironmentId={threadRef.environmentId}
            markdownCwd={cwd}
            resolvedTheme={resolvedTheme}
            timestampFormat={settings.timestampFormat}
            workspaceRoot={cwd}
            anchorMessageId={null}
            onAnchorReady={() => undefined}
            onAnchorSizeChanged={() => undefined}
            contentInsetEndAdjustment={0}
            liveFollowEnabled={scroll.liveFollowEnabled}
            onIsAtEndChange={scroll.onIsAtEndChange}
            onManualNavigation={scroll.cancelForUserNavigation}
            onScrollElementChange={scroll.onScrollElementChange}
            pendingApprovals={pendingApprovals}
            heldApprovalRequestIds={heldApprovalRequestIds}
            respondingRequestIds={respondingRequestIds}
            onRespondToApproval={onRespondToApproval}
            onFooterGrow={() => {
              if (scroll.modeRef.current === "following-end") scroll.scrollToEnd();
            }}
            loadEarlier={
              page.history.hasMoreHistory || page.history.error !== null
                ? {
                    loading: page.history.loading,
                    onLoadEarlier: () =>
                      void loadEarlierHistory({
                        environmentId: threadRef.environmentId,
                        input: { threadId: threadRef.threadId },
                      }),
                  }
                : null
            }
          />
        )}
        {scroll.showScrollToBottom && (
          <div className="pointer-events-none absolute bottom-1 left-1/2 z-30 flex -translate-x-1/2 justify-center py-1.5">
            <button
              type="button"
              aria-label="Scroll to end"
              title="Scroll to end"
              onClick={() => scroll.scrollToEnd(true)}
              className="chat-composer-glass pointer-events-auto flex items-center gap-1.5 rounded-full border border-border/60 px-3 py-1 text-muted-foreground text-xs shadow-sm transition-colors hover:border-border hover:text-foreground hover:cursor-pointer"
            >
              <ChevronDownIcon className="size-3.5" /> Scroll to end
            </button>
          </div>
        )}
      </div>
      <div className="shrink-0 px-2 pb-2 pt-1">
        {nonBlockingUserInputs.length > 0 && (
          <AsyncUserInputPanel
            key={scopedThreadKey(threadRef)}
            threadRef={threadRef}
            requests={nonBlockingUserInputs}
            respondingRequestIds={respondingInputIds}
            onRespond={onRespondToUserInput}
          />
        )}
        <div className="chat-composer-glass-shell">
          <div className="chat-composer-glass-host relative z-10 rounded-[22px] redesign:rounded-2xl">
            <ChatComposer
              composerDraftTarget={threadRef}
              environmentId={threadRef.environmentId}
              routeKind="server"
              routeThreadRef={threadRef}
              draftId={null}
              activeThreadId={threadRef.threadId}
              promptHistoryMessages={selectThreadMessages(projection)}
              activeThreadEnvironmentId={threadRef.environmentId}
              activeThread={thread ?? undefined}
              isServerThread
              isLocalDraftThread={false}
              forceExpandedOnMobile
              projectSelectionRequired={false}
              phase={phase}
              isConnecting={false}
              isSendBusy={dispatch.isSendBusy}
              sendDisabledReason={preparing ? "Side chat is opening" : null}
              isPreparingWorktree={false}
              environmentUnavailable={
                unavailable && environment
                  ? { label: environment.label, connection: environment.connection }
                  : null
              }
              activePendingApproval={pendingApprovals[0] ?? null}
              pendingApprovals={pendingApprovals}
              pendingUserInputs={pendingUserInputs}
              {...pending}
              activePendingIsResponding={
                pendingUserInputs[0] !== undefined &&
                respondingInputIds.includes(pendingUserInputs[0].requestId)
              }
              respondingRequestIds={respondingRequestIds}
              showPlanFollowUpPrompt={false}
              activeProposedPlan={null}
              runtimeMode={runtimeMode}
              defaultRuntimeMode={projectDefaultRuntimeMode}
              interactionMode={interactionMode}
              lockedProvider={
                settingsThread.runtime?.providerName
                  ? ProviderDriverKind.make(settingsThread.runtime.providerName)
                  : null
              }
              providerStatuses={[...providers]}
              activeProjectDefaultModelSelection={project?.defaultModelSelection}
              activeThreadModelSelection={settingsThread.modelSelection}
              activeThreadProjection={projection}
              canInterrupt={deriveCanInterruptRunningThread(
                thread !== null,
                thread?.runtime ?? null,
              )}
              resolvedTheme={resolvedTheme}
              settings={settings}
              keybindings={keybindings}
              terminalOpen={false}
              gitCwd={cwd ?? null}
              promptRef={promptRef}
              composerImagesRef={imagesRef}
              composerTerminalContextsRef={terminalContextsRef}
              composerElementContextsRef={elementContextsRef}
              composerRef={composerRef}
              onSend={(event) => void send(event)}
              onInterrupt={() => void onInterrupt()}
              canResume={resumableRunId !== null && phase !== "running" && !dispatch.isSendBusy}
              onResume={() => {
                if (resumableRunId !== null)
                  void sendStandaloneCommand("Continue where you left off.", resumableRunId);
              }}
              onImplementPlanInNewThread={() => undefined}
              onHeldRequestIdsChange={onHeldRequestIdsChange}
              onProviderModelSelect={(instanceId, model) => {
                const nextModelSelection = resolvePickedModelSelection(
                  threadRef,
                  instanceId,
                  model,
                );
                if (
                  !getStartedThreadModelChangeBlockReason({
                    providers,
                    hasStartedSession,
                    currentModelSelection: settingsThread.modelSelection,
                    currentProviderInstanceId: settingsThread.runtime?.providerInstanceId ?? null,
                    nextModelSelection,
                  })
                )
                  useComposerDraftStore.getState().setModelSelection(threadRef, nextModelSelection);
              }}
              getModelDisabledReason={(instanceId, model) =>
                getStartedThreadModelChangeBlockReason({
                  providers,
                  hasStartedSession,
                  currentModelSelection: settingsThread.modelSelection,
                  currentProviderInstanceId: settingsThread.runtime?.providerInstanceId ?? null,
                  nextModelSelection: { instanceId, model },
                })?.description ?? null
              }
              toggleInteractionMode={() =>
                useComposerDraftStore
                  .getState()
                  .setInteractionMode(threadRef, interactionMode === "plan" ? "default" : "plan")
              }
              handleRuntimeModeChange={(mode) =>
                useComposerDraftStore.getState().setRuntimeMode(threadRef, mode)
              }
              handleInteractionModeChange={(mode) =>
                useComposerDraftStore.getState().setInteractionMode(threadRef, mode)
              }
              focusComposer={focus}
              scheduleComposerFocus={focus}
              setThreadError={(_id, message) => setError(message)}
              onExpandImage={props.onExpandImage}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
