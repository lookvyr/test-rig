import { usePullRequestRefresh } from "./usePullRequestRefresh";
import { parseChangeRequestUrl } from "@t3tools/shared/changeRequestUrl";
import {
  AuthReviewWriteScope,
  type PullRequestAction,
  type PullRequestDetailView,
  type PullRequestMergeMethod,
  type PullRequestRef,
  type PullRequestUpdateMethod,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import {
  ArrowLeftIcon,
  ExternalLinkIcon,
  Maximize2Icon,
  Minimize2Icon,
  RefreshCwIcon,
  XIcon,
  ArrowDownUpIcon,
} from "lucide-react";
import { lazy, Suspense, useState } from "react";
import * as Schema from "effect/Schema";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import { pullRequestEnvironment } from "../../state/pullRequests";
import {
  attachPullRequestDiscussion,
  usePullRequestHandoff,
} from "../../hooks/usePullRequestHandoff";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { type PullRequestTab, usePullRequestReviewStore } from "./reviewStore";

import { PullRequestActivityUnavailableState } from "../pullRequest/PullRequestActivityUnavailableState";
import { PullRequestSummaryTab } from "../pullRequest/PullRequestSummaryTab";
import { PullRequestTimelineTab } from "../pullRequest/PullRequestTimelineTab";
import { PullRequestComposer } from "../pullRequest/PullRequestComposer";
import { PullRequestTitleEditor } from "../pullRequest/PullRequestTitleEditor";
import {
  PullRequestDetailHeaderBody,
  PullRequestDetailTabBar,
} from "../pullRequest/PullRequestDetailLayout";
import { PullRequestCompletionContext } from "../pullRequest/PullRequestMarkdownTextarea";
import { PullRequestCopyableCode } from "../pullRequest/PullRequestCopyableCode";
import { PullRequestBaseBranch } from "../pullRequest/PullRequestBaseBranch";
import { PullRequestStackMenu } from "../pullRequest/PullRequestStackMenu";
import { PullRequestManagement } from "../pullRequest/PullRequestManagement";
import { PullRequestChecksPopover } from "../pullRequest/PullRequestChecksPopover";
import {
  PullRequestActorLabel,
  PullRequestDiffStat,
  PullRequestStateGlyph,
  pullRequestChecksState,
} from "../pullRequest/pullRequestPresentation";
import {
  allowedPullRequestMergeMethods,
  buildAddSelectionToAgentHandoff,
  buildAskAboutPullRequestHandoff,
  buildExplainPullRequestHandoff,
  buildFixFindingHandoff,
  buildFixFindingsHandoff,
  buildResolveConflictsPrompt,
  pullRequestHandoffLabels,
  readableFailure,
  resolveBaseFreshness,
  type PullRequestFinding,
  type PullRequestChatSubject,
} from "../pullRequest/pullRequestDetail.logic";
import { sourceControlClients } from "../pullRequest/sourceControlClient";
import { RelativeTime } from "../RelativeTime";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import type { PullRequestSelection } from "./workspaceStore";

const mergeMethodSchema = Schema.Literals(["merge", "squash", "rebase"]);
const timelineOrderSchema = Schema.Literals(["oldest", "newest"]);
const PullRequestCodeTab = lazy(() => import("../pullRequest/PullRequestCodeTab"));
const tabs = [
  { value: "summary", label: "Summary" },
  { value: "timeline", label: "Timeline" },
  { value: "code", label: "Code" },
] as const;
const noActivity = {
  comments: [],
  reviewThreads: [],
  commits: [],
  commentCount: 0,
  commentsTruncated: false,
};
const ignoreScroller = () => {};
interface PullRequestInspectorProps {
  selection: PullRequestSelection;
  threadRef?: ScopedThreadRef | undefined;
  onClose: () => void;
  onBack?: () => void;
  onSelectStackLayer: (url: string, number: number) => void;
  onActionCompleted?: () => void;
  refreshVersion?: number;
  onRefresh?: () => void;
  expanded?: boolean;
  onToggleExpanded?: () => void;
}

export function PullRequestInspector(props: PullRequestInspectorProps) {
  return (
    <Inspector
      key={`${props.selection.environmentId}:${props.selection.projectId}:${props.selection.reference}`}
      {...props}
    />
  );
}

function Inspector({
  selection,
  threadRef,
  onClose,
  onBack,
  onSelectStackLayer,
  onActionCompleted = () => {},
  refreshVersion = 0,
  onRefresh,
  expanded,
  onToggleExpanded,
}: PullRequestInspectorProps) {
  const url = selection.reference;
  const key = parseChangeRequestUrl(url);
  const reference: PullRequestRef | null = key
    ? {
        projectId: selection.projectId,
        host: key.host,
        repository: key.repository,
        number: key.number,
      }
    : null;
  const environmentId = selection.environmentId;
  const prKey = `${environmentId}:${url}`;
  const tab = usePullRequestReviewStore((state) => state.tabByPr[prKey] ?? "summary");
  // Retain visited panes until the PR changes so Code keeps its scroll, folds, and queries.
  const [mountedTabs, setMountedTabs] = useState(() => new Set<PullRequestTab>([tab]));
  if (!mountedTabs.has(tab)) setMountedTabs(new Set([...mountedTabs, tab]));
  const setTab = usePullRequestReviewStore((state) => state.setTab);
  const [commit, setCommit] = useState<string | null>(null);
  const [activityRefresh, setActivityRefresh] = useState(0);
  const [actionPending, setActionPending] = useState(false);
  const [mergeMethod, setMergeMethod] = useLocalStorage<PullRequestMergeMethod, string>(
    "test-rig:pr-merge-method",
    "squash",
    mergeMethodSchema,
  );
  const [timelineOrder, setTimelineOrder] = useLocalStorage(
    "test-rig:pr-timeline-order",
    "oldest",
    timelineOrderSchema,
  );
  const canWrite = useEnvironmentScope(environmentId, AuthReviewWriteScope);
  const runAction = useAtomCommand(pullRequestEnvironment.runAction, { reportFailure: false });
  const comment = useAtomCommand(pullRequestEnvironment.comment, { reportFailure: false });
  const handoff = usePullRequestHandoff({ ...selection, reference: url }, threadRef);
  const handoffLabels = pullRequestHandoffLabels(threadRef !== undefined);
  const query = useEnvironmentQuery(
    reference ? pullRequestEnvironment.detail({ environmentId, input: reference }) : null,
  );
  const activity = useEnvironmentQuery(
    reference ? pullRequestEnvironment.activity({ environmentId, input: reference }) : null,
  );

  const stack = useEnvironmentQuery(
    reference && query.data?.capabilities.stacks
      ? pullRequestEnvironment.stack({ environmentId, input: reference })
      : null,
  );
  const detail: PullRequestDetailView | null = query.data
    ? {
        ...query.data,
        ...noActivity,
        ...activity.data,
        author: activity.data?.author ?? query.data.author,
        reviewers: activity.data?.reviewers ?? query.data.reviewers,
        capabilities: canWrite
          ? query.data.capabilities
          : {
              ...query.data.capabilities,
              reactions: false,
              edit: { changeRequest: false, comment: false },
            },
        viewerPermissions: canWrite
          ? query.data.viewerPermissions
          : {
              ...query.data.viewerPermissions,
              actions: [],
              verdicts: [],
              comment: false,
              resolve: false,
              requestReviewers: false,
              labels: false,
              updateMethods: [],
              stackRebase: false,
            },
      }
    : null;
  const methods = allowedPullRequestMergeMethods(detail);
  const selectedMergeMethod = methods.includes(mergeMethod)
    ? mergeMethod
    : (methods[0] ?? "squash");
  const { refresh, refreshing } = usePullRequestRefresh({
    environmentId,
    reference,
    refreshVersion,
    revision: query.data ? JSON.stringify([query.data.headSha, query.data.updatedAt]) : null,
    detailPending: query.isPending,
    refreshDetail: query.refresh,
    refreshRelated: () => {
      activity.refresh();
      stack.refresh();
      setActivityRefresh((value) => value + 1);
    },
  });
  const perform = async (action: PullRequestAction, updateMethod?: PullRequestUpdateMethod) => {
    if (!reference || !detail || actionPending) return;
    setActionPending(true);
    try {
      const result = await runAction({
        environmentId,
        input: {
          ...reference,
          action,
          ...(action === "merge" || action === "enable-auto-merge"
            ? { mergeMethod: selectedMergeMethod }
            : {}),
          ...(updateMethod ? { updateMethod } : {}),
        },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      onActionCompleted?.();
      if (action === "revert")
        toastManager.add({ type: "success", title: "Revert pull request opened" });
    } catch (failure) {
      toastManager.add({
        type: "error",
        title: "Pull request action failed",
        description: readableFailure(failure, "GitHub refused the action."),
      });
      throw failure;
    } finally {
      setActionPending(false);
    }
  };
  const act = async (action: PullRequestAction, updateMethod?: PullRequestUpdateMethod) => {
    try {
      await perform(action, updateMethod);
    } catch {
      /* The action already reports its error. */
    }
  };
  const addToChat =
    threadRef && detail
      ? (subject: PullRequestChatSubject) => {
          if (attachPullRequestDiscussion(threadRef, detail, subject)) {
            toastManager.add({ type: "success", title: "Added to the composer" });
          }
        }
      : undefined;
  const fixFinding = (finding: PullRequestFinding) => {
    if (detail) void handoff.startReview(buildFixFindingHandoff({ ...detail, finding }));
  };
  const checksState = detail ? pullRequestChecksState(detail.checks) : null;
  const busy = refreshing || query.isPending;
  return (
    <PullRequestCompletionContext
      value={reference && canWrite ? { environmentId, reference } : null}
    >
      <section className="flex min-h-0 flex-1 flex-col" aria-label="Pull request inspector">
        <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5">
          {onBack && (
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Back to linked pull requests"
              onClick={onBack}
            >
              <ArrowLeftIcon />
            </Button>
          )}
          {detail && <PullRequestStateGlyph state={detail.state} isDraft={detail.isDraft} />}
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-w-0 items-center gap-1 truncate text-xs font-medium"
          >
            {detail ? `${detail.repository} #${detail.number}` : "Pull request"}
            <ExternalLinkIcon className="size-3" />
          </a>
          <div className="ml-auto flex items-center gap-1">
            {detail && reference && (
              <>
                {!stack.data && stack.error && (
                  <Button size="xs" variant="ghost" title={stack.error} onClick={stack.refresh}>
                    Retry stack lookup
                  </Button>
                )}
                {stack.data && (
                  <PullRequestStackMenu
                    hostLabel="GitHub"
                    terminology={sourceControlClients.get(detail.provider).changeRequest}
                    stack={stack.data}
                    reference={reference}
                    environmentId={environmentId}
                    stale={!!stack.error || stack.isPending}
                    notice={stack.error}
                    onRetry={stack.error ? stack.refresh : undefined}
                    canMerge={
                      canWrite &&
                      methods.length > 0 &&
                      detail.capabilities.stackActions === true &&
                      detail.viewerPermissions.actions.includes("merge")
                    }
                    canRebase={
                      canWrite &&
                      detail.capabilities.stackActions === true &&
                      detail.viewerPermissions.stackRebase === true
                    }
                    mergeMethod={selectedMergeMethod}
                    onActed={(succeeded) => {
                      onActionCompleted();
                      // A failed stack operation may already have updated earlier layers.
                      if (!succeeded) void refresh();
                    }}
                    onSelect={(next) => {
                      const nextUrl = `https://${next.host ?? key?.host ?? "github.com"}/${next.repository}/pull/${next.number}`;
                      onSelectStackLayer(nextUrl, next.number);
                      setCommit(null);
                    }}
                  />
                )}
                <PullRequestManagement
                  detail={detail}
                  pending={actionPending}
                  hasStack={!!stack.data}
                  stackPending={stack.isPending}
                  stackError={stack.error}
                  perform={act}
                  mergeMethod={selectedMergeMethod}
                  onMergeMethodChange={setMergeMethod}
                  onResolveConflicts={() =>
                    void handoff.startReview({ prompt: buildResolveConflictsPrompt(detail) })
                  }
                  onWork={() => void handoff.startReview()}
                  onAsk={() =>
                    void handoff.startReview(buildAskAboutPullRequestHandoff(detail), "question")
                  }
                  onExplain={() =>
                    void handoff.startReview(buildExplainPullRequestHandoff(detail), "question")
                  }
                  fixFindingsLabel={handoffLabels.fixFindings}
                  onFixFindings={() => void handoff.startReview(buildFixFindingsHandoff(detail))}
                />
              </>
            )}
            <Button
              aria-label="Refresh pull request details"
              aria-busy={busy}
              variant="ghost"
              size="icon-xs"
              disabled={busy}
              onClick={() => {
                if (onRefresh) onRefresh();
                else void refresh();
              }}
            >
              <RefreshCwIcon className={busy ? "motion-safe:animate-spin" : undefined} />
            </Button>
            {onToggleExpanded && (
              <Button
                aria-label={expanded ? "Restore split view" : "Expand review"}
                variant="ghost"
                size="icon-xs"
                onClick={onToggleExpanded}
              >
                {expanded ? <Minimize2Icon /> : <Maximize2Icon />}
              </Button>
            )}
            <Button
              aria-label="Close review panel"
              variant="ghost"
              size="icon-xs"
              onClick={onClose}
            >
              <XIcon />
            </Button>
          </div>
        </div>
        {detail && reference && (
          <>
            <div className="shrink-0 border-b">
              <PullRequestDetailHeaderBody
                title={
                  <PullRequestTitleEditor
                    environmentId={environmentId}
                    reference={reference}
                    pullRequestKey={prKey}
                    detail={detail}
                    canWriteSourceControl={canWrite}
                    onSaved={onActionCompleted}
                  />
                }
                author={
                  <PullRequestActorLabel
                    actor={detail.author}
                    profileUrl={
                      detail.author
                        ? sourceControlClients
                            .get(detail.provider)
                            .authorProfileUrl(detail.author.login, detail.url)
                        : null
                    }
                  />
                }
                checkout={
                  <PullRequestCopyableCode
                    value={sourceControlClients.get(detail.provider).checkoutCommand(detail)}
                    target="pull request checkout command"
                    copyLabel="Copy checkout command"
                    copiedLabel="Checkout command copied"
                    className="ml-auto font-mono"
                    tooltipSide="bottom"
                  />
                }
                updated={
                  <span>
                    updated <RelativeTime timestamp={detail.updatedAt} />
                  </span>
                }
                base={
                  <PullRequestBaseBranch
                    baseBranch={detail.baseBranch}
                    freshness={resolveBaseFreshness(detail)}
                    stacked={!!stack.data}
                    pending={actionPending}
                    onUpdate={(method) => void act("update-branch", method)}
                  />
                }
                head={
                  <PullRequestCopyableCode
                    value={detail.headBranch}
                    target="pull request branch"
                    copyLabel="Copy pull request branch"
                    copiedLabel="Branch copied"
                    className="font-mono"
                  />
                }
                files={`${detail.changedFiles.toLocaleString()} ${detail.changedFiles === 1 ? "file" : "files"}`}
                diffStat={
                  <PullRequestDiffStat additions={detail.additions} deletions={detail.deletions} />
                }
              />
              <PullRequestDetailTabBar
                tabs={tabs}
                value={tab}
                onValueChange={(value) => setTab(prKey, value)}
                onTabIntent={(value) => {
                  if (value === "code") void import("../pullRequest/PullRequestCodeTab");
                }}
              >
                {tab === "timeline" && (
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Timeline order: ${timelineOrder} first`}
                    onClick={() =>
                      setTimelineOrder(timelineOrder === "oldest" ? "newest" : "oldest")
                    }
                  >
                    <ArrowDownUpIcon />
                  </Button>
                )}
                <div className="ml-auto">
                  {checksState && (
                    <PullRequestChecksPopover
                      checksState={checksState}
                      checks={detail.checks}
                      environmentId={environmentId}
                      reference={reference}
                      threadRef={threadRef ?? null}
                    />
                  )}
                </div>
              </PullRequestDetailTabBar>
            </div>
            <div className="relative flex min-h-0 flex-1 flex-col">
              {query.error && (
                <p role="alert" className="p-2 text-xs text-destructive">
                  {query.error} Showing the last loaded snapshot.
                </p>
              )}
              <div className="relative min-h-0 flex-1">
                {mountedTabs.has("summary") && (
                  <div
                    className={
                      tab === "summary" ? "absolute inset-0" : "invisible absolute inset-0"
                    }
                    inert={tab !== "summary"}
                  >
                    <PullRequestSummaryTab
                      key={prKey}
                      scrollerRef={ignoreScroller}
                      environmentId={environmentId}
                      threadRef={threadRef ?? null}
                      reference={reference}
                      detail={detail}
                      activityPending={activity.isPending}
                      activityError={activity.error}
                      onAddToChat={addToChat}
                      fixCheckLabel={handoffLabels.fixCheck}
                      fixFindingLabel={handoffLabels.fixFinding}
                      onFixFinding={fixFinding}
                      onRefreshChecks={() => void refresh()}
                      onRetryActivity={activity.refresh}
                      onRefresh={onActionCompleted}
                    />
                  </div>
                )}
                {mountedTabs.has("timeline") && (
                  <div
                    className={
                      tab === "timeline" ? "absolute inset-0" : "invisible absolute inset-0"
                    }
                    inert={tab !== "timeline"}
                  >
                    {activity.error && !activity.data ? (
                      <PullRequestActivityUnavailableState
                        error={activity.error}
                        term="pull request"
                        onRetry={() => void refresh()}
                      />
                    ) : activity.isPending && !activity.data ? (
                      <p role="status" className="p-4 text-xs">
                        Loading activity…
                      </p>
                    ) : (
                      <PullRequestTimelineTab
                        key={prKey}
                        scrollerRef={ignoreScroller}
                        detail={detail}
                        environmentId={environmentId}
                        reference={reference}
                        threadRef={threadRef ?? null}
                        order={timelineOrder}
                        onAddToChat={addToChat}
                        onOpenCommit={(oid) => {
                          setCommit(oid);
                          setTab(prKey, "code");
                        }}
                        onRefresh={onActionCompleted}
                      />
                    )}
                  </div>
                )}
                {mountedTabs.has("code") && (
                  <div
                    className={tab === "code" ? "absolute inset-0" : "invisible absolute inset-0"}
                    inert={tab !== "code"}
                  >
                    <Suspense fallback={<p className="p-4 text-xs">Loading diff viewer…</p>}>
                      <PullRequestCodeTab
                        key={prKey}
                        scrollerRef={ignoreScroller}
                        environmentId={environmentId}
                        reference={reference}
                        detail={detail}
                        selectedCommitOid={commit}
                        onSelectedCommitChange={setCommit}
                        fixFindingLabel={handoffLabels.fixFinding}
                        onFixFinding={fixFinding}
                        onAddToChat={addToChat}
                        onAddToAgentSelection={(input) =>
                          void handoff.startReview(
                            buildAddSelectionToAgentHandoff({ ...detail, ...input }),
                            "question",
                          )
                        }
                        onRefresh={onActionCompleted}
                        backgroundRefreshToken={activityRefresh}
                      />
                    </Suspense>
                  </div>
                )}
              </div>
              <div className="pointer-events-none absolute bottom-4 right-4 z-20 [&>*]:pointer-events-auto">
                <PullRequestComposer
                  key={prKey}
                  environmentId={environmentId}
                  reference={reference}
                  detail={detail}
                  actionPending={actionPending}
                  onCommented={onActionCompleted}
                  onReviewSubmitted={onActionCompleted}
                  onCommentAction={async (body, action) => {
                    let posted = false;
                    if (body.trim()) {
                      const result = await comment({
                        environmentId,
                        input: { ...reference, body },
                      });
                      if (result._tag !== "Success") {
                        toastManager.add({ type: "error", title: "Could not post the comment" });
                        return { commentPosted: false };
                      }
                      posted = true;
                    }
                    try {
                      await perform(action);
                    } catch {
                      return { commentPosted: posted };
                    }
                    return { commentPosted: posted };
                  }}
                />
              </div>
            </div>
          </>
        )}
        {!detail && (
          <p role={query.error ? "alert" : "status"} className="p-6 text-sm text-muted-foreground">
            {query.error ?? "Loading pull request…"}
          </p>
        )}
        {handoff.error && (
          <p role="alert" className="p-3 text-xs text-destructive">
            {handoff.error}
          </p>
        )}
      </section>
    </PullRequestCompletionContext>
  );
}
