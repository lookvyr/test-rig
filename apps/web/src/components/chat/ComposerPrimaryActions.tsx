import { memo, type PointerEventHandler } from "react";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  CornerUpRightIcon,
  Minimize2Icon,
  PlayIcon,
} from "lucide-react";
import { formatContextWindowTokens } from "~/lib/contextWindow";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface PendingActionState {
  questionIndex: number;
  isLastQuestion: boolean;
  canAdvance: boolean;
  isResponding: boolean;
  isComplete: boolean;
  canRespond?: boolean;
}

interface ComposerPrimaryActionsProps {
  compact: boolean;
  pendingAction: PendingActionState | null;
  isRunning: boolean;
  /** Sending while a compaction runs stops it and sends the message next. */
  sendSkipsCompaction?: boolean;
  canInterrupt?: boolean;
  showPlanFollowUpPrompt: boolean;
  promptHasText: boolean;
  isSendBusy: boolean;
  sendDisabledReason: string | null;
  isConnecting: boolean;
  isEnvironmentUnavailable: boolean;
  isPreparingWorktree: boolean;
  hasSendableContent: boolean;
  canResume?: boolean;
  onResume?: (() => void) | undefined;
  preserveComposerFocusOnPointerDown?: boolean;
  onPreviousPendingQuestion: () => void;
  onInterrupt: () => void;
  onImplementPlanInNewThread: () => void;
  /** Tokens the next send compacts first because Claude's prompt cache expired. */
  compactBeforeSendTokens?: number | null;
  keepFullHistory?: boolean;
  onToggleKeepFullHistory?: (() => void) | undefined;
}

export const formatPendingPrimaryActionLabel = (input: {
  compact: boolean;
  isLastQuestion: boolean;
  isResponding: boolean;
  questionIndex: number;
}) => {
  if (input.isResponding) {
    return "Submitting...";
  }
  if (input.compact) {
    return input.isLastQuestion ? "Submit" : "Next";
  }
  if (!input.isLastQuestion) {
    return "Next question";
  }
  return input.questionIndex > 0 ? "Submit answers" : "Submit answer";
};

const preventPointerFocus: PointerEventHandler<HTMLElement> = (event) => {
  event.preventDefault();
};

export const ComposerPrimaryActions = memo(function ComposerPrimaryActions({
  compact,
  pendingAction,
  isRunning,
  sendSkipsCompaction = false,
  canInterrupt = isRunning,
  showPlanFollowUpPrompt,
  promptHasText,
  isSendBusy,
  sendDisabledReason,
  isConnecting,
  isEnvironmentUnavailable,
  isPreparingWorktree,
  hasSendableContent,
  canResume = false,
  onResume,
  preserveComposerFocusOnPointerDown = false,
  onPreviousPendingQuestion,
  onInterrupt,
  onImplementPlanInNewThread,
  compactBeforeSendTokens = null,
  keepFullHistory = false,
  onToggleKeepFullHistory,
}: ComposerPrimaryActionsProps) {
  const pointerFocusProps = preserveComposerFocusOnPointerDown
    ? { onPointerDown: preventPointerFocus }
    : undefined;
  const isSendDisabled = sendDisabledReason !== null;

  if (pendingAction) {
    return (
      <div className={cn("flex items-center justify-end", compact ? "gap-1.5" : "gap-2")}>
        {canInterrupt ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-full"
            {...pointerFocusProps}
            onClick={onInterrupt}
            disabled={isEnvironmentUnavailable || pendingAction.isResponding}
            aria-label="Stop generation"
          >
            Stop
          </Button>
        ) : null}
        {pendingAction.questionIndex > 0 ? (
          compact ? (
            <Button
              size="icon-sm"
              variant="outline"
              className="rounded-full"
              {...pointerFocusProps}
              onClick={onPreviousPendingQuestion}
              disabled={pendingAction.isResponding}
              aria-label="Previous question"
            >
              <ChevronLeftIcon className="size-3.5" />
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              {...pointerFocusProps}
              onClick={onPreviousPendingQuestion}
              disabled={pendingAction.isResponding}
            >
              Previous
            </Button>
          )
        ) : null}
        <Button
          type="submit"
          size="sm"
          className={cn(
            "rounded-full bg-message-action text-message-action-foreground hover:bg-message-action-hover",
            compact ? "px-3" : "px-4",
          )}
          {...pointerFocusProps}
          disabled={
            isEnvironmentUnavailable ||
            pendingAction.isResponding ||
            pendingAction.canRespond === false ||
            (pendingAction.isLastQuestion ? !pendingAction.isComplete : !pendingAction.canAdvance)
          }
        >
          {formatPendingPrimaryActionLabel({
            compact,
            isLastQuestion: pendingAction.isLastQuestion,
            isResponding: pendingAction.isResponding,
            questionIndex: pendingAction.questionIndex,
          })}
        </Button>
      </div>
    );
  }

  const stopButton = canInterrupt ? (
    <button
      type="button"
      className="flex size-8 cursor-pointer items-center justify-center rounded-full bg-destructive/90 text-white shadow-xs shadow-destructive/24 inset-shadow-[0_1px_--theme(--color-white/16%)] transition-all duration-150 hover:bg-destructive hover:scale-105 active:inset-shadow-[0_1px_--theme(--color-black/8%)] active:shadow-none sm:h-8 sm:w-8"
      {...pointerFocusProps}
      onClick={onInterrupt}
      aria-label="Stop generation"
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
        <rect x="2" y="2" width="8" height="8" rx="1.5" />
      </svg>
    </button>
  ) : null;

  if (canInterrupt && !hasSendableContent) return stopButton;

  if (!isRunning && showPlanFollowUpPrompt && (promptHasText || !canResume)) {
    if (promptHasText) {
      return (
        <Button
          type="submit"
          size="sm"
          className={cn(
            "rounded-full bg-message-action text-message-action-foreground hover:bg-message-action-hover",
            compact ? "h-9 px-3 sm:h-8" : "h-9 px-4 sm:h-8",
          )}
          {...pointerFocusProps}
          disabled={isSendBusy || isSendDisabled || isConnecting || isEnvironmentUnavailable}
        >
          {isConnecting || isSendBusy ? "Sending..." : "Refine"}
        </Button>
      );
    }

    return (
      <div data-chat-composer-implement-actions="true" className="flex items-center justify-end">
        <Button
          type="submit"
          size="sm"
          className="h-9 rounded-l-full rounded-r-none bg-message-action px-4 text-message-action-foreground hover:bg-message-action-hover sm:h-8"
          {...pointerFocusProps}
          disabled={isSendBusy || isSendDisabled || isConnecting || isEnvironmentUnavailable}
        >
          {isConnecting || isSendBusy ? "Sending..." : "Implement"}
        </Button>
        <Menu>
          <MenuTrigger
            render={
              <Button
                size="sm"
                variant="default"
                className="h-9 rounded-l-none rounded-r-full border-l-message-action-foreground/20 bg-message-action px-2 text-message-action-foreground hover:bg-message-action-hover sm:h-8"
                aria-label="Implementation actions"
                {...pointerFocusProps}
                disabled={isSendBusy || isSendDisabled || isConnecting || isEnvironmentUnavailable}
              />
            }
          >
            <ChevronDownIcon className="size-3.5" />
          </MenuTrigger>
          <MenuPopup align="end" side="top">
            <MenuItem
              disabled={isSendBusy || isSendDisabled || isConnecting || isEnvironmentUnavailable}
              onClick={() => void onImplementPlanInNewThread()}
            >
              Implement in a new thread
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
    );
  }

  const showResume = canResume && !hasSendableContent;
  const compactTokens =
    compactBeforeSendTokens !== null && !showResume && !isRunning
      ? formatContextWindowTokens(compactBeforeSendTokens)
      : null;
  const compactsBeforeSend = compactTokens !== null && !keepFullHistory;
  const submitLabel = showResume
    ? "Resume thread"
    : compactsBeforeSend
      ? "Compact and send"
      : isRunning && sendSkipsCompaction
        ? "Skip compaction and send"
        : isRunning
          ? "Steer message"
          : "Send message";

  return (
    <div
      data-chat-composer-compact-send={compactTokens !== null ? "true" : undefined}
      className="flex items-center gap-2"
    >
      {compactTokens !== null ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className="flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 font-medium text-foreground/80 text-sm tabular-nums outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-64 aria-pressed:bg-accent/60 aria-pressed:text-foreground [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:text-muted-foreground"
                {...pointerFocusProps}
                aria-pressed={!keepFullHistory}
                aria-label={`Compact ${compactTokens} tokens of history before sending`}
                disabled={isEnvironmentUnavailable}
                onClick={onToggleKeepFullHistory}
              />
            }
          >
            <Minimize2Icon aria-hidden="true" />
            <span className={compact ? "hidden" : undefined}>
              {keepFullHistory ? "Keep" : "Compact"}
            </span>
            <span className="text-muted-foreground">{compactTokens}</span>
          </TooltipTrigger>
          <TooltipPopup side="top">
            <div>
              {keepFullHistory
                ? `Next send keeps all ${compactTokens} tokens.`
                : `Next send compacts ${compactTokens} tokens first.`}
            </div>
            <div>{keepFullHistory ? "Click to compact first" : "Click to keep full history"}</div>
          </TooltipPopup>
        </Tooltip>
      ) : null}
      {stopButton}
      <button
        type={showResume ? "button" : "submit"}
        className={cn(
          "relative isolate flex h-9 w-9 items-center justify-center overflow-hidden rounded-full text-message-action-foreground shadow-xs transition-all duration-150 enabled:cursor-pointer enabled:inset-shadow-[0_1px_--theme(--color-white/16%)] hover:scale-105 active:inset-shadow-[0_1px_--theme(--color-black/8%)] active:shadow-none disabled:cursor-not-allowed disabled:opacity-30 disabled:shadow-none disabled:hover:scale-100 sm:h-8 sm:w-8",
          "bg-message-action enabled:shadow-message-action/24 hover:bg-message-action-hover",
        )}
        {...pointerFocusProps}
        onClick={showResume ? onResume : undefined}
        disabled={
          isSendBusy ||
          isSendDisabled ||
          isConnecting ||
          isEnvironmentUnavailable ||
          (!hasSendableContent && !showResume)
        }
        aria-label={
          isEnvironmentUnavailable
            ? "Environment disconnected"
            : sendDisabledReason
              ? sendDisabledReason
              : isConnecting
                ? "Connecting"
                : isPreparingWorktree
                  ? "Preparing worktree"
                  : isSendBusy
                    ? "Sending"
                    : submitLabel
        }
        title={
          sendDisabledReason ??
          (compactsBeforeSend
            ? `Summarize ${compactTokens} tokens of history, then send`
            : submitLabel)
        }
      >
        {isConnecting || isSendBusy ? (
          <Spinner className="size-3.5" aria-hidden="true" />
        ) : showResume ? (
          <PlayIcon className="size-4 fill-current" aria-hidden="true" />
        ) : isRunning ? (
          <CornerUpRightIcon className="size-4" aria-hidden="true" />
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path
              d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>
    </div>
  );
});
