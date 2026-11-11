import type {
  PullRequestAction,
  PullRequestDetailView,
  PullRequestUpdateMethod,
  PullRequestMergeMethod,
} from "@t3tools/contracts";
import { MoreHorizontalIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "../ui/button";
import {
  Menu,
  MenuTrigger,
  MenuPopup,
  MenuItem,
  MenuSeparator,
  MenuRadioGroup,
  MenuRadioItem,
} from "../ui/menu";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/dialog";
import {
  allowedPullRequestMergeMethods,
  allowsSinglePullRequestMerge,
  isPullRequestActionAvailable,
  PULL_REQUEST_MERGE_METHOD_LABELS,
  pullRequestMergeBlocker,
  resolvePullRequestPrimaryControl,
} from "./pullRequestDetail.logic";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { pullRequestChecksState } from "./pullRequestPresentation";

const labels: Record<PullRequestAction, string> = {
  merge: "Merge pull request",
  ready: "Mark ready for review",
  draft: "Convert to draft",
  close: "Close pull request",
  reopen: "Reopen pull request",
  "update-branch": "Update branch",
  "enable-auto-merge": "Enable auto-merge",
  "disable-auto-merge": "Disable auto-merge",
  revert: "Revert pull request",
  "approve-workflows": "Approve workflows",
};

export function PullRequestManagement({
  detail,
  pending,
  hasStack,
  stackPending,
  stackError,
  perform,
  onResolveConflicts,
  onWork,
  onAsk,
  onExplain,
  onFixFindings,
  fixFindingsLabel,
  mergeMethod,
  onMergeMethodChange,
}: {
  detail: PullRequestDetailView;
  pending: boolean;
  hasStack: boolean;
  stackPending: boolean;
  stackError: string | null;
  mergeMethod: PullRequestMergeMethod;
  onMergeMethodChange: (method: PullRequestMergeMethod) => void;
  perform: (action: PullRequestAction, updateMethod?: PullRequestUpdateMethod) => Promise<void>;
  onResolveConflicts: () => void;
  onWork: () => void;
  onAsk: () => void;
  onExplain: () => void;
  onFixFindings: () => void;
  fixFindingsLabel: string;
}) {
  const [confirmation, setConfirmation] = useState<{
    action: PullRequestAction;
    updateMethod?: PullRequestUpdateMethod;
  } | null>(null);
  const methods = allowedPullRequestMergeMethods(detail);
  const can = (action: PullRequestAction) =>
    detail.capabilities.actions.includes(action) &&
    detail.viewerPermissions.actions.includes(action);
  const singleMerge = allowsSinglePullRequestMerge({
    supportsStackActions: detail.capabilities.stackActions === true,
    hasStack,
    stackPending,
    stackError,
  });
  const checksState = pullRequestChecksState(detail.checks);
  const mergeBlocker = pullRequestMergeBlocker({ ...detail, checksState });
  const primary = resolvePullRequestPrimaryControl({
    ...detail,
    autoMergeEnabled: detail.autoMergeEnabled,
    checksState,
    hasMergeMethod: methods.length > 0,
    canMerge: can("merge") && singleMerge,
    canMarkReady: can("ready"),
    canEnableAutoMerge: can("enable-auto-merge") && singleMerge,
  });
  const primaryAction =
    primary === "merge" || primary === "ready" || primary === "enable-auto-merge" ? primary : null;
  const available = detail.capabilities.actions.filter(
    (action) =>
      can(action) &&
      action !== primaryAction &&
      isPullRequestActionAvailable(action, detail, singleMerge, methods.length > 0),
  );
  const confirmationAllowed =
    confirmation !== null &&
    can(confirmation.action) &&
    isPullRequestActionAvailable(confirmation.action, detail, singleMerge, methods.length > 0);
  const showMergeMethods =
    methods.length > 1 &&
    can("merge") &&
    !detail.isDraft &&
    detail.state === "open" &&
    detail.mergeability !== "conflicting";
  return (
    <>
      {primary === "resolve" ? (
        <Button size="xs" variant="outline" onClick={onResolveConflicts}>
          Resolve conflicts
        </Button>
      ) : primaryAction ? (
        <Button
          size="xs"
          disabled={pending}
          onClick={() => setConfirmation({ action: primaryAction })}
        >
          {primaryAction === "merge"
            ? PULL_REQUEST_MERGE_METHOD_LABELS[mergeMethod]
            : labels[primaryAction]}
        </Button>
      ) : primary === "merge-not-ready" ? (
        <Tooltip>
          {/* A disabled button takes no pointer events, so the wrapper carries the hover. */}
          <TooltipTrigger
            render={<span className="inline-flex" tabIndex={0} />}
            aria-label={`${PULL_REQUEST_MERGE_METHOD_LABELS[mergeMethod]} unavailable: ${mergeBlocker ?? "not ready to merge"}`}
          >
            <Button size="xs" disabled aria-hidden>
              {PULL_REQUEST_MERGE_METHOD_LABELS[mergeMethod]}
            </Button>
          </TooltipTrigger>
          <TooltipPopup>{mergeBlocker ?? "Not ready to merge"}</TooltipPopup>
        </Tooltip>
      ) : primary === "auto-merge-armed" ? (
        <span className="text-xs text-muted-foreground">Auto-merge enabled</span>
      ) : null}
      <Menu>
        <MenuTrigger
          render={<Button size="icon-xs" variant="ghost" />}
          aria-label="Pull request actions"
        >
          <MoreHorizontalIcon />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuItem onClick={onWork}>Work on PR</MenuItem>
          <MenuItem onClick={onAsk}>Ask about PR</MenuItem>
          <MenuItem onClick={onExplain}>Explain PR</MenuItem>
          <MenuItem onClick={onFixFindings}>{fixFindingsLabel}</MenuItem>
          {showMergeMethods && (
            <>
              <MenuSeparator />
              <MenuRadioGroup
                value={mergeMethod}
                onValueChange={(value) => {
                  const method = methods.find((item) => item === value);
                  if (method) onMergeMethodChange(method);
                }}
              >
                {methods.map((method) => (
                  <MenuRadioItem key={method} value={method}>
                    {PULL_REQUEST_MERGE_METHOD_LABELS[method]}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </>
          )}
          {available.length > 0 && <MenuSeparator />}
          {available.map((action) => (
            <MenuItem key={action} disabled={pending} onClick={() => setConfirmation({ action })}>
              {action === "merge" && mergeBlocker !== null
                ? "Merge without waiting"
                : labels[action]}
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>
      <Dialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null);
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>
              {confirmation ? labels[confirmation.action] : "Confirm action"}
            </DialogTitle>
            <DialogDescription>
              This updates #{detail.number} on GitHub
              {confirmation?.action === "merge"
                ? ` using ${PULL_REQUEST_MERGE_METHOD_LABELS[mergeMethod].toLowerCase()}`
                : ""}
              .
              {confirmation?.action === "merge" && mergeBlocker !== null
                ? ` It is not ready yet: ${mergeBlocker.toLowerCase()}.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmation(null)}>
              Cancel
            </Button>
            <Button
              disabled={pending || !confirmationAllowed}
              onClick={() => {
                if (!confirmation || !confirmationAllowed) return;
                const action = confirmation;
                setConfirmation(null);
                void perform(action.action, action.updateMethod);
              }}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
