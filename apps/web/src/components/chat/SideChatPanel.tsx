import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  ProviderDriverKind,
  type ApprovalRequestId,
  type MessageId,
  type ProviderApprovalDecision,
  type ScopedThreadRef,
  type ServerProvider,
  type TurnId,
} from "@t3tools/contracts";
import type { LegendListRef } from "@legendapp/list/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { useComposerDraftStore, type ComposerImageAttachment } from "../../composerDraftStore";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useTheme } from "../../hooks/useTheme";
import { useEnvironment } from "../../state/environments";
import { useProject, useThread } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { threadEnvironment, useEnvironmentThread } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  requestOlderThreadTurns,
  threadHasOlderTurns,
} from "@t3tools/client-runtime/state/threads";
import {
  derivePendingApprovals,
  derivePendingUserInputs,
  derivePhase,
  deriveTimelineEntries,
  deriveTurnPlans,
  deriveWorkLogEntries,
  deriveActiveWorkStartedAt,
  isLatestTurnSettled,
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
import type { TurnDiffSummary } from "../../types";
import { readLocalApi } from "../../localApi";
import { ChatComposer, type ChatComposerHandle } from "./ChatComposer";
import { MessagesTimeline } from "./MessagesTimeline";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";
import { useLocalDispatchState } from "./useLocalDispatchState";
import { usePersistThreadSettings } from "./usePersistThreadSettings";
import { useMessagesWithImages } from "./useMessagesWithImages";
import { usePendingUserInput, clearPendingUserInputDrafts } from "./usePendingUserInput";
import { formatOutgoingPrompt, serializeComposerPrompt } from "./composerMessage";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";

const NO_REVERTS = new Map<MessageId, number>();
const EMPTY_PROVIDERS: ServerProvider[] = [];

export function SideChatPanel(props: {
  threadRef: ScopedThreadRef;
  onKeep: () => Promise<void>;
  onDiscard: () => Promise<void>;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
  onExpandImage: (image: ExpandedImagePreview) => void;
}) {
  const { threadRef } = props;
  const thread = useThread(threadRef, { waitForShell: true });
  const page = useEnvironmentThread(
    thread ? threadRef.environmentId : null,
    thread ? threadRef.threadId : null,
  );
  const project = useProject(
    thread ? scopeProjectRef(threadRef.environmentId, thread.projectId) : null,
  );
  const environment = useEnvironment(threadRef.environmentId);
  const config = useAtomValue(serverEnvironment.configValueAtom(threadRef.environmentId));
  const settings = useEnvironmentSettings(threadRef.environmentId);
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
  const focusedOnOpen = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [respondingRequestIds, setRespondingRequestIds] = useState<ApprovalRequestId[]>([]);
  const [inputResponding, setInputResponding] = useState(false);
  const [liveFollow, setLiveFollow] = useState(true);
  const runtimeModeDraft = useComposerDraftStore(
    (store) => store.getComposerDraft(threadRef)?.runtimeMode,
  );
  const interactionModeDraft = useComposerDraftStore(
    (store) => store.getComposerDraft(threadRef)?.interactionMode,
  );
  const runtimeMode = runtimeModeDraft ?? thread?.runtimeMode ?? "full-access";
  const interactionMode = settings.planModeEnabled
    ? (interactionModeDraft ?? thread?.interactionMode ?? "default")
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
  const phase = derivePhase(thread?.session ?? null);
  const pendingApprovals = useMemo(
    () => derivePendingApprovals(thread?.activities ?? []),
    [thread?.activities],
  );
  const pendingUserInputs = useMemo(
    () => derivePendingUserInputs(thread?.activities ?? []),
    [thread?.activities],
  );
  const pending = usePendingUserInput({
    threadRef,
    request: pendingUserInputs[0] ?? null,
    composerRef,
    promptRef,
    onRespond: async (requestId, answers) => {
      if (inputResponding) return;
      setInputResponding(true);
      const result = await respondInput({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, requestId, answers },
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result))
        setError(String(squashAtomCommandFailure(result)));
      if (result._tag === "Success") clearPendingUserInputDrafts(threadRef);
      setInputResponding(false);
    },
  });
  const dispatch = useLocalDispatchState({
    activeThread: thread ?? undefined,
    activeLatestTurn: thread?.latestTurn ?? null,
    phase,
    activePendingApproval: pendingApprovals[0]?.requestId ?? null,
    activePendingUserInput: pendingUserInputs[0]?.requestId ?? null,
    threadError: error ?? thread?.session?.lastError,
  });
  const preparing =
    !thread ||
    (thread.messages.length === 0 &&
      (thread.session == null || thread.session.status === "starting"));
  const failedFork = thread?.session?.status === "error" && thread.messages.length === 0;
  const unavailable = environment?.connection.phase !== "connected";
  const isWorking = phase === "running" || dispatch.isSendBusy;
  const messages = useMessagesWithImages(threadRef.environmentId, thread?.messages);
  const timelineEntries = useMemo(
    () =>
      deriveTimelineEntries(
        messages,
        thread?.proposedPlans ?? [],
        deriveWorkLogEntries(thread?.activities ?? []),
        deriveTurnPlans(thread?.activities ?? []),
      ),
    [messages, thread?.proposedPlans, thread?.activities],
  );
  const diffs = useMemo(
    () =>
      new Map<MessageId, TurnDiffSummary>(
        (thread?.checkpoints ?? []).flatMap((checkpoint) =>
          checkpoint.assistantMessageId ? [[checkpoint.assistantMessageId, checkpoint]] : [],
        ),
      ),
    [thread?.checkpoints],
  );
  const focus = () => composerRef.current?.focusAtEnd();
  useEffect(() => {
    if (!preparing && !focusedOnOpen.current) {
      focusedOnOpen.current = true;
      composerRef.current?.focusAtEnd();
    }
  }, [preparing]);

  const send = async (event?: { preventDefault: () => void }) => {
    event?.preventDefault();
    if (pending.activePendingProgress) {
      pending.onAdvanceActivePendingUserInput();
      return;
    }
    const context = composerRef.current?.getSendContext();
    if (
      !thread ||
      !context?.providerAvailable ||
      preparing ||
      failedFork ||
      unavailable ||
      sending.current ||
      dispatch.isSendBusy
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
    if (hasOnlyText && /^\/side\s*$/i.test(context.prompt.trim())) {
      setError("Keep this side chat as a thread before opening another side chat.");
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
    sending.current = true;
    setError(null);
    dispatch.beginLocalDispatch();
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
      const text = serializeComposerPrompt({
        ...context,
        terminalContexts: snapshot.sendableTerminalContexts,
      });
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
        modelSelection: context.selectedModelSelection,
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
          },
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
        setLiveFollow(true);
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
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ) => {
    setRespondingRequestIds((ids) => [...ids, requestId]);
    const result = await respondApproval({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, requestId, decision },
    });
    setRespondingRequestIds((ids) => ids.filter((id) => id !== requestId));
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result))
      setError(String(squashAtomCommandFailure(result)));
    return result;
  };
  const runAction = async (action: () => Promise<void>) => {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setActionBusy(false);
    }
  };
  const discard = async () => {
    const api = readLocalApi();
    if (
      !api ||
      !(await api.dialogs.confirm(
        "Discard this side chat? Running work will stop. File changes remain in the checkout.",
      ))
    )
      return;
    await props.onDiscard();
    clearPendingUserInputDrafts(threadRef);
    useComposerDraftStore.getState().clearComposerContent(threadRef);
  };
  const cwd = thread?.worktreePath ?? project?.workspaceRoot;
  const shownError = error ?? thread?.session?.lastError;
  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      data-side-chat="true"
      onKeyDownCapture={(event) => {
        if (
          resolveShortcutCommand(event.nativeEvent, keybindings, {
            context: {
              terminalFocus: false,
              terminalOpen: false,
              modelPickerOpen: composerRef.current?.isModelPickerOpen() ?? false,
            },
          }) === "modelPicker.toggle"
        ) {
          event.preventDefault();
          event.stopPropagation();
          composerRef.current?.toggleModelPicker();
        }
      }}
    >
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border/50 px-3">
        <span
          className="text-xs text-muted-foreground"
          title="This conversation is temporary until kept. It expires when the backend restarts."
        >
          Temporary
        </span>
        <div className="flex items-center gap-1">
          <Button
            size="xs"
            variant="ghost"
            disabled={preparing || thread?.session?.status === "error" || actionBusy}
            onClick={() => void runAction(props.onKeep)}
          >
            Keep as thread
          </Button>
          <Menu>
            <MenuTrigger
              aria-label="Side chat actions"
              className="rounded p-1 text-muted-foreground hover:bg-accent"
              disabled={actionBusy}
            >
              <MoreHorizontal className="size-4" />
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem onClick={() => void runAction(discard)}>Discard side chat</MenuItem>
            </MenuPopup>
          </Menu>
        </div>
      </div>
      {shownError ? (
        <div role="alert" className="border-b border-border/50 px-3 py-2 text-xs text-destructive">
          {shownError}
        </div>
      ) : null}
      {preparing ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Opening side chat…
        </div>
      ) : (
        <>
          {timelineEntries.length === 0 ? (
            <div className="flex min-h-24 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
              <p className="text-sm">Explore a side question</p>
              <p className="max-w-xs text-xs text-muted-foreground">
                Starts with the parent’s context from when you opened it.
              </p>
            </div>
          ) : (
            <MessagesTimeline
              isWorking={isWorking}
              activeTurnInProgress={
                isWorking ||
                !isLatestTurnSettled(thread?.latestTurn ?? null, thread?.session ?? null)
              }
              activeTurnStartedAt={deriveActiveWorkStartedAt(
                thread?.latestTurn ?? null,
                thread?.session ?? null,
                dispatch.localDispatchStartedAt,
              )}
              listRef={listRef}
              timelineEntries={timelineEntries}
              latestTurn={thread?.latestTurn ?? null}
              runningTurnId={thread?.session?.activeTurnId ?? null}
              turnDiffSummaryByAssistantMessageId={diffs}
              routeThreadKey={scopedThreadKey(threadRef)}
              onOpenTurnDiff={props.onOpenTurnDiff}
              revertTurnCountByUserMessageId={NO_REVERTS}
              onRevertUserMessage={() => undefined}
              isRevertingCheckpoint={false}
              onImageExpand={props.onExpandImage}
              activeThreadEnvironmentId={threadRef.environmentId}
              markdownCwd={cwd}
              resolvedTheme={resolvedTheme}
              timestampFormat={settings.timestampFormat}
              workspaceRoot={cwd}
              anchorMessageId={null}
              onAnchorReady={() => undefined}
              contentInsetEndAdjustment={0}
              liveFollowEnabled={liveFollow}
              onIsAtEndChange={setLiveFollow}
              onManualNavigation={() => setLiveFollow(false)}
              loadEarlier={
                threadHasOlderTurns(page)
                  ? {
                      loading: page.page._tag === "Some" && page.page.value.loadingOlder,
                      onLoadEarlier: () =>
                        requestOlderThreadTurns(threadRef.environmentId, threadRef.threadId),
                    }
                  : null
              }
            />
          )}
          <div className="shrink-0 px-2 pb-2 pt-1">
            <div className="chat-composer-glass-shell">
              <div className="chat-composer-glass-host relative z-10 rounded-[22px]">
                <ChatComposer
                  composerDraftTarget={threadRef}
                  environmentId={threadRef.environmentId}
                  routeKind="server"
                  routeThreadRef={threadRef}
                  draftId={null}
                  activeThreadId={threadRef.threadId}
                  activeThreadEnvironmentId={threadRef.environmentId}
                  activeThread={thread ?? undefined}
                  isServerThread
                  isLocalDraftThread={false}
                  forceExpandedOnMobile
                  projectSelectionRequired={false}
                  phase={phase}
                  isConnecting={false}
                  isSendBusy={dispatch.isSendBusy}
                  sendDisabledReason={
                    failedFork ? "The side chat could not open. Discard it and try again." : null
                  }
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
                  activePendingIsResponding={inputResponding}
                  respondingRequestIds={respondingRequestIds}
                  showPlanFollowUpPrompt={false}
                  activeProposedPlan={null}
                  runtimeMode={runtimeMode}
                  interactionMode={interactionMode}
                  lockedProvider={
                    thread?.session?.providerName
                      ? ProviderDriverKind.make(thread.session.providerName)
                      : null
                  }
                  providerStatuses={[...providers]}
                  activeProjectDefaultModelSelection={project?.defaultModelSelection}
                  activeThreadModelSelection={thread?.modelSelection}
                  activeThreadActivities={thread?.activities}
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
                  onImplementPlanInNewThread={() => undefined}
                  onRespondToApproval={onRespondToApproval}
                  onProviderModelSelect={(instanceId, model) => {
                    if (
                      thread &&
                      !getStartedThreadModelChangeBlockReason({
                        providers,
                        hasStartedSession: true,
                        currentModelSelection: thread.modelSelection,
                        currentProviderInstanceId: thread.session?.providerInstanceId ?? null,
                        nextModelSelection: { instanceId, model },
                      })
                    )
                      useComposerDraftStore
                        .getState()
                        .setModelSelection(threadRef, { instanceId, model });
                  }}
                  getModelDisabledReason={(instanceId, model) =>
                    thread
                      ? (getStartedThreadModelChangeBlockReason({
                          providers,
                          hasStartedSession: true,
                          currentModelSelection: thread.modelSelection,
                          currentProviderInstanceId: thread.session?.providerInstanceId ?? null,
                          nextModelSelection: { instanceId, model },
                        })?.description ?? null)
                      : null
                  }
                  toggleInteractionMode={() =>
                    useComposerDraftStore
                      .getState()
                      .setInteractionMode(
                        threadRef,
                        interactionMode === "plan" ? "default" : "plan",
                      )
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
        </>
      )}
    </section>
  );
}
