import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadHoverCardPopup } from "../ThreadHoverCard";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { CollapsibleSectionHeader, SectionHeaderStatus } from "../ui/collapsible-section-header";
import { SubagentTooltipContent } from "./SubagentTooltipContent";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  type RuntimeSubagent,
  projectedSubagentsToRuntime,
} from "@t3tools/client-runtime/state/subagentRuntime";
import { formatSubagentDisplayTitle } from "@t3tools/client-runtime/state/subagent-display";
import { formatModelSlugName } from "@t3tools/shared/model";
import { getTriggerDisplayModelName } from "./providerIconUtils";
import {
  deriveThreadRelationshipGraph,
  immediateThreadRelationships,
  isParentThreadRelationship,
  threadRelationshipRowStatus,
  orderWebThreadLineageRows,
  resolveMergeBackTargetThreadId,
  type ThreadRelationshipEdge,
  type ThreadRelationshipWalkRow,
} from "@t3tools/client-runtime/state/thread-relationships";
import {
  canDetachThreadProviderSession,
  resolveLatestMergeBackRun,
} from "@t3tools/client-runtime/state/thread-workflows";
import type { EnvironmentId, OrchestrationV2ThreadShell, ThreadId } from "@t3tools/contracts";
import { groupBy } from "effect/Array";
import * as DateTime from "effect/DateTime";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowRightIcon,
  BotIcon,
  CornerLeftUpIcon,
  GitForkIcon,
  LoaderCircleIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SquareIcon,
  UnplugIcon,
} from "lucide-react";
import { useId, useMemo, useState, type ReactNode } from "react";

import { useArchivedThreadSnapshots } from "../../lib/archivedThreadsState";
import { buildThreadRouteParams } from "../../threadRoutes";
import {
  useProjects,
  useServerConfigs,
  useThreadDetail,
  useThreadRelationshipShells,
} from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { AgentElapsed } from "./AgentElapsed";
import { ThreadRelationshipIcon, threadRelationshipStatusLabel } from "./ThreadRelationshipIcon";

import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toastManager } from "../ui/toast";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { deriveAgentPanelModel } from "../agentPanelModel";
import { ThreadLineageWorkflowRow } from "./ThreadLineageWorkflowRow";
import {
  THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS,
  THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS,
  THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS,
} from "./threadDetailsPanelStyles";

// Lineage paging: a busy thread can accumulate dozens of forks and subagents,
// and the panel it lives in already scrolls. Show a workable window, keep the
// rest behind Show more, and bound what is shown so the sections below Lineage
// stay reachable.
const THREAD_LINEAGE_INITIAL_COUNT = 6;
const THREAD_LINEAGE_PAGE_COUNT = 12;

export function resolveThreadLineageWindow<Row>(
  rows: ReadonlyArray<Row>,
  visibleCount: number,
): { readonly visibleRows: ReadonlyArray<Row>; readonly hiddenCount: number } {
  const visibleRows = rows.slice(0, visibleCount);
  return { visibleRows, hiddenCount: rows.length - visibleRows.length };
}

export function ThreadLineageRowList(props: {
  readonly label?: string;
  readonly hiddenCount: number;
  readonly onShowMore: () => void;
  readonly children: ReactNode;
}) {
  return (
    <>
      {/*
        Bounded rather than free-growing so Lineage cannot push the rest of the
        thread details panel out of view. Plain overflow, not a ScrollArea
        component: this sits inside an already scrolling panel, where a
        max-height-only virtual viewport measures badly. Every row is a focusable
        button, so keyboard users reach and scroll the region through the rows
        themselves and the container needs no extra tab stop of its own.
      */}
      <ul
        aria-label={props.label ?? "Related threads"}
        className="m-0 max-h-[13.5rem] list-none overflow-y-auto overscroll-contain p-0"
      >
        {props.children}
      </ul>
      {props.hiddenCount > 0 ? (
        <button
          type="button"
          onClick={props.onShowMore}
          className={`flex h-9 w-full cursor-pointer items-center rounded-lg ${THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS} text-sm font-medium text-muted-foreground/70 hover:bg-black/[0.055] hover:text-foreground/80 dark:hover:bg-white/[0.075]`}
        >
          <PlusIcon aria-hidden className="size-4 shrink-0" />
          Show {Math.min(props.hiddenCount, THREAD_LINEAGE_PAGE_COUNT)} more
        </button>
      ) : null}
    </>
  );
}

function ThreadLineageGroup(props: {
  readonly compact?: boolean;
  readonly label: string | null;
  readonly rows: ReadonlyArray<ThreadRelationshipWalkRow>;
  readonly expanded: boolean;
  readonly children: (rows: ReadonlyArray<ThreadRelationshipWalkRow>) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(props.expanded);
  const [visibleCount, setVisibleCount] = useState(
    props.compact ? 3 : THREAD_LINEAGE_INITIAL_COUNT,
  );
  const { visibleRows, hiddenCount } = resolveThreadLineageWindow(props.rows, visibleCount);
  const failedCount = props.rows.filter(
    ({ edge }) => edge.status === "failed" || edge.status === "error",
  ).length;
  if (props.rows.length === 0) return null;
  return (
    <div>
      {props.label ? (
        <CollapsibleSectionHeader
          expanded={expanded}
          onClick={() => setExpanded(!expanded)}
          accessory={
            failedCount > 0 ? <SectionHeaderStatus>{failedCount} failed</SectionHeaderStatus> : null
          }
        >
          {props.label}
          {!expanded && ` (${props.rows.length})`}
        </CollapsibleSectionHeader>
      ) : null}
      {expanded ? (
        <ThreadLineageRowList
          label={props.compact ? "Subagents" : "Related threads"}
          hiddenCount={hiddenCount}
          onShowMore={() => setVisibleCount((count) => count + THREAD_LINEAGE_PAGE_COUNT)}
        >
          {props.children(visibleRows)}
        </ThreadLineageRowList>
      ) : null}
    </div>
  );
}

function relationshipLabel(edge: ThreadRelationshipEdge, currentThreadId: ThreadId) {
  if (edge.kind === "transfer") return "Context transfer";
  if (edge.kind === "subagent") {
    return edge.sourceThreadId === currentThreadId ? "Subagent" : "Parent agent";
  }
  return edge.sourceThreadId === currentThreadId ? "Fork" : "Parent thread";
}

function relationshipThreadTitle(input: {
  readonly title: string;
  readonly isSubagent: boolean;
}): string {
  if (!input.isSubagent) return input.title;
  return formatSubagentDisplayTitle(input.title);
}

/**
 * The row's timer and hover card follow current child work, including queued
 * follow-ups whose provider turn has not started yet.
 */
export function currentSubagent<Agent extends RuntimeSubagent>(
  agent: Agent | undefined,
  childThread: OrchestrationV2ThreadShell | null | undefined,
): Agent | undefined {
  const liveStatus =
    childThread?.activityRunStatus ?? (childThread?.status === "queued" ? "queued" : null);
  if (!agent || !childThread) return agent;
  const newerRun =
    childThread.latestRunRequestedAt &&
    DateTime.toEpochMillis(childThread.latestRunRequestedAt) >
      Date.parse(agent.completedAt ?? agent.startedAt ?? agent.updatedAt);
  if (!liveStatus && !newerRun) return agent;
  const status = liveStatus ?? childThread.status;
  const startedAt = liveStatus ? childThread.activityRunStartedAt : childThread.latestRunStartedAt;
  const completedAt = liveStatus ? null : childThread.latestRunCompletedAt;
  return {
    ...agent,
    status:
      status === "preparing" || status === "starting" || status === "queued"
        ? "pending"
        : status === "rolled_back"
          ? "interrupted"
          : status,
    startedAt: startedAt ? DateTime.formatIso(startedAt) : null,
    completedAt: completedAt ? DateTime.formatIso(completedAt) : null,
    // The task's output belongs to its recorded run, not newer child work.
    progress: null,
    result: null,
    error: null,
  };
}

export function ThreadRelationshipsPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly isDraft?: boolean;
  readonly hideWhenEmpty?: boolean;
  readonly mode?: "lineage" | "subagents";
}) {
  const compact = props.mode === "subagents";
  const headingId = useId();
  const ref = scopeThreadRef(props.environmentId, props.threadId);
  // Draft ids do not exist on the server yet; a 404 would cache them as deleted.
  const projection = useThreadDetail(props.isDraft ? null : ref)?.projection ?? null;
  const providers = useServerConfigs().get(props.environmentId)?.providers;
  // Projections retain task creation order; the last task for each child wins.
  const subagentsByThreadId = useMemo(
    () =>
      new Map(
        (projection?.subagents ?? [])
          .filter((subagent) => subagent.childThreadId !== null)
          .map((subagent) => [
            subagent.childThreadId,
            {
              ...projectedSubagentsToRuntime([subagent])[0]!,
              driver: subagent.driver,
              providerInstanceId: subagent.providerInstanceId,
              origin: subagent.origin,
            },
          ]),
      ),
    [projection?.subagents],
  );
  // Provider-native workflow runs, with their phases and agents, by coordinator id.
  const workflowGroupsById = useMemo(
    () =>
      new Map(
        deriveAgentPanelModel(
          projectedSubagentsToRuntime(projection?.subagents ?? []),
        ).workflows.map((group) => [group.workflow.id, group] as const),
      ),
    [projection?.subagents],
  );
  const threadShells = useThreadRelationshipShells(
    scopeThreadRef(props.environmentId, props.threadId),
  );
  const projects = useProjects().filter((project) => project.environmentId === props.environmentId);
  const archived = useArchivedThreadSnapshots([props.environmentId]);
  const archivedShells = archived.snapshots.find(
    (entry) => entry.environmentId === props.environmentId,
  )?.snapshot.threads;
  const graph = useMemo(() => {
    const shells: ReadonlyArray<OrchestrationV2ThreadShell> = [
      ...threadShells,
      ...(archivedShells ?? []),
    ];
    return deriveThreadRelationshipGraph({ threads: shells, projection });
  }, [archivedShells, projection, props.environmentId, threadShells]);
  const currentThread = projection?.thread ?? graph.nodes.get(props.threadId)?.thread;
  const currentProject = projects.find((project) => project.id === currentThread?.projectId);
  const navigate = useNavigate();
  const stopSession = useAtomCommand(threadEnvironment.stopSession);
  const mergeBack = useAtomCommand(threadEnvironment.mergeBack);
  const interruptTurn = useAtomCommand(threadEnvironment.interruptTurn, { reportFailure: false });
  const [stoppingThreadId, setStoppingThreadId] = useState<ThreadId | null>(null);
  const [busyAction, setBusyAction] = useState<"merge" | "detach" | null>(null);
  const latestMergeBackRun = projection == null ? null : resolveLatestMergeBackRun(projection);
  const mergeTargetThreadId = compact ? null : resolveMergeBackTargetThreadId(projection ?? null);
  const relationshipRows = useMemo(
    () =>
      orderWebThreadLineageRows({
        graph,
        rows: immediateThreadRelationships(graph, props.threadId).filter(
          ({ edge }) =>
            !compact ||
            (edge.kind === "subagent" && !isParentThreadRelationship(edge, props.threadId)),
        ),
        currentThreadId: props.threadId,
        mergeTargetThreadId,
      }),
    [compact, graph, mergeTargetThreadId, props.threadId],
  );
  const canMerge = mergeTargetThreadId !== null && latestMergeBackRun !== null;
  const canDetach = projection ? canDetachThreadProviderSession(projection) : false;

  const {
    related = [],
    active = [],
    previous = [],
  } = groupBy(relationshipRows, ({ edge }) => {
    if (edge.kind !== "subagent" || isParentThreadRelationship(edge, props.threadId))
      return "related";
    return ["completed", "failed", "error", "cancelled", "interrupted", "idle"].includes(
      edge.status ?? "",
    )
      ? "previous"
      : "active";
  });
  const groups = compact
    ? [{ id: "subagents", label: null, rows: relationshipRows, expanded: true }]
    : [
        { id: "related", label: null, rows: related, expanded: true },
        { id: "active", label: null, rows: active, expanded: true },
        { id: "previous", label: "Previous agents", rows: previous, expanded: false },
      ];
  const runningCount =
    (projection?.subagents.filter(
      (agent) => agent.childThreadId === null && agent.status === "running",
    ).length ?? 0) + active.filter(({ edge }) => edge.status === "running").length;

  if (relationshipRows.length === 0 && runningCount === 0) {
    return props.hideWhenEmpty ? null : (
      <p className="p-4 text-sm text-muted-foreground">
        {compact ? "No subagents yet." : "No related threads yet."}
      </p>
    );
  }

  const openThread = (threadId: ThreadId) => {
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(props.environmentId, threadId)),
    });
  };

  const stopSubagent = async (childThreadId: ThreadId) => {
    if (stoppingThreadId !== null) return;
    setStoppingThreadId(childThreadId);
    const result = await interruptTurn({
      environmentId: props.environmentId,
      input: { threadId: childThreadId },
    });
    setStoppingThreadId(null);
    if (result._tag === "Failure") {
      toastManager.add({ type: "error", title: "Could not stop subagent" });
    }
  };

  const merge = async () => {
    if (!latestMergeBackRun || mergeTargetThreadId === null || busyAction !== null) return;
    setBusyAction("merge");
    const result = await mergeBack({
      environmentId: props.environmentId,
      input: {
        sourceThreadId: props.threadId,
        targetThreadId: mergeTargetThreadId,
        runId: latestMergeBackRun.id,
      },
    });
    setBusyAction(null);
    if (result._tag === "Success") openThread(mergeTargetThreadId);
  };

  const parentTitle =
    mergeTargetThreadId === null
      ? null
      : (graph.nodes.get(mergeTargetThreadId)?.thread?.title ?? null);

  const detach = async () => {
    if (!canDetach || busyAction !== null) return;
    setBusyAction("detach");
    await stopSession({
      environmentId: props.environmentId,
      input: { threadId: props.threadId },
    });
    setBusyAction(null);
  };

  return (
    <ThreadDetailsSection
      headingId={headingId}
      collapsible={compact}
      title={`${compact ? "Subagents" : "Lineage"}${runningCount > 0 ? ` · ${runningCount} running` : ""}`}
      data-thread-relationships-panel
      actions={
        !compact && canDetach ? (
          <Menu>
            <MenuTrigger
              render={
                <ThreadDetailsControl
                  size="icon-xs"
                  variant="ghost"
                  part="icon"
                  aria-label="More thread actions"
                  disabled={busyAction !== null}
                />
              }
            >
              <MoreHorizontalIcon className="size-3.5" />
            </MenuTrigger>
            <MenuPopup align="end" className="min-w-60 max-w-(--available-width)">
              <MenuItem onClick={() => void detach()}>
                <UnplugIcon className="size-3.5" />
                Disconnect agent session
              </MenuItem>
            </MenuPopup>
          </Menu>
        ) : null
      }
    >
      {groups.map((group) => (
        <ThreadLineageGroup
          key={`${scopedThreadKey(ref)}:${group.id}`}
          {...group}
          compact={compact}
        >
          {(visibleRows) =>
            visibleRows.map(({ threadId, edge }) => {
              const node = graph.nodes.get(threadId);
              const isSubagent = edge.kind === "subagent";
              const isParent = isParentThreadRelationship(edge, props.threadId);
              const isMergeTarget = threadId === mergeTargetThreadId;
              const status = threadRelationshipRowStatus(graph, { threadId, edge });
              const RelationshipIcon = isParent
                ? CornerLeftUpIcon
                : isSubagent
                  ? BotIcon
                  : GitForkIcon;
              const relationship = relationshipLabel(edge, props.threadId);
              const agent = currentSubagent(
                isSubagent && !isParent ? subagentsByThreadId.get(threadId) : undefined,
                node?.thread,
              );
              const canStop =
                agent?.origin === "app_owned" &&
                agent.startedAt &&
                ["pending", "running", "waiting"].includes(agent.status);
              const threadTitle = relationshipThreadTitle({
                title: node?.thread?.title ?? agent?.title ?? threadId,
                isSubagent,
              });
              const provider = providers?.find(
                (entry) =>
                  entry.instanceId ===
                  (agent?.providerInstanceId ?? node?.thread?.providerInstanceId),
              );
              const providerDriver = agent?.driver ?? provider?.driver;
              const model = agent ? agent.model : node?.thread?.modelSelection.model;
              const providerModel = provider?.models.find((entry) => entry.slug === model);
              const modelLabel = providerModel
                ? getTriggerDisplayModelName(providerModel)
                : model
                  ? formatModelSlugName(model)
                  : "Model not reported";
              const project = projects.find((project) => project.id === node?.thread?.projectId);
              const relationshipHint = node?.missing
                ? "This related thread is unavailable"
                : `Open ${relationship.toLowerCase()} in this chat`;
              const RelationshipPopup = agent ? ThreadHoverCardPopup : TooltipPopup;
              const relationshipTooltip = agent ? (
                <SubagentTooltipContent
                  title={threadTitle}
                  model={agent.model}
                  providerInstanceId={agent.providerInstanceId}
                  origin={agent.origin}
                  provider={provider}
                  providers={providers}
                  driver={providerDriver}
                  elapsed={<AgentElapsed agent={agent} />}
                  status={agent.status}
                  result={agent.result}
                  progress={agent.progress}
                  parentThread={currentThread ?? undefined}
                  childThread={node?.thread ?? undefined}
                  parentProject={currentProject}
                  childProject={project}
                />
              ) : (
                relationshipHint
              );
              const relationshipContent = (
                <>
                  <ThreadRelationshipIcon
                    driver={isSubagent && !isParent ? providerDriver : undefined}
                    provider={provider}
                    fallbackIcon={RelationshipIcon}
                    status={status}
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block text-left ${compact ? "line-clamp-2 whitespace-normal break-words text-[13px]" : "truncate text-sm"} font-medium leading-4 text-foreground/85`}
                    >
                      {threadTitle}
                    </span>
                    {compact ? (
                      <span className="mt-1 flex flex-wrap items-center gap-x-1 text-left text-2xs font-normal leading-4 text-muted-foreground">
                        <span className="max-w-full truncate">{modelLabel}</span>
                        <span aria-hidden>·</span>
                        <span>{threadRelationshipStatusLabel(status)}</span>
                        {agent?.startedAt ? (
                          <>
                            <span aria-hidden>·</span>
                            <span className="tabular-nums">
                              <AgentElapsed agent={agent} />
                            </span>
                          </>
                        ) : null}
                      </span>
                    ) : null}
                  </span>
                  {!compact &&
                    (agent ? (
                      agent.startedAt ? (
                        <span className="shrink-0 text-2xs font-normal tabular-nums text-muted-foreground">
                          <AgentElapsed agent={agent} />
                        </span>
                      ) : null
                    ) : (
                      <ArrowRightIcon className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                    ))}
                  {!compact && !isMergeTarget && (
                    <span className="shrink-0 text-2xs text-muted-foreground">
                      {threadRelationshipStatusLabel(status)}
                    </span>
                  )}
                </>
              );
              const workflowGroup =
                agent === undefined ? undefined : workflowGroupsById.get(agent.id);
              if (workflowGroup !== undefined) {
                return (
                  <ThreadLineageWorkflowRow
                    key={threadId}
                    environmentId={props.environmentId}
                    threadId={props.threadId}
                    group={workflowGroup}
                    provider={provider}
                    driver={providerDriver}
                    header={
                      <Tooltip>
                        <TooltipTrigger
                          delay={200}
                          render={
                            <ThreadDetailsControl
                              size="sm"
                              variant="ghost"
                              part="primary"
                              disabled={node?.missing === true}
                              onClick={() => openThread(threadId)}
                            />
                          }
                        >
                          {relationshipContent}
                        </TooltipTrigger>
                        <RelationshipPopup side="left">{relationshipTooltip}</RelationshipPopup>
                      </Tooltip>
                    }
                  />
                );
              }
              if (isMergeTarget) {
                return (
                  <li key={threadId} className="group relative flex h-9 items-center rounded-lg">
                    <div className={THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS}>
                      <Tooltip>
                        <TooltipTrigger
                          delay={200}
                          render={
                            <ThreadDetailsControl
                              size="sm"
                              variant="ghost"
                              part="primary"
                              aria-label={`${threadTitle} ${threadRelationshipStatusLabel(status)}`}
                              disabled={node?.missing === true}
                              onClick={() => openThread(threadId)}
                            />
                          }
                        >
                          {relationshipContent}
                        </TooltipTrigger>
                        <RelationshipPopup side="left">{relationshipTooltip}</RelationshipPopup>
                      </Tooltip>
                      <span
                        aria-hidden="true"
                        className={THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS}
                      />
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <ThreadDetailsControl
                              size="sm"
                              variant="ghost"
                              part="secondary"
                              aria-label={
                                parentTitle
                                  ? `Merge back to ${parentTitle}`
                                  : "Merge back to source conversation"
                              }
                              data-thread-merge-back="true"
                              disabled={!canMerge || busyAction !== null}
                              onClick={() => void merge()}
                            >
                              {busyAction === "merge" ? (
                                <LoaderCircleIcon className="size-3 animate-spin" />
                              ) : (
                                <PullRequestGlyph.merged className="size-3" />
                              )}
                            </ThreadDetailsControl>
                          }
                        />
                        <TooltipPopup side="left">
                          {latestMergeBackRun === null
                            ? "Complete a run in this fork before merging it back"
                            : parentTitle
                              ? `Merge this conversation back into ${parentTitle}`
                              : "Merge this conversation back into its source"}
                        </TooltipPopup>
                      </Tooltip>
                      <span className="shrink-0 border border-transparent ps-1 pe-2.5 text-2xs font-medium text-muted-foreground">
                        {threadRelationshipStatusLabel(status)}
                      </span>
                    </div>
                  </li>
                );
              }
              return (
                <li
                  key={threadId}
                  className={`group relative flex ${compact ? "min-h-12" : "h-9"} items-center rounded-lg`}
                >
                  <Tooltip>
                    <TooltipTrigger
                      delay={200}
                      render={
                        <ThreadDetailsControl
                          size="sm"
                          variant="ghost"
                          disabled={node?.missing === true}
                          onClick={() => openThread(threadId)}
                          part="row"
                          className={`w-auto min-w-0 flex-1 ${compact ? "h-auto min-h-12 py-2" : ""}`}
                        />
                      }
                    >
                      {relationshipContent}
                    </TooltipTrigger>
                    <RelationshipPopup side="left">{relationshipTooltip}</RelationshipPopup>
                  </Tooltip>
                  {canStop && agent ? (
                    <div className="flex w-7 shrink-0 items-center justify-center">
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <ThreadDetailsControl
                              size="icon-xs"
                              variant="ghost"
                              part="icon"
                              tone="destructive"
                              aria-label={`Stop subagent ${threadTitle}`}
                              disabled={stoppingThreadId !== null}
                              onClick={() => void stopSubagent(threadId)}
                            />
                          }
                        >
                          <SquareIcon aria-hidden className="size-3 fill-current" />
                        </TooltipTrigger>
                        <TooltipPopup side="left">Stop subagent</TooltipPopup>
                      </Tooltip>
                    </div>
                  ) : null}
                </li>
              );
            })
          }
        </ThreadLineageGroup>
      ))}
    </ThreadDetailsSection>
  );
}
