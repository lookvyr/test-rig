import { getProviderOptionCurrentValue, withLegacyUltracodeEffort } from "@t3tools/shared/model";
import { backgroundWorkHoldsCompletion } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";
import { formatThreadLink } from "@t3tools/shared/threadLinks";
import * as ProjectService from "../project/ProjectService.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as Exit from "effect/Exit";
import { runRanAfter } from "@t3tools/shared/orchestrationV2ThreadError";
import {
  CommandId,
  isOfferedRuntimeMode,
  latestProviderTurnForAttempt,
  ORCHESTRATOR_MCP_RUNNING_TASK_NEXT,
  ProviderRequestKind,
  SECRET_REQUEST_UNSAVED_NOTE,
  TurnItemId,
  type OrchestrationV2StopWorkflowInput,
  type OrchestratorMcpCapabilitiesInput,
  type OrchestratorMcpListScheduledTasksInput,
  type OrchestratorMcpModelOption,
  type OrchestratorMcpSaveScheduledTaskInput,
  type ProjectId,
  type ServerProviderModel,
  type OrchestratorMcpRequestSecretInput,
  type OrchestratorMcpRequestSecretResult,
  type RunId,
  isProviderAvailable,
  MessageId,
  type ModelSelection,
  NodeId,
  type OrchestrationV2Run,
  type OrchestrationV2Command,
  type OrchestrationV2Subagent,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2ThreadShell,
  type OrchestrationV2TurnItem,
  OrchestratorMcpFailure,
  type OrchestratorMcpBackgroundWaitInput,
  type OrchestratorMcpBackgroundWaitResult,
  type OrchestratorMcpCapabilitiesResult,
  type OrchestratorMcpCreateThreadsInput,
  type OrchestratorMcpCreateThreadsResult,
  type OrchestratorMcpCreatedThread,
  type OrchestratorMcpDelegateTaskInput,
  type OrchestratorMcpDelegateTaskResult,
  type OrchestratorMcpInteractionMode,
  type OrchestratorMcpDeleteScheduledTaskInput,
  type OrchestratorMcpDeleteScheduledTaskResult,
  type OrchestratorMcpListScheduledTasksResult,
  type OrchestratorMcpRuntimeMode,
  type OrchestratorMcpScheduledTask,
  type OrchestratorMcpScheduleTaskInput,
  type OrchestratorMcpScheduleTaskResult,
  type OrchestratorMcpTarget,
  type OrchestratorMcpTaskCancelInput,
  type OrchestratorMcpTaskCancelResult,
  type OrchestratorMcpThreadDetail,
  type OrchestratorMcpThreadPullRequest,
  type OrchestratorMcpThreadInterruptInput,
  type OrchestratorMcpThreadInterruptResult,
  type OrchestratorMcpThreadListInput,
  type OrchestratorMcpThreadListItem,
  type OrchestratorMcpThreadListResult,
  type OrchestratorMcpThreadReadInput,
  type OrchestratorMcpThreadReadResult,
  type OrchestratorMcpThreadRun,
  type OrchestratorMcpThreadSendInput,
  type OrchestratorMcpThreadSendResult,
  type OrchestratorMcpThreadTimelineItem,
  type OrchestratorMcpThreadWaitInput,
  type OrchestratorMcpThreadWaitResult,
  type ProviderInteractionMode,
  type ProviderInstanceId,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
  type RuntimeMode,
  type ScheduledTask,
  type ScheduledTaskUpsertInput,
  type ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import {
  normalizeThreadPullRequestKey,
  visibleThreadPullRequests,
} from "@t3tools/shared/threadPullRequests";
import { isSnoozed } from "../orchestration-v2/ThreadSettlementService.ts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import {
  subagentResultForRun,
  delegatedTaskProgress,
  delegatedTaskProgressForTask,
} from "../orchestration-v2/SubagentProjection.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as TaskFolders from "../workspace/TaskFolders.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProviderRegistry from "../provider/Services/ProviderRegistry.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import type { McpInvocationScope } from "./McpInvocationContext.ts";

// A blocking call longer than this is cut off by some clients; agents call again or end the turn.
const DEFAULT_WAIT_TIMEOUT_MS = 30 * 1_000;
const MAX_WAIT_TIMEOUT_MS = 45 * 1_000;
// The user answers a secret card by hand, so it waits longer than a task wait.
const DEFAULT_SECRET_REQUEST_TIMEOUT_MS = 10 * 60 * 1_000;
const MAX_SECRET_REQUEST_TIMEOUT_MS = 60 * 60 * 1_000;
// Lifecycle events and blocking questions can end a wait; transcript output cannot.
const TASK_WAKE_EVENTS = [
  { thread: "parent", eventType: "subagent.updated" },
  { thread: "parent", eventType: "thread.deleted" },
  { thread: "child", eventType: "run.updated" },
  { thread: "child", eventType: "subagent.updated" },
  { thread: "child", eventType: "provider-thread.updated" },
  { thread: "child", eventType: "runtime-request.updated" },
  { thread: "child", eventType: "thread.deleted" },
] as const;
const DEFAULT_THREAD_LIST_LIMIT = 50;
const DEFAULT_THREAD_READ_LIMIT = 50;
const DEFAULT_THREAD_RUN_LIMIT = 10;
const DEFAULT_THREAD_ITEM_MAX_CHARS = 20_000;
const THREAD_PULL_REQUEST_PREVIEW_LIMIT = 5;

interface ResolvedTarget {
  readonly modelSelection: ModelSelection;
}

type TerminalTaskStatus = Extract<
  OrchestratorMcpDelegateTaskResult["status"],
  "completed" | "failed" | "cancelled" | "interrupted"
>;

export interface OrchestratorMcpServiceShape {
  readonly requestSecret: (
    scope: McpInvocationScope,
    input: OrchestratorMcpRequestSecretInput,
  ) => Effect.Effect<OrchestratorMcpRequestSecretResult, OrchestratorMcpFailure>;
  readonly capabilities: (
    scope: McpInvocationScope,
    input?: OrchestratorMcpCapabilitiesInput,
  ) => Effect.Effect<OrchestratorMcpCapabilitiesResult, OrchestratorMcpFailure>;
  readonly delegateTask: (
    scope: McpInvocationScope,
    input: OrchestratorMcpDelegateTaskInput,
  ) => Effect.Effect<OrchestratorMcpDelegateTaskResult, OrchestratorMcpFailure>;
  readonly taskStatus: (
    scope: McpInvocationScope,
    taskId: NodeId,
  ) => Effect.Effect<OrchestratorMcpDelegateTaskResult, OrchestratorMcpFailure>;
  readonly cancelTask: (
    scope: McpInvocationScope,
    input: OrchestratorMcpTaskCancelInput,
  ) => Effect.Effect<OrchestratorMcpTaskCancelResult, OrchestratorMcpFailure>;
  readonly createThreads: (
    scope: McpInvocationScope,
    input: OrchestratorMcpCreateThreadsInput,
  ) => Effect.Effect<OrchestratorMcpCreateThreadsResult, OrchestratorMcpFailure>;
  readonly scheduleTask: (
    scope: McpInvocationScope,
    input: OrchestratorMcpScheduleTaskInput,
  ) => Effect.Effect<OrchestratorMcpScheduleTaskResult, OrchestratorMcpFailure>;
  readonly listScheduledTasks: (
    scope: McpInvocationScope,
    input?: OrchestratorMcpListScheduledTasksInput,
  ) => Effect.Effect<OrchestratorMcpListScheduledTasksResult, OrchestratorMcpFailure>;
  /** Creates a task, or updates the one `scheduledTaskId` names. */
  readonly saveScheduledTask: (
    scope: McpInvocationScope,
    input: OrchestratorMcpSaveScheduledTaskInput,
  ) => Effect.Effect<OrchestratorMcpScheduleTaskResult, OrchestratorMcpFailure>;
  readonly deleteScheduledTask: (
    scope: McpInvocationScope,
    input: OrchestratorMcpDeleteScheduledTaskInput,
  ) => Effect.Effect<OrchestratorMcpDeleteScheduledTaskResult, OrchestratorMcpFailure>;
  readonly listThreads: (
    scope: McpInvocationScope,
    input: OrchestratorMcpThreadListInput,
  ) => Effect.Effect<OrchestratorMcpThreadListResult, OrchestratorMcpFailure>;
  readonly readThread: (
    scope: McpInvocationScope,
    input: OrchestratorMcpThreadReadInput,
  ) => Effect.Effect<OrchestratorMcpThreadReadResult, OrchestratorMcpFailure>;
  readonly sendToThread: (
    scope: McpInvocationScope,
    input: OrchestratorMcpThreadSendInput,
  ) => Effect.Effect<OrchestratorMcpThreadSendResult, OrchestratorMcpFailure>;
  readonly waitForThread: (
    scope: McpInvocationScope,
    input: OrchestratorMcpThreadWaitInput,
  ) => Effect.Effect<OrchestratorMcpThreadWaitResult, OrchestratorMcpFailure>;
  readonly interruptThread: (
    scope: McpInvocationScope,
    input: OrchestratorMcpThreadInterruptInput,
  ) => Effect.Effect<OrchestratorMcpThreadInterruptResult, OrchestratorMcpFailure>;
  readonly backgroundWait: (
    scope: McpInvocationScope,
    input: OrchestratorMcpBackgroundWaitInput,
  ) => Effect.Effect<OrchestratorMcpBackgroundWaitResult, OrchestratorMcpFailure>;
  readonly stopWorkflow: (
    scope: McpInvocationScope,
    input: OrchestrationV2StopWorkflowInput,
  ) => Effect.Effect<void, OrchestratorMcpFailure>;
}

export class OrchestratorMcpService extends Context.Service<
  OrchestratorMcpService,
  OrchestratorMcpServiceShape
>()("t3/mcp/OrchestratorMcpService") {}

const isThreadManagementError = Schema.is(ThreadManagementService.ThreadManagementError);

function failure(code: OrchestratorMcpFailure["code"], message: string): OrchestratorMcpFailure {
  return new OrchestratorMcpFailure({ code, message });
}

/**
 * A caller's thread is live while it is not archived, runs on the caller's
 * provider instance, and has an active run or a background subagent that
 * instance started. A background subagent outlives its run and calls tools
 * with its thread's credential, which is revoked when the provider process
 * goes away.
 */
export const isLiveCallerShell = (
  shell: Pick<
    OrchestrationV2ThreadShell,
    "archivedAt" | "activeRunId" | "providerInstanceId" | "pendingBackgroundTasks"
  > | null,
  providerInstanceId: ProviderInstanceId | undefined,
) =>
  shell !== null &&
  shell.archivedAt === null &&
  shell.providerInstanceId === providerInstanceId &&
  (shell.activeRunId !== null ||
    (shell.pendingBackgroundTasks?.some(
      (task) => task.kind === "subagent" && task.providerInstanceId === providerInstanceId,
    ) ??
      false));

function threadManagementFailure(error: unknown): OrchestratorMcpFailure {
  if (!isThreadManagementError(error)) return failure("orchestration_error", errorMessage(error));
  switch (error._tag) {
    case "ThreadManagementThreadNotFoundError":
      return failure("thread_not_found", error.message);
    case "ThreadManagementRunNotFoundError":
      return failure("run_not_found", error.message);
    case "ThreadManagementThreadArchivedError":
    case "ThreadManagementNoSteerableRunError":
      return failure("thread_not_sendable", error.message);
    case "ThreadManagementThreadNotInterruptibleError":
      return failure("thread_not_interruptible", error.message);
    case "ThreadManagementProjectionLoadError":
    case "ThreadManagementProjectThreadsListError":
    case "ThreadManagementDurableRunProjectionError":
      return failure("orchestration_error", error.message);
  }
}

// Without a reason, a Stop reads as the user's (see RunExecutionService.USER_STOP_REASON).
function agentStopReason(reason: string | undefined): string {
  return reason === undefined ? "Stopped by an agent" : `Stopped by an agent: ${reason}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function scheduledTaskSummary(task: ScheduledTask): OrchestratorMcpScheduledTask {
  return {
    scheduledTaskId: task.id,
    title: task.title,
    prompt: task.prompt,
    enabled: task.enabled,
    projectId: task.projectId,
    boundThreadId: task.threadId,
    freshSession: task.freshSession === true,
    schedule: task.schedule,
    nextRunAt: task.nextRunAt,
    lastRunStatus: task.lastRunStatus,
  };
}

/**
 * Large catalogs (OpenCode, Cursor) can list hundreds of models, so agents get a short list by
 * default and search for the rest. These providers have small official catalogs, so all their
 * current models are listed.
 */
const FULL_CATALOG_DRIVERS: ReadonlySet<string> = new Set(["codex", "claudeAgent"]);
const LISTED_MODEL_LIMIT = 8;

/**
 * Lists models, keeping pinned models and limiting large catalogs by default. Whole provider
 * words select the provider; other words filter models when any model matches them.
 */
function listCapabilityModels(input: {
  readonly provider: ServerProvider;
  readonly isPinned: (model: ServerProviderModel) => boolean;
  readonly searchTerms: ReadonlyArray<string>;
}) {
  const visible = input.provider.models;
  const { instanceId, driver, displayName } = input.provider;
  const providerText = `${instanceId} ${driver} ${displayName ?? ""}`.toLowerCase();
  // Whole ids like "codex-work" and their parts both name the provider.
  const providerWords = new Set([
    ...providerText.split(/\s+/),
    ...providerText.split(/[^\p{L}\p{N}]+/u),
  ]);
  const modelText = (model: ServerProviderModel) =>
    `${model.slug} ${model.name} ${model.subProvider ?? ""}`.toLowerCase();
  // Part of a provider word ("agent" in "claudeAgent") names the provider unless a model matches it.
  const modelTerms = input.searchTerms.filter(
    (term) =>
      !providerWords.has(term) &&
      (!providerText.includes(term) || visible.some((model) => modelText(model).includes(term))),
  );
  if (modelTerms.length > 0) {
    const matches = visible.filter((model) => {
      const text = modelText(model);
      return modelTerms.every((term) => text.includes(term));
    });
    const listed = matches.slice(0, LISTED_MODEL_LIMIT);
    return { listed, omitted: matches.length - listed.length };
  }
  const current = visible.filter((model) => model.isLegacy !== true);
  const shown = new Set(
    FULL_CATALOG_DRIVERS.has(input.provider.driver)
      ? current
      : current.slice(0, LISTED_MODEL_LIMIT),
  );
  const listed = visible.filter((model) => input.isPinned(model) || shown.has(model));
  return { listed, omitted: visible.length - listed.length };
}

/** Option ids and allowed values are all a delegating agent needs; labels are UI copy. */
function capabilityModelOption(descriptor: ProviderOptionDescriptor): OrchestratorMcpModelOption {
  const defaultValue = getProviderOptionCurrentValue(descriptor);
  return {
    id: descriptor.id,
    values:
      descriptor.type === "boolean" ? [false, true] : descriptor.options.map((choice) => choice.id),
    ...(defaultValue === undefined ? {} : { default: defaultValue }),
  };
}

/** Only options the model still has, so an agent can pass them back unchanged. */
function knownOptions(
  options: ReadonlyArray<ProviderOptionSelection> | undefined,
  descriptors: ReadonlyArray<ProviderOptionDescriptor> | undefined,
): ReadonlyArray<ProviderOptionSelection> | undefined {
  if (options === undefined || descriptors === undefined) return options;
  return options.filter((option) => descriptors.some((descriptor) => descriptor.id === option.id));
}

function providerConstraints(
  provider: ServerProvider | undefined,
  supportsOrchestrationV2: boolean,
): ReadonlyArray<string> {
  const constraints: Array<string> = [];
  if (!supportsOrchestrationV2) {
    constraints.push("No V2 provider adapter is registered.");
  }
  if (provider === undefined) return constraints;
  if (!provider.enabled) constraints.push("Provider instance is disabled.");
  if (!provider.installed) constraints.push("Provider executable is not installed.");
  if (!isProviderAvailable(provider)) {
    constraints.push(provider.unavailableReason ?? "Provider driver is unavailable.");
  }
  if (provider.status === "error" || provider.status === "disabled") {
    constraints.push(provider.message ?? `Provider status is ${provider.status}.`);
  }
  if (provider.auth.status === "unauthenticated") {
    constraints.push("Provider is not authenticated.");
  }
  return constraints;
}

/**
 * Checks requested option selections for duplicates and, when the model
 * advertises option descriptors, against those descriptors. Models without
 * descriptors skip the descriptor checks (mirroring how model slugs are only
 * validated when the provider advertises models), but duplicate ids always
 * fail: downstream consumers disagree on whether the first or last value of
 * a duplicated id wins.
 */
function invalidOptionSelections(
  selections: ReadonlyArray<ProviderOptionSelection>,
  descriptors: ReadonlyArray<ProviderOptionDescriptor> | undefined,
): ReadonlyArray<string> {
  const problems: Array<string> = [];
  const seen = new Set<string>();
  for (const selection of selections) {
    if (seen.has(selection.id)) {
      problems.push(`Option ${selection.id} was specified more than once.`);
      continue;
    }
    seen.add(selection.id);
    if (descriptors === undefined) continue;
    const descriptor = descriptors.find((candidate) => candidate.id === selection.id);
    if (descriptor === undefined) {
      const known = descriptors.map((candidate) => candidate.id).join(", ");
      problems.push(`Unknown option ${selection.id}; supported options: ${known || "none"}.`);
      continue;
    }
    if (descriptor.type === "boolean" && typeof selection.value !== "boolean") {
      problems.push(`Option ${selection.id} expects a boolean value.`);
      continue;
    }
    if (
      descriptor.type === "select" &&
      !descriptor.options.some((choice) => choice.id === selection.value)
    ) {
      const choices = descriptor.options.map((choice) => choice.id).join(", ");
      problems.push(`Option ${selection.id} must be one of: ${choices}.`);
    }
  }
  return problems;
}

function taskStatusForRun(
  run: Pick<OrchestrationV2Run, "status"> | undefined,
): OrchestratorMcpDelegateTaskResult["status"] {
  switch (run?.status) {
    case "queued":
      return "queued";
    case "waiting":
      return "waiting";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
    case "rolled_back":
      return "cancelled";
    case "interrupted":
      return "interrupted";
    case "starting":
      return "starting";
    case "preparing":
    case "running":
    case undefined:
      return "running";
  }
}

export function delegatedTaskRun(
  childProjection: Pick<OrchestrationV2ThreadProjection, "runs" | "contextTransfers">,
  task: OrchestrationV2Subagent,
): OrchestrationV2Run | undefined {
  const taskRun = childProjection.runs.find((run) => run.delegatedTaskId === task.id);
  if (taskRun !== undefined) return taskRun;
  const spawnTransfer = childProjection.contextTransfers.find(
    (transfer) =>
      transfer.type === "subagent_spawn" &&
      transfer.sourceThreadId === task.threadId &&
      transfer.targetThreadId === task.childThreadId,
  );
  if (spawnTransfer === undefined) {
    // Legacy delegated-task projections predate the durable spawn transfer.
    return childProjection.runs[0];
  }
  return spawnTransfer.targetRunId === null
    ? undefined
    : childProjection.runs.find((run) => run.id === spawnTransfer.targetRunId);
}

export function hasPendingChildRuns(
  childProjection: Pick<OrchestrationV2ThreadProjection, "runs">,
  delegatedRun: OrchestrationV2Run | undefined,
): boolean {
  // Held queued runs wait for the user to resume the child; task_cancel holds them.
  return childProjection.runs.some(
    (run) =>
      !ThreadManagementService.isTerminalRunStatus(run.status) &&
      !(run.status === "queued" && run.queueHeld === true) &&
      (delegatedRun === undefined || run.ordinal > delegatedRun.ordinal),
  );
}

function isTerminalTaskStatus(
  status: OrchestratorMcpDelegateTaskResult["status"],
): status is TerminalTaskStatus {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "interrupted"
  );
}

function endsTaskWait(result: OrchestratorMcpDelegateTaskResult): boolean {
  return (
    result.hasPendingQuestion ||
    result.pendingApproval !== null ||
    isTerminalTaskStatus(result.status)
  );
}

const isApprovalRequestKind = Schema.is(ProviderRequestKind);

/** The oldest live approval a task's own runs are blocked on. */
function pendingTaskApproval(
  child: Pick<OrchestrationV2ThreadProjection, "runs" | "nodes" | "runtimeRequests">,
  taskId: NodeId,
  originalRun: OrchestrationV2Run | undefined,
): OrchestratorMcpDelegateTaskResult["pendingApproval"] {
  const taskRunIds = new Set(
    child.runs
      .filter(
        (run) =>
          !ThreadManagementService.isTerminalRunStatus(run.status) &&
          (run.delegatedTaskId === taskId ||
            // Legacy tasks own only their original run, not later turns in the child thread.
            (run.delegatedTaskId === undefined && run.id === originalRun?.id)),
      )
      .map((run) => run.id),
  );
  let approval: OrchestratorMcpDelegateTaskResult["pendingApproval"] = null;
  let oldestCreatedAt = Infinity;
  for (const request of child.runtimeRequests) {
    if (
      request.status !== "pending" ||
      request.responseCapability.type !== "live" ||
      !isApprovalRequestKind(request.kind)
    ) {
      continue;
    }
    const runId = child.nodes.find((node) => node.id === request.nodeId)?.runId;
    if (runId === undefined || runId === null || !taskRunIds.has(runId)) continue;
    const createdAt = DateTime.toEpochMillis(request.createdAt);
    if (createdAt < oldestCreatedAt) {
      oldestCreatedAt = createdAt;
      approval = { requestId: request.id, kind: request.kind, runId };
    }
  }
  return approval;
}

function directAppOwnedChildTasks(
  parent: Pick<OrchestrationV2ThreadProjection, "thread" | "subagents">,
  target: Pick<OrchestrationV2ThreadProjection, "thread" | "runs">,
  returnedRunIds: ReadonlySet<RunId | null>,
): ReadonlyArray<OrchestrationV2Subagent> {
  if (
    target.thread.lineage.parentThreadId !== parent.thread.id ||
    target.thread.lineage.relationshipToParent !== "subagent"
  ) {
    return [];
  }
  const original = parent.subagents.find(
    (task) =>
      task.origin === "app_owned" &&
      task.threadId === parent.thread.id &&
      task.id ===
        (target.thread.forkedFrom?.type === "node" ? target.thread.forkedFrom.nodeId : undefined) &&
      task.childThreadId === target.thread.id,
  );
  const taskIds = new Set(
    target.runs
      .filter((run) => returnedRunIds.has(run.id))
      .map((run) => run.delegatedTaskId ?? original?.id),
  );
  return parent.subagents.filter(
    (task) =>
      taskIds.has(task.id) &&
      task.origin === "app_owned" &&
      task.childThreadId === target.thread.id,
  );
}

function taskResultTransfer(
  parent: Pick<OrchestrationV2ThreadProjection, "thread" | "contextTransfers">,
  child: Pick<OrchestrationV2ThreadProjection, "runs" | "contextTransfers">,
  task: OrchestrationV2Subagent,
) {
  const originalRun = delegatedTaskRun(child, task);
  const resultRunIds = new Set(
    child.runs
      .filter(
        (run) =>
          run.delegatedTaskId === task.id ||
          (originalRun?.delegatedTaskId === undefined && run.delegatedTaskId === undefined),
      )
      .map((run) => run.id),
  );
  if (originalRun !== undefined) resultRunIds.add(originalRun.id);
  return parent.contextTransfers.find(
    (transfer) =>
      transfer.type === "subagent_result" &&
      transfer.sourceThreadId === task.childThreadId &&
      transfer.targetThreadId === parent.thread.id &&
      ((transfer.sourcePoint.runId !== undefined && resultRunIds.has(transfer.sourcePoint.runId)) ||
        (transfer.sourcePoint.runId === undefined && originalRun?.delegatedTaskId === undefined)),
  );
}

function pageIncludesTerminalTaskResult(input: {
  readonly parent: Pick<OrchestrationV2ThreadProjection, "thread" | "contextTransfers">;
  readonly page: ReadonlyArray<OrchestrationV2ThreadProjection["visibleTurnItems"][number]>;
  readonly task: OrchestrationV2Subagent;
  readonly target: Pick<
    OrchestrationV2ThreadProjection,
    "thread" | "runs" | "contextTransfers" | "messages" | "turnItems"
  >;
  readonly maxChars: number;
}): boolean {
  const transfer = taskResultTransfer(input.parent, input.target, input.task);
  if (transfer === undefined) return false;
  const run =
    transfer.sourcePoint.runId === undefined
      ? delegatedTaskRun(input.target, input.task)
      : input.target.runs.find((run) => run.id === transfer.sourcePoint.runId);
  if (run === undefined || !isTerminalTaskStatus(taskStatusForRun(run))) return false;

  const result = subagentResultForRun(input.target, run);
  if (result.messageId === null && result.turnItemId === null) return false;

  return input.page.some((row) => {
    if (row.sourceThreadId !== input.target.thread.id) return false;
    const matchesResult =
      (result.turnItemId !== null && row.sourceItemId === result.turnItemId) ||
      (result.messageId !== null &&
        row.item.type === "assistant_message" &&
        row.item.messageId === result.messageId);
    if (!matchesResult) return false;

    const text = turnItemText(row.item);
    return text !== null && text.length <= input.maxChars;
  });
}

function latestTerminalResultRun(
  projection: Pick<OrchestrationV2ThreadProjection, "messages" | "runs">,
  delegatedRun: OrchestrationV2Run | undefined,
): OrchestrationV2Run | undefined {
  const monitorRunIds = new Set(
    projection.messages
      .filter((message) => message.notification?.source.kind === "monitor")
      .map((message) => message.runId),
  );
  return projection.runs
    .filter(
      (run) =>
        ThreadManagementService.isTerminalRunStatus(run.status) &&
        !monitorRunIds.has(run.id) &&
        run.status !== "rolled_back" &&
        (run.id === delegatedRun?.id || run.startedAt !== null),
    )
    .reduce<OrchestrationV2Run | undefined>(
      (latest, run) => (latest === undefined || runRanAfter(run, latest) ? run : latest),
      undefined,
    );
}

function canExposeTaskRunResult(run: OrchestrationV2Run | undefined): run is OrchestrationV2Run {
  return (
    run !== undefined && run.status !== "rolled_back" && isTerminalTaskStatus(taskStatusForRun(run))
  );
}

function runtimeModeRank(mode: RuntimeMode): number {
  switch (mode) {
    case "approval-required":
      return 0;
    case "auto-accept-edits":
      return 1;
    // Auto and full access are one tier: an auto thread may drive a full-access
    // one, and the classifier reviews each tool call it makes to do so.
    case "auto":
    case "full-access":
      return 2;
  }
}

function interactionModeRank(mode: ProviderInteractionMode): number {
  return mode === "plan" ? 0 : 1;
}

export function resolveRuntimeMode(
  parentMode: RuntimeMode,
  requested: OrchestratorMcpRuntimeMode | RuntimeMode | undefined,
): Effect.Effect<RuntimeMode, OrchestratorMcpFailure> {
  const resolved = requested === undefined || requested === "inherit" ? parentMode : requested;
  return runtimeModeRank(resolved) > runtimeModeRank(parentMode)
    ? Effect.fail(
        failure(
          "runtime_mode_escalation_denied",
          `Child runtime mode ${resolved} is broader than parent mode ${parentMode}.`,
        ),
      )
    : Effect.succeed(resolved);
}

/**
 * The mode a new thread or scheduled task starts in. Spawned work runs in Auto or Full access
 * only, so a thread in a manual mode cannot start any.
 */
export function resolveSpawnRuntimeMode(
  parentMode: RuntimeMode,
  requested: OrchestratorMcpRuntimeMode | undefined,
): Effect.Effect<RuntimeMode, OrchestratorMcpFailure> {
  return isOfferedRuntimeMode(parentMode)
    ? resolveRuntimeMode(parentMode, requested)
    : Effect.fail(
        failure(
          "capability_denied",
          `A thread in the ${parentMode} permission mode cannot start threads or scheduled tasks. Ask the user to switch it to Auto.`,
        ),
      );
}

export function resolveInteractionMode(
  parentMode: ProviderInteractionMode,
  requested: OrchestratorMcpInteractionMode | undefined,
): Effect.Effect<ProviderInteractionMode, OrchestratorMcpFailure> {
  const resolved = requested === undefined || requested === "inherit" ? parentMode : requested;
  return interactionModeRank(resolved) > interactionModeRank(parentMode)
    ? Effect.fail(
        failure(
          "interaction_mode_escalation_denied",
          `Child interaction mode ${resolved} is broader than parent mode ${parentMode}.`,
        ),
      )
    : Effect.succeed(resolved);
}

function stablePart(value: string): string {
  return encodeURIComponent(value);
}

function stableCommandId(input: {
  readonly scope: McpInvocationScope;
  readonly requestKey: string;
  readonly operation: string;
  readonly index?: number;
}): CommandId {
  return CommandId.make(
    [
      "command",
      "mcp",
      stablePart(input.scope.providerSessionId),
      stablePart(input.operation),
      stablePart(input.requestKey),
      ...(input.index === undefined ? [] : [String(input.index)]),
    ].join(":"),
  );
}

function stableThreadId(input: {
  readonly scope: McpInvocationScope;
  readonly requestKey: string;
  readonly index: number;
}): ThreadId {
  return ThreadId.make(
    [
      "thread",
      "mcp",
      stablePart(input.scope.providerSessionId),
      stablePart(input.requestKey),
      String(input.index),
    ].join(":"),
  );
}

const DELEGATED_TASK_THREAD_PREFIX = "thread:delegated-task:";

/** Agents paste delegated-task thread ids with their escapes undone; this is the escaped id. */
function suggestedThreadId(threadId: ThreadId): ThreadId | null {
  if (!threadId.startsWith(DELEGATED_TASK_THREAD_PREFIX)) return null;
  const rest = threadId.slice(DELEGATED_TASK_THREAD_PREFIX.length);
  let encoded: string;
  try {
    encoded = encodeURIComponent(rest);
  } catch {
    // Lone surrogates, which a JSON string can carry, do not encode.
    return null;
  }
  return encoded === rest ? null : ThreadId.make(`${DELEGATED_TASK_THREAD_PREFIX}${encoded}`);
}

function stableMessageId(input: {
  readonly scope: McpInvocationScope;
  readonly requestKey: string;
  readonly index: number;
}): MessageId {
  return MessageId.make(
    [
      "message",
      "mcp",
      stablePart(input.scope.providerSessionId),
      stablePart(input.requestKey),
      String(input.index),
    ].join(":"),
  );
}

function stableOperationMessageId(input: {
  readonly scope: McpInvocationScope;
  readonly requestKey: string;
  readonly operation: string;
}): MessageId {
  return MessageId.make(
    [
      "message",
      "mcp",
      stablePart(input.scope.providerSessionId),
      stablePart(input.operation),
      stablePart(input.requestKey),
    ].join(":"),
  );
}

function threadTitle(input: {
  readonly parentTitle: string;
  readonly prompt: string | undefined;
  readonly title: string | undefined;
  readonly index: number;
}): string {
  const detail = input.title?.trim() || input.prompt?.trim();
  if (!detail) return `${input.parentTitle} thread ${input.index + 1}`;
  return detail.length > 80 ? `${detail.slice(0, 77)}...` : detail;
}

function taskPrompt(input: OrchestratorMcpDelegateTaskInput): string {
  return input.role === undefined || input.role === "general"
    ? input.task
    : `Act as the ${input.role} sub-agent for this task.\n\n${input.task}`;
}

function threadSettlement(
  thread: Pick<OrchestrationV2ThreadShell, "settledOverride" | "settledAt">,
): Pick<OrchestratorMcpThreadListItem, "settled" | "settledAt"> {
  const settled = thread.settledOverride === "settled";
  return {
    settled,
    settledAt: settled && thread.settledAt !== null ? DateTime.formatIso(thread.settledAt) : null,
  };
}

function threadSnooze(
  thread: Parameters<typeof isSnoozed>[0],
  nowMs: number,
): Pick<OrchestratorMcpThreadListItem, "snoozed" | "snoozedUntil"> {
  const snoozed = isSnoozed(thread, nowMs);
  return {
    snoozed,
    snoozedUntil:
      snoozed && thread.snoozedUntil != null ? DateTime.formatIso(thread.snoozedUntil) : null,
  };
}

/** A thread link agents can write in replies; chat shows it as a thread chip. */
function threadLinkFor(scope: McpInvocationScope, threadId: ThreadId, title?: string): string {
  return formatThreadLink({ environmentId: scope.environmentId, threadId }, title);
}

function pullRequestUpdatedAtMs(
  link: NonNullable<OrchestrationV2ThreadShell["pullRequests"]>[number],
): number {
  const ms = Date.parse(link.snapshot?.updatedAt ?? link.linkedAt);
  return Number.isNaN(ms) ? 0 : ms;
}

/** Up to 5 open pull requests, watched first, then most recently updated, with counts. */
function threadPullRequests(
  links: OrchestrationV2ThreadShell["pullRequests"],
): Pick<
  OrchestratorMcpThreadListItem,
  "pullRequests" | "pullRequestCount" | "openPullRequestCount"
> {
  const visible = visibleThreadPullRequests(links ?? []);
  const open = visible.filter(
    (link) => link.snapshot?.state !== "merged" && link.snapshot?.state !== "closed",
  );
  return {
    pullRequests: open
      .toSorted(
        (left, right) =>
          Number(right.watch !== undefined) - Number(left.watch !== undefined) ||
          pullRequestUpdatedAtMs(right) - pullRequestUpdatedAtMs(left),
      )
      .slice(0, THREAD_PULL_REQUEST_PREVIEW_LIMIT)
      .map((link): OrchestratorMcpThreadPullRequest => ({
        host: normalizeThreadPullRequestKey(link).host,
        repository: link.repository,
        number: link.number,
        url: link.url,
        source: link.source,
        state: link.snapshot?.state ?? null,
      })),
    pullRequestCount: visible.length,
    openPullRequestCount: open.length,
  };
}

// Provider-internal links (parentTaskId, providerInstanceId) stay out of agent results.
function threadBackgroundWork(
  thread: Pick<OrchestrationV2ThreadShell, "blockedOnThreadWait" | "pendingBackgroundTasks">,
): Required<Pick<OrchestratorMcpThreadListItem, "blockedOnThreadWait" | "pendingBackgroundTasks">> {
  return {
    blockedOnThreadWait: thread.blockedOnThreadWait === true,
    pendingBackgroundTasks: (thread.pendingBackgroundTasks ?? []).map((task) => ({
      taskId: task.taskId,
      kind: task.kind,
      ...(task.description === undefined ? {} : { description: task.description }),
      ...(task.awaited === undefined ? {} : { awaited: task.awaited }),
      ...(task.kind === "subagent" && task.childThreadId !== undefined
        ? { childThreadId: task.childThreadId }
        : {}),
    })),
  };
}

// Awaited background work keeps a thread live after its turn ends, as auto-settle and the sidebar treat it.
function threadStatus(
  activeStatus: OrchestratorMcpThreadListItem["status"] | null | undefined,
  settledStatus: OrchestratorMcpThreadListItem["status"],
  pendingBackgroundTasks: OrchestrationV2ThreadShell["pendingBackgroundTasks"],
): OrchestratorMcpThreadListItem["status"] {
  if (activeStatus != null) return activeStatus;
  if (settledStatus === "failed") return settledStatus;
  return backgroundWorkHoldsCompletion(pendingBackgroundTasks ?? []) ? "waiting" : settledStatus;
}

function listedThreadStatus(shell: OrchestrationV2ThreadShell) {
  return threadStatus(shell.activityRunStatus, shell.status, shell.pendingBackgroundTasks);
}

function listItemFromShell(
  scope: McpInvocationScope,
  shell: OrchestrationV2ThreadShell,
  nowMs: number,
): OrchestratorMcpThreadListItem {
  return {
    threadId: shell.id,
    projectId: shell.projectId,
    title: shell.title,
    link: threadLinkFor(scope, shell.id, shell.title),
    createdBy: shell.createdBy,
    creationSource: shell.creationSource,
    status: listedThreadStatus(shell),
    latestRunId: shell.latestRunId,
    providerInstanceId: shell.modelSelection.instanceId,
    model: shell.modelSelection.model,
    runtimeMode: shell.runtimeMode,
    interactionMode: shell.interactionMode,
    linkedPullRequest: shell.linkedPullRequest ?? null,
    ...threadPullRequests(shell.pullRequests),
    ...threadSettlement(shell),
    ...threadSnooze(shell, nowMs),
    pinned: shell.pinnedAt != null,
    ...threadBackgroundWork(shell),
    parentThreadId: shell.lineage.parentThreadId,
    relationshipToParent: shell.lineage.relationshipToParent,
    itemCount: shell.visibleItemCount,
    createdAt: DateTime.formatIso(shell.createdAt),
    updatedAt: DateTime.formatIso(shell.updatedAt),
  };
}

function threadDetail(
  scope: McpInvocationScope,
  projection: Pick<OrchestrationV2ThreadProjection, "thread" | "runs" | "runtimeRequests">,
  itemCount: number,
  shell: OrchestrationV2ThreadShell,
  nowMs: number,
): OrchestratorMcpThreadDetail {
  const latest = ThreadManagementService.latestRun(projection);
  const active = ThreadManagementService.latestActiveRun(projection);
  return {
    threadId: projection.thread.id,
    projectId: projection.thread.projectId,
    title: projection.thread.title,
    link: threadLinkFor(scope, projection.thread.id, projection.thread.title),
    createdBy: projection.thread.createdBy,
    creationSource: projection.thread.creationSource,
    status: threadStatus(active?.status, latest?.status ?? "idle", shell.pendingBackgroundTasks),
    latestRunId: latest?.id ?? null,
    activeRunId: active?.id ?? null,
    providerInstanceId: projection.thread.modelSelection.instanceId,
    model: projection.thread.modelSelection.model,
    runtimeMode: projection.thread.runtimeMode,
    interactionMode: projection.thread.interactionMode,
    linkedPullRequest: projection.thread.linkedPullRequest ?? null,
    titleRegeneration:
      projection.thread.titleRegeneration === undefined ||
      projection.thread.titleRegeneration === null
        ? null
        : {
            requestId: projection.thread.titleRegeneration.requestId,
            startedAt: DateTime.formatIso(projection.thread.titleRegeneration.startedAt),
          },
    branch: projection.thread.branch,
    worktreePath: projection.thread.worktreePath,
    parentThreadId: projection.thread.lineage.parentThreadId,
    relationshipToParent: projection.thread.lineage.relationshipToParent,
    runCount: projection.runs.length,
    itemCount,
    pendingRequestCount: projection.runtimeRequests.filter(
      (request) => request.status === "pending",
    ).length,
    archived: projection.thread.archivedAt !== null,
    ...threadPullRequests(projection.thread.pullRequests),
    ...threadSettlement(projection.thread),
    ...threadSnooze(shell, nowMs),
    pinned: shell.pinnedAt != null,
    ...threadBackgroundWork(shell),
    createdAt: DateTime.formatIso(projection.thread.createdAt),
    updatedAt: DateTime.formatIso(projection.thread.updatedAt),
  };
}

function runExecutedModel(
  projection: Pick<OrchestrationV2ThreadProjection, "providerTurns">,
  run: Pick<OrchestrationV2Run, "activeAttemptId"> | undefined,
): string | null {
  return run === undefined
    ? null
    : (latestProviderTurnForAttempt(projection.providerTurns, run.activeAttemptId)?.model ?? null);
}

function threadRun(
  projection: Pick<OrchestrationV2ThreadProjection, "providerTurns">,
  run: OrchestrationV2Run,
): OrchestratorMcpThreadRun {
  return {
    runId: run.id,
    ordinal: run.ordinal,
    status: run.status,
    providerInstanceId: run.modelSelection.instanceId,
    model: run.modelSelection.model,
    executedModel: runExecutedModel(projection, run),
    requestedAt: DateTime.formatIso(run.requestedAt),
    startedAt: run.startedAt === null ? null : DateTime.formatIso(run.startedAt),
    completedAt: run.completedAt === null ? null : DateTime.formatIso(run.completedAt),
  };
}

function jsonText(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function turnItemText(item: OrchestrationV2TurnItem): string | null {
  switch (item.type) {
    case "notification":
      return [item.summary, item.detail].filter((part) => part !== undefined).join("\n");
    case "user_message":
    case "assistant_message":
    case "reasoning":
      return item.text;
    case "proposed_plan":
      return item.markdown;
    case "todo_list":
      return [item.explanation, ...item.steps.map((step) => `[${step.status}] ${step.text}`)]
        .filter((line): line is string => line !== undefined)
        .join("\n");
    case "user_input_request":
      return jsonText(item.questions);
    case "file_change":
      return [
        item.fileName,
        item.additions === undefined && item.deletions === undefined
          ? undefined
          : `+${item.additions ?? 0} -${item.deletions ?? 0}`,
        item.diffStr ?? item.newStr,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");
    case "command_execution":
      return [`$ ${item.input}`, item.output]
        .filter((line): line is string => line !== undefined)
        .join("\n");
    case "file_search":
      return jsonText({ pattern: item.pattern, results: item.results });
    case "web_search":
      return jsonText({ patterns: item.patterns, results: item.results });
    case "secret_request":
      return `${item.label}: ${item.secretStatus}`;
    case "approval_request":
      return item.prompt ?? item.requestKind;
    case "checkpoint":
      return jsonText(item.files);
    case "run_interrupt_request":
    case "run_interrupt_result":
    case "system_notice":
      return item.message;
    case "error":
      return item.failure.message;
    case "compaction":
      return item.summary ?? null;
    case "handoff":
      return item.summary ?? `${item.strategy} handoff to ${item.toProviderInstanceId}`;
    case "fork":
      return `Forked to thread ${item.targetThreadId}.`;
    case "thread_created":
      return `Created thread ${item.targetThreadId} with ${item.targetProviderInstanceId} (${item.targetModel}).`;
    case "subagent":
      return item.result ?? item.progress ?? item.prompt;
    case "dynamic_tool":
      return jsonText({ toolName: item.toolName, input: item.input, output: item.output });
  }
}

function timelineItem(input: {
  readonly row: OrchestrationV2ThreadProjection["visibleTurnItems"][number];
  readonly maxChars: number;
  readonly textOffset?: number;
  readonly messagesByThreadId: ReadonlyMap<ThreadId, OrchestrationV2ThreadProjection["messages"]>;
}): OrchestratorMcpThreadTimelineItem {
  const text = turnItemText(input.row.item);
  const offset = input.textOffset ?? 0;
  const end = offset + input.maxChars;
  const textTruncated = text !== null && text.length > end;
  const messageId =
    input.row.item.type === "user_message" || input.row.item.type === "assistant_message"
      ? input.row.item.messageId
      : null;
  const message =
    messageId === null
      ? undefined
      : input.messagesByThreadId
          .get(input.row.sourceThreadId)
          ?.find((candidate) => candidate.id === messageId);
  return {
    position: input.row.position,
    visibility: input.row.visibility,
    sourceThreadId: input.row.sourceThreadId,
    itemId: input.row.sourceItemId,
    runId: input.row.item.runId,
    messageId,
    createdBy: message?.createdBy ?? null,
    creationSource: message?.creationSource ?? null,
    type: input.row.item.type,
    status: input.row.item.status,
    title: input.row.item.title,
    text: text === null ? null : text.slice(offset, end),
    textTruncated,
    nextTextOffset: textTruncated ? end : null,
    updatedAt: DateTime.formatIso(input.row.item.updatedAt),
  };
}

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const threadLaunch = yield* ThreadLaunchService.ThreadLaunchService;
  const gitDriver = yield* GitVcsDriver.GitVcsDriver;
  const taskFolders = yield* TaskFolders.TaskFolders;
  const threadManagement = yield* ThreadManagementService.ThreadManagementService;
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
  const projects = yield* ProjectService.ProjectService;
  const providerAdapters = yield* ProviderAdapterRegistry.ProviderAdapterRegistryV2;
  const secretRequests = yield* SecretRequests.SecretRequests;
  const scheduledTasks = yield* ScheduledTaskService.ScheduledTaskService;

  const requireCapability = (scope: McpInvocationScope) =>
    scope.capabilities.has("orchestration")
      ? Effect.void
      : Effect.fail(
          failure(
            "capability_denied",
            "This MCP credential does not grant orchestration capabilities.",
          ),
        );

  const loadProjection = (threadId: ThreadId) =>
    threadManagement
      .getThreadRecords(
        threadId,
        [
          "runs",
          "messages",
          "subagents",
          "providerThreads",
          "providerTurns",
          "runtimeRequests",
          "contextTransfers",
          "turnItems",
        ],
        { turnItemTypes: [], messageRoles: ["user"] },
      )
      .pipe(
        Effect.mapError((error) =>
          failure(
            "orchestration_error",
            `Unable to read thread ${threadId}: ${errorMessage(error)}`,
          ),
        ),
        Effect.flatMap((projection) =>
          projection.thread.deletedAt != null
            ? Effect.fail(failure("thread_not_found", "The conversation was deleted."))
            : Effect.succeed(projection),
        ),
      );

  /**
   * Names a live thread on a miss when the id looks mistyped. The id is never rewritten,
   * so checks keyed on it still hold.
   */
  const threadNotFound = (threadId: ThreadId, message: string) =>
    Effect.gen(function* () {
      const suggested = suggestedThreadId(threadId);
      const shell =
        suggested === null
          ? null
          : yield* threadManagement
              .getThreadShell(suggested)
              .pipe(Effect.orElseSucceed(() => null));
      const hint =
        suggested === null || shell === null || shell.deletedAt !== null
          ? ""
          : ` Did you mean \`${suggested}\`?`;
      return yield* failure("thread_not_found", `${message}${hint}`);
    });

  /** Any thread on this server, in whichever project it is. */
  const loadThreadShell = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const shell = yield* threadManagement
        .getThreadShell(threadId)
        .pipe(Effect.mapError(threadManagementFailure));
      if (shell === null || shell.deletedAt !== null) {
        return yield* threadNotFound(threadId, `Thread ${threadId} was not found.`);
      }
      return shell;
    });

  const loadProjectThread = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const shell = yield* loadThreadShell(threadId);
      return yield* threadManagement
        .getProjectThreadRecords(
          { projectId: shell.projectId, threadId },
          [
            "runs",
            "messages",
            "subagents",
            "providerThreads",
            "providerTurns",
            "runtimeRequests",
            "contextTransfers",
            "turnItems",
          ],
          { turnItemTypes: [], messageRoles: ["user"] },
        )
        .pipe(Effect.mapError(threadManagementFailure));
    });

  // Threads in every project are in reach, as the user's own thread list is.
  const loadScopedThread = (scope: McpInvocationScope, threadId: ThreadId) =>
    Effect.gen(function* () {
      yield* requireCapability(scope);
      const parent = yield* loadProjection(scope.threadId);
      const target = threadId === scope.threadId ? parent : yield* loadProjectThread(threadId);
      return { parent, target } as const;
    });

  /** The caller still owns a live turn in its thread, so it may act outside its own project. */
  const assertLiveCaller = (
    scope: McpInvocationScope,
    parent: Pick<OrchestrationV2ThreadProjection, "thread" | "runs">,
  ) =>
    Effect.gen(function* () {
      const callerRun = ThreadManagementService.latestActiveRun(parent);
      const liveCaller =
        callerRun === undefined && parent.thread.archivedAt === null
          ? isLiveCallerShell(
              yield* threadManagement
                .getThreadShell(parent.thread.id)
                .pipe(Effect.mapError(threadManagementFailure)),
              scope.providerInstanceId,
            )
          : parent.thread.archivedAt === null &&
            callerRun?.providerInstanceId === scope.providerInstanceId;
      if (!liveCaller) {
        return yield* failure(
          "parent_not_active",
          "The calling provider no longer owns an active thread run.",
        );
      }
    });

  const assertLiveCallerForOtherProject = (
    scope: McpInvocationScope,
    parent: Pick<OrchestrationV2ThreadProjection, "thread" | "runs">,
    projectId: ProjectId,
  ) => (projectId === parent.thread.projectId ? Effect.void : assertLiveCaller(scope, parent));

  const loadWritableThread = (scope: McpInvocationScope, threadId: ThreadId) =>
    Effect.gen(function* () {
      const { parent, target } = yield* loadScopedThread(scope, threadId);
      if (parent.thread.deletedAt !== null) {
        return yield* failure("thread_not_found", "The calling thread was not found.");
      }
      yield* assertLiveCaller(scope, parent);
      yield* resolveRuntimeMode(parent.thread.runtimeMode, target.thread.runtimeMode);
      yield* resolveInteractionMode(parent.thread.interactionMode, target.thread.interactionMode);

      return { parent, target } as const;
    });

  const loadReadableThread = (scope: McpInvocationScope, threadId: ThreadId) =>
    Effect.gen(function* () {
      yield* requireCapability(scope);
      const parent = yield* loadProjection(scope.threadId);
      const shell = yield* loadThreadShell(threadId);
      const target = yield* threadManagement
        .getProjectThreadRecords({ projectId: shell.projectId, threadId }, [
          "runs",
          "providerTurns",
          "runtimeRequests",
          "contextTransfers",
        ])
        .pipe(Effect.mapError(threadManagementFailure));
      return { parent, target, shell } as const;
    });

  const loadProviders = providerRegistry.getProviders;

  /**
   * Instance ids the adapter registry resolves — the same lookup a
   * `delegated_task.request` performs when it runs. Capability reporting and
   * target resolution must not advertise a set narrower (or wider) than what
   * dispatch can actually serve.
   */
  const loadOrchestrationCapableInstanceIds = () =>
    providerAdapters.list().pipe(Effect.map((instanceIds) => new Set(instanceIds)));

  /**
   * Provider snapshots only re-probe while a client is in the foreground, so an
   * unattended agent can see a provider as unavailable after it was fixed.
   * Re-probe the requested instance once before refusing it.
   */
  const resolveTargetRechecking = (input: Parameters<typeof resolveTarget>[0]) => {
    const instanceId =
      input.target?.providerInstanceId ??
      (input.target?.driverKind === undefined
        ? input.parent.thread.modelSelection.instanceId
        : undefined);
    const resolved = resolveTarget(input);
    if (
      instanceId === undefined ||
      input.providers.find((provider) => provider.instanceId === instanceId)?.enabled !== true
    )
      return resolved;
    return resolved.pipe(
      Effect.catchIf(
        (error) => error.code === "provider_unavailable",
        (error) =>
          Effect.gen(function* () {
            if (!(yield* loadOrchestrationCapableInstanceIds()).has(instanceId))
              return yield* Effect.fail(error);
            const providers = yield* providerRegistry.refreshInstance(instanceId);
            return yield* resolveTarget({ ...input, providers });
          }),
      ),
    );
  };

  const resolveTarget = (input: {
    readonly parent: Pick<OrchestrationV2ThreadProjection, "thread">;
    readonly target: OrchestratorMcpTarget | undefined;
    readonly providers: ReadonlyArray<ServerProvider>;
  }): Effect.Effect<ResolvedTarget, OrchestratorMcpFailure> =>
    Effect.gen(function* () {
      const requestedInstanceId = input.target?.providerInstanceId;
      const requestedDriver = input.target?.driverKind;
      const orchestrationCapableInstanceIds = yield* loadOrchestrationCapableInstanceIds();
      let instanceId = requestedInstanceId;

      if (instanceId === undefined && requestedDriver !== undefined) {
        const candidates = input.providers.filter(
          (provider) =>
            provider.driver === requestedDriver &&
            orchestrationCapableInstanceIds.has(provider.instanceId),
        );
        if (candidates.length === 0) {
          return yield* failure(
            "provider_unavailable",
            `No V2 provider adapter is registered for driver ${requestedDriver}.`,
          );
        }
        // Inherit the parent's instance only when it can actually serve the
        // child; an unavailable parent yields to a healthy instance of the
        // requested driver rather than failing the delegation.
        const inheritedCandidate = candidates.find(
          (candidate) =>
            candidate.instanceId === input.parent.thread.modelSelection.instanceId &&
            providerConstraints(candidate, true).length === 0,
        );
        const availableCandidate = candidates.find(
          (candidate) => providerConstraints(candidate, true).length === 0,
        );
        instanceId = inheritedCandidate?.instanceId ?? availableCandidate?.instanceId;
        if (instanceId === undefined) {
          return yield* failure(
            "provider_unavailable",
            `No available V2 provider instance for driver ${requestedDriver}.`,
          );
        }
      }
      instanceId ??= input.parent.thread.modelSelection.instanceId;

      const provider = input.providers.find((candidate) => candidate.instanceId === instanceId);
      if (provider === undefined) {
        return yield* failure(
          "provider_unavailable",
          `Provider instance ${instanceId} is not registered.`,
        );
      }
      if (requestedDriver !== undefined && provider.driver !== requestedDriver) {
        return yield* failure(
          "invalid_request",
          `Provider instance ${instanceId} uses driver ${provider.driver}, not ${requestedDriver}.`,
        );
      }
      const constraints = providerConstraints(
        provider,
        orchestrationCapableInstanceIds.has(provider.instanceId),
      );
      if (constraints.length > 0) {
        return yield* failure(
          "provider_unavailable",
          `Provider ${instanceId} cannot run a child task: ${constraints.join(" ")}`,
        );
      }

      const inheritedSelection = input.parent.thread.modelSelection;
      const requestedModel = input.target?.model;
      const model =
        requestedModel ??
        (instanceId === inheritedSelection.instanceId
          ? inheritedSelection.model
          : provider?.models[0]?.slug);
      if (model === undefined) {
        return yield* failure(
          "model_unavailable",
          `Provider ${instanceId} has no model available for inheritance.`,
        );
      }
      if (
        requestedModel !== undefined &&
        provider !== undefined &&
        provider.models.length > 0 &&
        !provider.models.some((candidate) => candidate.slug === requestedModel)
      ) {
        return yield* failure(
          "model_unavailable",
          `Model ${requestedModel} is not advertised by provider ${instanceId}.`,
        );
      }

      const descriptors = provider.models.find((candidate) => candidate.slug === model)
        ?.capabilities?.optionDescriptors;
      const requestedOptions = withLegacyUltracodeEffort(descriptors, input.target?.options);
      if (requestedOptions !== undefined) {
        const invalid = invalidOptionSelections(requestedOptions, descriptors);
        if (invalid.length > 0) {
          return yield* failure(
            "invalid_request",
            `Model ${model} on provider ${instanceId} rejected options: ${invalid.join(" ")}`,
          );
        }
      }

      // A new task inherits reasoning, but speed requires its own opt-in.
      const options =
        requestedOptions ??
        (instanceId === inheritedSelection.instanceId && model === inheritedSelection.model
          ? withLegacyUltracodeEffort(descriptors, inheritedSelection.options)?.filter(
              (option) => option.id !== "fastMode" && option.id !== "serviceTier",
            )
          : undefined);
      return {
        modelSelection: { instanceId, model, ...(options === undefined ? {} : { options }) },
      };
    });

  const requestKey = (clientRequestId: string | undefined): Effect.Effect<string> =>
    clientRequestId === undefined
      ? crypto.randomUUIDv4.pipe(Effect.orDie)
      : Effect.succeed(clientRequestId);

  const readTask = (
    scope: McpInvocationScope,
    taskId: NodeId,
    waitTimedOut = false,
    acknowledgeTerminal = false,
    acknowledgementOperation = "task-status-acknowledge",
  ): Effect.Effect<OrchestratorMcpDelegateTaskResult, OrchestratorMcpFailure> =>
    Effect.gen(function* () {
      yield* requireCapability(scope);
      const parentProjection = yield* loadProjection(scope.threadId);
      const task = parentProjection.subagents.find(
        (candidate) =>
          candidate.id === taskId &&
          candidate.origin === "app_owned" &&
          candidate.threadId === scope.threadId,
      );
      if (task === undefined || task.childThreadId === null) {
        return yield* failure(
          "task_not_found",
          `Delegated task ${taskId} does not belong to thread ${scope.threadId}.`,
        );
      }
      const childControls = yield* threadManagement
        .getThreadRecords(
          task.childThreadId,
          [
            "runs",
            "messages",
            "contextTransfers",
            "subagents",
            "providerThreads",
            "providerTurns",
            "runtimeRequests",
            "nodes",
          ],
          { messageRoles: ["user"] },
        )
        .pipe(Effect.mapError(threadManagementFailure));
      const childRun = delegatedTaskRun(childControls, task);
      const terminalRun = latestTerminalResultRun(childControls, childRun);
      const progress = delegatedTaskProgress(childControls);
      const taskResultRun =
        childRun?.delegatedTaskId === task.id
          ? childControls.runs
              .filter((run) => run.delegatedTaskId === task.id)
              .toSorted((a, b) => b.ordinal - a.ordinal)[0]
          : progress.resultRun;
      const taskWorkState = delegatedTaskProgressForTask(childControls, task.id).state;
      const resultRunIds = [
        ...new Set(
          [taskResultRun?.id, terminalRun?.id].filter((id): id is RunId => id !== undefined),
        ),
      ];
      const resultRecords = yield* threadManagement
        .getThreadRecords(task.childThreadId, ["messages", "turnItems"], {
          messageRoles: ["assistant"],
          messageRunIds: resultRunIds,
          turnItemRunIds: resultRunIds,
          turnItemTypes: ["assistant_message", "error"],
        })
        .pipe(Effect.mapError(threadManagementFailure));
      const childProjection = {
        ...childControls,
        messages: [...childControls.messages, ...resultRecords.messages],
        turnItems: resultRecords.turnItems,
      };
      const heldForRestart =
        task.result === null &&
        taskWorkState === "result_available" &&
        (yield* threadManagement
          .delegatedTaskResultPending(task.childThreadId, childRun?.delegatedTaskId)
          .pipe(Effect.mapError(threadManagementFailure)));
      const workState =
        task.result !== null ? "result_available" : heldForRestart ? "working" : taskWorkState;
      const status =
        task.result !== null
          ? taskStatusForRun(
              task.status === "completed" ||
                task.status === "failed" ||
                task.status === "cancelled" ||
                task.status === "interrupted"
                ? { status: task.status }
                : childRun,
            )
          : workState === "result_available"
            ? taskStatusForRun(taskResultRun ?? childRun)
            : taskStatusForRun(taskResultRun ?? childRun) === "queued" ||
                taskStatusForRun(taskResultRun ?? childRun) === "starting"
              ? taskStatusForRun(taskResultRun ?? childRun)
              : "running";
      const derivedResult =
        task.result !== null
          ? task.result
          : taskResultRun !== undefined && isTerminalTaskStatus(status)
            ? subagentResultForRun(childProjection, taskResultRun).text
            : null;
      const resultTransfers = parentProjection.contextTransfers.filter(
        (transfer) =>
          transfer.type === "subagent_result" &&
          transfer.sourceThreadId === task.childThreadId &&
          transfer.targetThreadId === scope.threadId,
      );
      const resultTransferForRun = (run: OrchestrationV2Run | undefined) =>
        !canExposeTaskRunResult(run)
          ? null
          : (resultTransfers.find((transfer) => transfer.sourcePoint.runId === run.id) ??
            (run.id === childRun?.id
              ? resultTransfers.find((transfer) => transfer.sourcePoint.runId === undefined)
              : undefined) ??
            null);
      const resultTransfer = taskResultTransfer(parentProjection, childProjection, task) ?? null;
      const terminalStatus = terminalRun === undefined ? null : taskStatusForRun(terminalRun);
      const activeChildRun = ThreadManagementService.latestActiveRun(childControls);
      const taskOwnsActiveRun =
        activeChildRun !== undefined &&
        (activeChildRun.delegatedTaskId === task.id ||
          (activeChildRun.delegatedTaskId === undefined &&
            childRun?.delegatedTaskId === undefined));
      const pendingQuestions =
        !isTerminalTaskStatus(status) && taskOwnsActiveRun
          ? childControls.runtimeRequests.filter(
              (request) =>
                request.kind === "user_input" &&
                request.status === "pending" &&
                request.responseCapability.type === "live",
            )
          : [];
      const hasPendingQuestion = pendingQuestions.some((request) =>
        childControls.nodes.some(
          (node) => node.id === request.nodeId && node.runId === activeChildRun?.id,
        ),
      );
      // The run whose model and options describe the task's work so far.
      const executionRun =
        task.result === null
          ? (taskResultRun ?? childRun)
          : (childControls.runs.find((run) => run.id === resultTransfer?.sourcePoint.runId) ??
            childRun);
      const modelSelection = executionRun?.modelSelection;
      const result = {
        taskId: task.id,
        childThreadId: task.childThreadId,
        link: threadLinkFor(scope, task.childThreadId, childControls.thread.title),
        childRunId: childRun?.id ?? null,
        childNodeId: task.id,
        status,
        workState,
        hasPendingChildRuns: hasPendingChildRuns(childProjection, childRun),
        providerInstanceId: modelSelection?.instanceId ?? task.providerInstanceId,
        model: modelSelection?.model ?? task.model,
        executedModel: runExecutedModel(childControls, executionRun),
        options: modelSelection?.options ?? [],
        summary: derivedResult,
        resultContextTransferId: resultTransfer?.id ?? null,
        latestTerminalRunId: terminalRun?.id ?? null,
        latestTerminalStatus:
          terminalStatus !== null && isTerminalTaskStatus(terminalStatus) ? terminalStatus : null,
        latestTerminalSummary: canExposeTaskRunResult(terminalRun)
          ? terminalRun.id === childRun?.id
            ? derivedResult
            : subagentResultForRun(childProjection, terminalRun).text
          : null,
        latestTerminalResultContextTransferId: resultTransferForRun(terminalRun)?.id ?? null,
        hasPendingQuestion,
        pendingApproval:
          isTerminalTaskStatus(status) || task.completionDelivery?.state === "disposed"
            ? null
            : pendingTaskApproval(childControls, task.id, childRun),
        waitTimedOut,
      } satisfies OrchestratorMcpDelegateTaskResult;
      // A running task wakes this thread when it ends, so the agent need not wait on it.
      const response: OrchestratorMcpDelegateTaskResult =
        endsTaskWait(result) || task.completionDelivery?.state === "disposed"
          ? result
          : { ...result, next: ORCHESTRATOR_MCP_RUNNING_TASK_NEXT };
      if (
        acknowledgeTerminal &&
        isTerminalTaskStatus(status) &&
        task.completionDelivery?.state !== "acknowledged" &&
        task.completionDelivery?.state !== "disposed"
      ) {
        const observingRun = ThreadManagementService.latestActiveRun(parentProjection);
        const acknowledgementRequestKey = yield* requestKey(undefined);
        yield* threadManagement
          .dispatch({
            type: "delegated_task.completion-delivery.acknowledge",
            commandId: stableCommandId({
              scope,
              requestKey: acknowledgementRequestKey,
              operation: acknowledgementOperation,
            }),
            parentThreadId: scope.threadId,
            taskId,
            observedByRunId:
              observingRun?.providerInstanceId === scope.providerInstanceId
                ? observingRun.id
                : null,
          })
          .pipe(
            Effect.mapError((error) =>
              failure(
                "orchestration_error",
                `Unable to acknowledge delegated task ${taskId}: ${errorMessage(error)}`,
              ),
            ),
          );
      }
      return response;
    });

  // Re-read the task only when an event on the parent or child thread can
  // change its status, instead of polling the projections every 50 ms.
  const waitForTask = (scope: McpInvocationScope, taskId: NodeId, timeoutMs: number) =>
    Effect.gen(function* () {
      const streamError = (error: unknown) =>
        failure(
          "orchestration_error",
          `Unable to watch delegated task ${taskId}: ${errorMessage(error)}`,
        );
      // Sequences are global, so one cursor taken before the first read
      // replays anything either thread records after it.
      const afterSequence = yield* threadManagement
        .getThreadEventSequence(scope.threadId)
        .pipe(Effect.mapError(streamError));
      const initial = yield* readTask(scope, taskId, false, true);
      if (endsTaskWait(initial)) return Option.some(initial);
      // One stream per event type, so transcript events never fill a buffer.
      return yield* Stream.mergeAll(
        TASK_WAKE_EVENTS.map(({ thread, eventType }) =>
          threadManagement.streamStoredEventsFrom({
            threadId: thread === "parent" ? scope.threadId : initial.childThreadId,
            afterSequence,
            eventType,
          }),
        ),
        { concurrency: "unbounded" },
      ).pipe(
        Stream.mapError(streamError),
        Stream.mapEffect((stored) =>
          stored.event.type === "thread.deleted"
            ? Effect.fail(failure("thread_not_found", "The conversation was deleted."))
            : readTask(scope, taskId, false, true),
        ),
        Stream.filter(endsTaskWait),
        Stream.runHead,
      );
    }).pipe(Effect.timeoutOption(Duration.millis(timeoutMs)), Effect.map(Option.flatten));

  /** The modes a task's runs execute at: its own, and its bound thread's while that thread exists. */
  const scheduledTaskRunModes = (task: ScheduledTask) =>
    Effect.gen(function* () {
      const modes: Array<{
        readonly runtimeMode: RuntimeMode;
        readonly interactionMode: ProviderInteractionMode;
      }> = [{ runtimeMode: task.runtimeMode, interactionMode: task.interactionMode }];
      if (task.threadId === null) return modes;
      const bound = yield* threadManagement
        .getThreadShell(task.threadId)
        .pipe(Effect.mapError(threadManagementFailure));
      return bound === null || bound.deletedAt !== null ? modes : [...modes, bound];
    });

  /**
   * A scheduled task the caller may change: tasks in every project are in reach, as threads are,
   * but only ones whose runs execute at modes no broader than the caller's own, so editing its
   * prompt cannot run work above the caller's limits.
   */
  const loadScheduledTask = (
    scheduledTaskId: ScheduledTask["id"],
    limits: {
      readonly runtimeMode: RuntimeMode;
      readonly interactionMode: ProviderInteractionMode;
    },
  ): Effect.Effect<ScheduledTask, OrchestratorMcpFailure> =>
    Effect.gen(function* () {
      const { tasks } = yield* scheduledTasks
        .list()
        .pipe(
          Effect.mapError((error) =>
            failure("orchestration_error", `Could not load scheduled task: ${error.message}`),
          ),
        );
      const task = tasks.find((candidate) => candidate.id === scheduledTaskId);
      if (task === undefined) {
        return yield* failure("task_not_found", `Scheduled task ${scheduledTaskId} was not found.`);
      }
      for (const modes of yield* scheduledTaskRunModes(task)) {
        yield* resolveRuntimeMode(limits.runtimeMode, modes.runtimeMode);
        yield* resolveInteractionMode(limits.interactionMode, modes.interactionMode);
      }
      return task;
    });

  const requireProject = (projectId: ProjectId) =>
    projects.getById(projectId).pipe(
      Effect.mapError(() => failure("orchestration_error", "Unable to read the project.")),
      Effect.flatMap((project) =>
        Option.isNone(project)
          ? Effect.fail(failure("invalid_request", `Project ${projectId} was not found.`))
          : Effect.succeed(project.value),
      ),
    );

  const refExists = (cwd: string, revision: string) =>
    gitDriver.resolveCommit({ cwd, revision }).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );

  /** The project's default branch, as a bare name: launch fetches it from origin itself. */
  const resolveScheduledTaskBaseRef = (cwd: string) =>
    Effect.gen(function* () {
      const conventional = ["main", "master"];
      const remoteName = yield* gitDriver
        .resolvePrimaryRemoteName(cwd)
        .pipe(Effect.orElseSucceed(() => null));
      if (remoteName !== null) {
        const remoteDefault = yield* gitDriver
          .resolveDefaultBranchName(cwd, remoteName)
          .pipe(Effect.orElseSucceed(() => null));
        // Fetch does not update a recorded HEAD, so it can outlive the branch it names.
        for (const branch of remoteDefault === null
          ? conventional
          : [remoteDefault, ...conventional]) {
          if (yield* refExists(cwd, `refs/remotes/${remoteName}/${branch}`)) return branch;
        }
      }
      // Local-only repositories, or a remote with neither a usable HEAD nor a conventional branch.
      for (const branch of conventional) {
        if (yield* refExists(cwd, `refs/heads/${branch}`)) return branch;
      }
      return "main";
    });

  /**
   * Bound runs post into the existing thread (the strategy is unused, keep root); unbound runs
   * launch a fresh worktree per run from the project's default branch.
   */
  const scheduledTaskWorkspaceStrategy = (boundToThread: boolean, projectId: ProjectId) =>
    Effect.gen(function* () {
      if (boundToThread) return { type: "root" } satisfies ScheduledTask["workspaceStrategy"];
      const { workspaceRoot } = yield* requireProject(projectId);
      return {
        type: "worktree",
        baseRef: yield* resolveScheduledTaskBaseRef(workspaceRoot),
        startFromOrigin: true,
      } satisfies ScheduledTask["workspaceStrategy"];
    });

  const createScheduledTask = (
    scope: McpInvocationScope,
    input: OrchestratorMcpSaveScheduledTaskInput & {
      readonly prompt: string;
      readonly schedule: NonNullable<OrchestratorMcpSaveScheduledTaskInput["schedule"]>;
    },
  ) =>
    Effect.gen(function* () {
      yield* requireCapability(scope);
      const parent = yield* loadProjection(scope.threadId);
      const runtimeMode = yield* resolveSpawnRuntimeMode(parent.thread.runtimeMode, undefined);
      const projectId = input.projectId ?? parent.thread.projectId;
      const ownProject = projectId === parent.thread.projectId;
      if (!ownProject) yield* requireProject(projectId);
      yield* assertLiveCallerForOtherProject(scope, parent, projectId);
      // This thread lives in its own project, so a task for another project runs in new threads.
      const bindToCurrentThread = input.bindToCurrentThread ?? ownProject;
      if (bindToCurrentThread && !ownProject) {
        return yield* failure(
          "invalid_request",
          "A task for another project cannot post to this thread. Leave out `bindToCurrentThread`.",
        );
      }
      if (input.freshSession === true && !bindToCurrentThread) {
        return yield* failure(
          "invalid_request",
          "`freshSession` needs a task bound to this thread. Unbound runs already start in new threads.",
        );
      }
      const derivedTitle = input.prompt.split("\n")[0]?.trim() ?? "";
      const title =
        input.title ?? (derivedTitle.length > 0 ? derivedTitle.slice(0, 80) : "Scheduled task");
      const upsertInput: ScheduledTaskUpsertInput = {
        title,
        prompt: input.prompt,
        enabled: input.enabled ?? true,
        schedule: input.schedule,
        projectId,
        threadId: bindToCurrentThread ? scope.threadId : null,
        workspaceStrategy: yield* scheduledTaskWorkspaceStrategy(bindToCurrentThread, projectId),
        modelSelection: parent.thread.modelSelection,
        runtimeMode,
        interactionMode: parent.thread.interactionMode,
        createdBy: "agent",
        creationSource: "mcp",
        ...(input.freshSession === undefined ? {} : { freshSession: input.freshSession }),
        // Scope the idempotency key by provider session so two callers
        // reusing the same clientRequestId cannot collide on one task row.
        ...(input.clientRequestId === undefined
          ? {}
          : {
              commandId: stableCommandId({
                scope,
                requestKey: input.clientRequestId,
                operation: "schedule-task",
              }),
            }),
      };
      const { task } = yield* scheduledTasks
        .upsert(upsertInput)
        .pipe(
          Effect.mapError((error) =>
            failure("orchestration_error", `Could not schedule task: ${error.message}`),
          ),
        );
      return scheduledTaskSummary(task);
    });

  const updateScheduledTask = (
    scope: McpInvocationScope,
    input: OrchestratorMcpSaveScheduledTaskInput & {
      readonly scheduledTaskId: ScheduledTask["id"];
    },
  ) =>
    Effect.gen(function* () {
      yield* requireCapability(scope);
      const parent = yield* loadProjection(scope.threadId);
      const existing = yield* loadScheduledTask(input.scheduledTaskId, parent.thread);
      yield* assertLiveCallerForOtherProject(scope, parent, existing.projectId);
      if (input.projectId !== undefined && input.projectId !== existing.projectId) {
        return yield* failure(
          "invalid_request",
          "A scheduled task stays in its project. Create a new task for the other project.",
        );
      }
      if (input.bindToCurrentThread === true && existing.projectId !== parent.thread.projectId) {
        return yield* failure(
          "invalid_request",
          "This task belongs to another project, so it cannot post to this thread.",
        );
      }
      const threadId =
        input.bindToCurrentThread === undefined
          ? existing.threadId
          : input.bindToCurrentThread
            ? scope.threadId
            : null;
      // Rebinding changes where runs execute, so the workspace strategy must
      // follow: unbinding a root-strategy task would otherwise run loose
      // prompts in the shared project checkout.
      const workspaceStrategy =
        input.bindToCurrentThread === undefined
          ? existing.workspaceStrategy
          : yield* scheduledTaskWorkspaceStrategy(input.bindToCurrentThread, existing.projectId);
      if (input.freshSession === true && threadId === null) {
        return yield* failure(
          "invalid_request",
          "`freshSession` needs a task bound to a thread. Unbound runs already start in new threads.",
        );
      }
      const upsertInput: ScheduledTaskUpsertInput = {
        id: existing.id,
        title: input.title ?? existing.title,
        prompt: input.prompt ?? existing.prompt,
        enabled: input.enabled ?? existing.enabled,
        schedule: input.schedule ?? existing.schedule,
        projectId: existing.projectId,
        threadId,
        workspaceStrategy,
        modelSelection: existing.modelSelection,
        runtimeMode: existing.runtimeMode,
        interactionMode: existing.interactionMode,
        createdBy: existing.createdBy,
        creationSource: existing.creationSource,
        ...(input.freshSession === undefined ? {} : { freshSession: input.freshSession }),
      };
      const { task } = yield* scheduledTasks
        .upsert(upsertInput)
        .pipe(
          Effect.mapError((error) =>
            failure("orchestration_error", `Could not update scheduled task: ${error.message}`),
          ),
        );
      return scheduledTaskSummary(task);
    });

  return OrchestratorMcpService.of({
    saveScheduledTask: (scope, input) => {
      if (input.scheduledTaskId !== undefined) {
        return updateScheduledTask(scope, { ...input, scheduledTaskId: input.scheduledTaskId });
      }
      const { prompt, schedule } = input;
      return prompt === undefined || schedule === undefined
        ? Effect.fail(
            failure(
              "invalid_request",
              "A new scheduled task needs `prompt` and `schedule`. Pass `scheduledTaskId` to update one.",
            ),
          )
        : createScheduledTask(scope, { ...input, prompt, schedule });
    },
    scheduleTask: (scope, input) => createScheduledTask(scope, input),
    listScheduledTasks: (scope, input = {}) =>
      Effect.gen(function* () {
        yield* requireCapability(scope);
        const parent = yield* loadProjection(scope.threadId);
        const { tasks } = yield* scheduledTasks
          .list()
          .pipe(
            Effect.mapError((error) =>
              failure("orchestration_error", `Could not list scheduled tasks: ${error.message}`),
            ),
          );
        // One task by id from any project, else one project's tasks (the caller's by default).
        const projectId = input.projectId ?? parent.thread.projectId;
        return {
          tasks: tasks
            .filter((task) =>
              input.scheduledTaskId !== undefined
                ? task.id === input.scheduledTaskId &&
                  (input.projectId === undefined || task.projectId === input.projectId)
                : task.projectId === projectId,
            )
            .map(scheduledTaskSummary),
        };
      }),
    deleteScheduledTask: (scope, input) =>
      Effect.gen(function* () {
        yield* requireCapability(scope);
        const parent = yield* loadProjection(scope.threadId);
        const existing = yield* loadScheduledTask(input.scheduledTaskId, parent.thread);
        yield* assertLiveCallerForOtherProject(scope, parent, existing.projectId);
        yield* scheduledTasks
          .delete({ id: existing.id })
          .pipe(
            Effect.mapError((error) =>
              failure("orchestration_error", `Could not delete scheduled task: ${error.message}`),
            ),
          );
        return { scheduledTaskId: existing.id, deleted: true };
      }),
    requestSecret: (scope, input) =>
      Effect.gen(function* () {
        // The card is shown in, and answered from, the caller's own thread.
        const { parent } = yield* loadWritableThread(scope, scope.threadId);
        const threadId = scope.threadId;
        const run = ThreadManagementService.latestActiveRun(parent);
        if (
          run === undefined ||
          run.rootNodeId === null ||
          run.providerInstanceId !== scope.providerInstanceId
        ) {
          return yield* failure(
            "parent_not_active",
            "Asking for a secret requires an active run owned by this MCP provider session.",
          );
        }
        // A secret the user already pasted needs no card: it goes straight to a file.
        if (input.value !== undefined) {
          if (input.delivery === "secretRef") {
            return yield* failure(
              "invalid_request",
              'A pasted `value` is saved as a file. Leave out `delivery: "secretRef"`.',
            );
          }
          const file = yield* secretRequests
            .savePasted({
              threadId,
              requestNamespace: scope.providerSessionId,
              requestKey: yield* requestKey(input.clientRequestId),
              value: input.value,
            })
            .pipe(Effect.mapError((error) => failure("orchestration_error", error.message)));
          yield* Effect.annotateCurrentSpan({ "secret_request.status": "saved_pasted" });
          return { status: "saved" as const, file };
        }
        const runId = run.id;
        const nodeId = run.rootNodeId;
        const key = yield* requestKey(input.clientRequestId);
        // Turn item ids are global; scope the key to this thread. A retry with
        // the same clientRequestId finds this card, answered or not.
        const turnItemId = TurnItemId.make(
          `turn-item:secret-request:${stablePart(threadId)}:${stablePart(key)}`,
        );
        const record = (secretStatus: "pending" | "cancelled") =>
          threadManagement
            .dispatch({
              type: "secret_request.record",
              commandId: stableCommandId({
                scope,
                requestKey: key,
                operation: `secret-${secretStatus}`,
              }),
              threadId: threadId,
              runId,
              nodeId,
              turnItemId,
              label: input.label,
              reason: input.reason,
              ...(input.url === undefined ? {} : { url: input.url }),
              ...(input.placeholder === undefined ? {} : { placeholder: input.placeholder }),
              ...(input.delivery === "file" ? { delivery: "file" as const } : {}),
              secretStatus,
            })
            .pipe(
              Effect.mapError((error) =>
                failure(
                  "orchestration_error",
                  `Could not record the secret request: ${errorMessage(error)}`,
                ),
              ),
            );
        yield* record("pending");
        // Only this call can hand the agent its ref, so the card must not
        // outlive it: a timeout, a failed wait or an aborted call closes it as
        // cancelled. If even that fails, the server still refuses an answer
        // once the run ends, and an unused value expires.
        const closeCard = record("cancelled").pipe(
          Effect.catch((error) =>
            Effect.logWarning("Could not close a secret request card", { error: error.message }),
          ),
        );

        // The user answers the card (secrets.answerRequest), or it ends with
        // the run; poll it like a delegated task.
        const answered = yield* Effect.gen(function* () {
          while (true) {
            const projection = yield* threadManagement
              .getThreadRecords(threadId, ["runs", "turnItems"], {
                turnItemTypes: ["secret_request"],
                messageRoles: [],
              })
              .pipe(
                Effect.mapError((error) =>
                  failure(
                    "orchestration_error",
                    `Unable to read the secret request: ${errorMessage(error)}`,
                  ),
                ),
              );
            const item = projection.turnItems.find((candidate) => candidate.id === turnItemId);
            if (item?.type === "secret_request" && item.secretStatus !== "pending") {
              return item.secretStatus;
            }
            const current = projection.runs.find((candidate) => candidate.id === runId);
            if (
              current === undefined ||
              ThreadManagementService.isTerminalRunStatus(current.status)
            ) {
              yield* record("cancelled");
              return "cancelled" as const;
            }
            yield* Effect.sleep(Duration.millis(500));
          }
        }).pipe(
          Effect.timeoutOption(
            Duration.millis(
              Math.min(
                input.timeoutMs ?? DEFAULT_SECRET_REQUEST_TIMEOUT_MS,
                MAX_SECRET_REQUEST_TIMEOUT_MS,
              ),
            ),
          ),
          Effect.onExit((exit) => (Exit.isSuccess(exit) ? Effect.void : closeCard)),
        );
        if (Option.isNone(answered)) yield* closeCard;
        // An answer that raced the timeout still wins: the card is answered once.
        const status = Option.isSome(answered)
          ? answered.value
          : yield* threadManagement
              .getThreadRecords(threadId, ["turnItems"], {
                turnItemTypes: ["secret_request"],
                messageRoles: [],
              })
              .pipe(
                Effect.map((records) => {
                  const item = records.turnItems.find((candidate) => candidate.id === turnItemId);
                  return item?.type === "secret_request" &&
                    (item.secretStatus === "saved" || item.secretStatus === "declined")
                    ? item.secretStatus
                    : ("timed_out" as const);
                }),
                Effect.orElseSucceed(() => "timed_out" as const),
              );
        yield* Effect.annotateCurrentSpan({ "secret_request.status": status });
        if (status !== "saved") return { status, note: SECRET_REQUEST_UNSAVED_NOTE[status] };
        if (input.delivery === "file") {
          const file = yield* secretRequests
            .saveToFile({ threadId, turnItemId })
            .pipe(Effect.mapError((error) => failure("orchestration_error", error.message)));
          return { status, file };
        }
        // Saved means the value was stored before the card said so; a missing
        // value is a storage fault, not an answer the agent can act on.
        const secretRef = yield* secretRequests.savedRef({ threadId: threadId, turnItemId });
        if (Option.isNone(secretRef)) {
          return yield* failure(
            "orchestration_error",
            "The user saved the secret, but it could not be read. Ask again with a new clientRequestId.",
          );
        }
        return { status, secretRef: secretRef.value };
      }).pipe(Effect.withSpan("OrchestratorMcpService.requestSecret")),

    capabilities: (scope, input = {}) =>
      Effect.gen(function* () {
        yield* requireCapability(scope);
        const parent = yield* loadProjection(scope.threadId);
        const providers = yield* loadProviders;
        const orchestrationCapableInstanceIds = yield* loadOrchestrationCapableInstanceIds();
        const inherited = parent.thread.modelSelection;
        const searchTerms = input.search?.toLowerCase().split(/\s+/).filter(Boolean) ?? [];
        return {
          parentThreadId: scope.threadId,
          inheritedProviderInstanceId: inherited.instanceId,
          inheritedModel: inherited.model,
          inheritedOptions:
            knownOptions(
              inherited.options,
              providers
                .find((provider) => provider.instanceId === inherited.instanceId)
                ?.models.find((model) => model.slug === inherited.model)?.capabilities
                ?.optionDescriptors,
            ) ?? [],
          runtimeMode: parent.thread.runtimeMode,
          interactionMode: parent.thread.interactionMode,
          providers: providers.map((provider) => {
            const constraints = providerConstraints(
              provider,
              orchestrationCapableInstanceIds.has(provider.instanceId),
            );
            const { listed, omitted } = listCapabilityModels({
              provider,
              searchTerms,
              isPinned: (model) =>
                model.isCustom ||
                (inherited.instanceId === provider.instanceId && inherited.model === model.slug),
            });
            return {
              providerInstanceId: provider.instanceId,
              driverKind: provider.driver,
              displayName: provider.displayName ?? null,
              models: listed.map((model) => {
                const options = model.capabilities?.optionDescriptors ?? [];
                return {
                  id: model.slug,
                  ...(model.name.toLowerCase() === model.slug.toLowerCase()
                    ? {}
                    : { label: model.name }),
                  ...(options.length === 0 ? {} : { options: options.map(capabilityModelOption) }),
                };
              }),
              ...(omitted === 0 ? {} : { omittedModels: omitted }),
              ...(provider.supportedRuntimeModes === undefined ||
              provider.supportedRuntimeModes.length === 0
                ? {}
                : { runtimeModes: [...provider.supportedRuntimeModes] }),
              canRunChildTask: constraints.length === 0,
              canRunCrossProviderChildTask: constraints.length === 0,
              constraints: [...constraints],
            };
          }),
          features: {
            appOwnedSubagents: true,
            asyncPolling: true,
            cancellation: true,
            batchThreadCreation: true,
            threadManagement: true,
            incrementalThreadRead: true,
            scheduledTasks: true,
            maxBatchThreads: 20,
          },
        };
      }),
    delegateTask: (scope, input) =>
      Effect.gen(function* () {
        yield* requireCapability(scope);
        const parent = yield* loadProjection(scope.threadId);
        const parentRun = parent.runs
          .filter(ThreadManagementService.isActiveRun)
          .reduce<OrchestrationV2Run | undefined>(
            (latest, run) => (latest === undefined || runRanAfter(run, latest) ? run : latest),
            undefined,
          );
        if (
          parentRun === undefined ||
          parentRun.rootNodeId === null ||
          parentRun.providerInstanceId !== scope.providerInstanceId
        ) {
          return yield* failure(
            "parent_not_active",
            "Delegated tasks require an active run owned by this MCP provider session.",
          );
        }
        const providers = yield* loadProviders;
        const target = yield* resolveTargetRechecking({
          parent,
          target: input.target,
          providers,
        });
        const runtimeMode = yield* resolveSpawnRuntimeMode(
          parent.thread.runtimeMode,
          input.runtimeMode,
        );
        const interactionMode = yield* resolveInteractionMode(
          parent.thread.interactionMode,
          input.interactionMode,
        );
        const key = yield* requestKey(input.clientRequestId);
        const commandId = stableCommandId({
          scope,
          requestKey: key,
          operation: "delegate-task",
        });
        const command = {
          type: "delegated_task.request",
          createdBy: "agent",
          creationSource: "mcp",
          commandId,
          parentThreadId: scope.threadId,
          parentRunId: parentRun.id,
          parentNodeId: parentRun.rootNodeId,
          task: taskPrompt(input),
          ...(input.title === undefined ? {} : { title: input.title }),
          modelSelection: target.modelSelection,
          runtimeMode,
          interactionMode,
          // Async delegations wake the parent on every child terminal; wait
          // delegations deliver through the blocking tool call, so a wake is
          // only needed if the parent settled first (timeout, disconnect).
          completionWake: input.mode === "wait" ? "settled_only" : "always",
        } satisfies Extract<OrchestrationV2Command, { readonly type: "delegated_task.request" }>;
        const previous =
          input.isolation === "worktree"
            ? yield* threadManagement
                .getCommandResult(command)
                .pipe(Effect.mapError(threadManagementFailure))
            : Option.none();
        let workspaceStrategy: ThreadLaunchService.ThreadLaunchWorkspaceStrategy | undefined;
        if (input.isolation === "worktree" && Option.isNone(previous)) {
          const project = yield* projects
            .getById(parent.thread.projectId)
            .pipe(
              Effect.mapError(() =>
                failure("invalid_request", "Unable to read the parent project."),
              ),
            );
          if (Option.isNone(project))
            return yield* failure("invalid_request", "The parent project was not found.");
          // Across several repositories no one commit names them all: each starts from the
          // parent's branch where it has one, so the child sees the parent's committed work.
          if (
            yield* taskFolders.covers({
              workspaceRoot: project.value.workspaceRoot,
              addedFolders: project.value.addedFolders ?? [],
            })
          ) {
            // A parent in its own task folder hands down the repositories it works in.
            const parentTaskFolder =
              parent.thread.worktreePath === null
                ? Option.none()
                : yield* taskFolders.find(parent.thread.worktreePath);
            workspaceStrategy = {
              type: "worktree",
              baseRef: parent.thread.branch ?? "HEAD",
              startFromOrigin: false,
              ...(Option.isSome(parentTaskFolder)
                ? {
                    repositories: parentTaskFolder.value.repositories.map((repository) => ({
                      path: repository.repositoryPath,
                    })),
                  }
                : {}),
            };
          } else {
            const base = yield* gitDriver
              .resolveCommit({
                cwd: parent.thread.worktreePath ?? project.value.workspaceRoot,
                revision: "HEAD",
              })
              .pipe(
                Effect.mapError(() =>
                  failure(
                    "invalid_request",
                    "Unable to resolve the parent checkout commit. Worktree isolation requires a Git repository with a commit.",
                  ),
                ),
              );
            workspaceStrategy = {
              type: "worktree",
              baseRef: base.commitSha,
              startFromOrigin: false,
            };
          }
        }
        const result = Option.isSome(previous)
          ? previous.value
          : yield* threadManagement
              .dispatch({
                ...command,
                ...(workspaceStrategy === undefined ? {} : { workspaceStrategy }),
                ...(input.runSetupScript === undefined
                  ? {}
                  : { runSetupScript: input.runSetupScript }),
              })
              .pipe(
                Effect.mapError((error) =>
                  failure(
                    "orchestration_error",
                    `Unable to create delegated task: ${errorMessage(error)}`,
                  ),
                ),
              );
        const taskEvent = result.storedEvents.find(
          (stored) =>
            stored.event.type === "subagent.updated" && stored.event.payload.origin === "app_owned",
        );
        if (taskEvent?.event.type !== "subagent.updated") {
          return yield* failure(
            "orchestration_error",
            "Delegated task command did not produce a task projection.",
          );
        }
        const taskId = taskEvent.event.payload.id;
        const childThreadId = taskEvent.event.payload.childThreadId;
        const childRun = result.storedEvents.find(
          (stored) =>
            stored.event.type === "run.created" && stored.event.threadId === childThreadId,
        );
        if (
          childThreadId !== null &&
          childRun?.event.type === "run.created" &&
          childRun.event.payload.workspacePreparation !== undefined
        ) {
          yield* threadLaunch.prepareRun({
            commandId,
            threadId: childThreadId,
            runId: childRun.event.payload.id,
          });
        }

        if (input.mode !== "wait") {
          return yield* readTask(scope, taskId, false, true);
        }
        const timeoutMs = Math.min(
          MAX_WAIT_TIMEOUT_MS,
          Math.max(1, input.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS),
        );
        const waited = yield* waitForTask(scope, taskId, timeoutMs);
        if (Option.isSome(waited) && isTerminalTaskStatus(waited.value.status)) {
          return waited.value;
        }
        // An incomplete wait gives up delivery: upgrade so a later terminal
        // wakes the parent even mid-turn. Best effort; settled_only still
        // wakes a settled parent if the upgrade fails.
        yield* threadManagement
          .dispatch({
            type: "delegated_task.wake-policy",
            commandId: stableCommandId({
              scope,
              requestKey: key,
              operation: "delegate-task-wake-policy",
            }),
            parentThreadId: scope.threadId,
            taskId,
            completionWake: "always",
          })
          .pipe(
            // The tool result still returns after a timeout or question, so failures
            // stay warnings. Keep the two shapes apart: a rejected receipt
            // means this exact command id already failed (a replay of a
            // no-op upgrade), while anything else is a fresh dispatch fault.
            Effect.catch((error) =>
              Effect.logWarning("orchestrator-mcp.delegate-task.wake-policy-failed", {
                taskId,
                outcome:
                  error._tag === "OrchestratorCommandPreviouslyRejectedError"
                    ? "previously_rejected"
                    : "dispatch_failed",
                error,
              }),
            ),
            Effect.catchCause((cause) =>
              Effect.logWarning("orchestrator-mcp.delegate-task.wake-policy-failed", {
                taskId,
                outcome: "defect",
                cause,
              }),
            ),
          );
        return yield* readTask(scope, taskId, Option.isNone(waited), true);
      }),
    taskStatus: (scope, taskId) => readTask(scope, taskId, false, true),
    cancelTask: (scope, input) =>
      Effect.gen(function* () {
        const current = yield* readTask(scope, input.taskId);
        const key = yield* requestKey(input.clientRequestId);
        const parentProjection = yield* loadProjection(scope.threadId);
        const parentTask = parentProjection.subagents.find(
          (task) => task.id === input.taskId && task.origin === "app_owned",
        );
        const disposeCompletionDelivery =
          parentTask?.completionDelivery?.state === "disposed"
            ? Effect.void
            : threadManagement
                .dispatch({
                  type: "delegated_task.completion-delivery.dispose",
                  commandId: stableCommandId({
                    scope,
                    requestKey: key,
                    operation: "cancel-task-completion-delivery",
                  }),
                  parentThreadId: scope.threadId,
                  taskId: input.taskId,
                })
                .pipe(
                  Effect.asVoid,
                  Effect.mapError((error) =>
                    failure(
                      "orchestration_error",
                      `Unable to dispose delegated task ${input.taskId} completion delivery: ${errorMessage(error)}`,
                    ),
                  ),
                );
        // Cancelling stops the child thread the way Stop does, including work that came
        // after a published result: follow-up runs, pull request watch wakes, and the
        // tasks it delegated. The published result stays terminal.
        const stopChild = Effect.gen(function* () {
          const commandId = stableCommandId({ scope, requestKey: key, operation: "cancel-task" });
          const reason = agentStopReason(input.reason);
          yield* threadManagement
            .dispatch({
              type: "thread.stop",
              commandId,
              threadId: current.childThreadId,
              reason,
            })
            .pipe(
              Effect.mapError((error) =>
                failure(
                  "task_not_cancellable",
                  `Unable to stop delegated task ${input.taskId}: ${errorMessage(error)}`,
                ),
              ),
            );
          // A retry with the same clientRequestId repeats only the stops that failed.
          yield* threadManagement
            .stopDelegatedTasks({ threadId: current.childThreadId, commandId, reason })
            .pipe(
              Effect.mapError((error) =>
                failure(
                  "task_not_cancellable",
                  `Stopped delegated task ${input.taskId}, but not every task it delegated: ${errorMessage(error)}`,
                ),
              ),
            );
        });
        if (isTerminalTaskStatus(current.status)) {
          yield* stopChild;
          yield* disposeCompletionDelivery;
          return {
            taskId: input.taskId,
            status: current.status,
          } satisfies OrchestratorMcpTaskCancelResult;
        }
        // A task waiting on its own delegates has work to stop below it. One with neither
        // a running turn nor delegates (such as one awaiting a restart) keeps its delivery.
        const child = yield* loadProjection(current.childThreadId);
        if (
          current.workState !== "waiting_for_children" &&
          ThreadManagementService.latestActiveRun(child) === undefined
        ) {
          return yield* failure(
            "task_not_cancellable",
            `Delegated task ${input.taskId} has no interruptible child run.`,
          );
        }
        yield* stopChild;
        yield* disposeCompletionDelivery.pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("orchestrator-mcp.cancel-task.delivery-dispose-failed", {
              taskId: input.taskId,
              cause,
            }),
          ),
        );
        return {
          taskId: input.taskId,
          status: "cancel_requested",
        };
      }),
    createThreads: (scope, input) =>
      Effect.gen(function* () {
        yield* requireCapability(scope);
        const parent = yield* loadProjection(scope.threadId);
        const parentRun = ThreadManagementService.latestActiveRun(parent);
        if (
          parentRun === undefined ||
          parentRun.rootNodeId === null ||
          parentRun.providerInstanceId !== scope.providerInstanceId
        ) {
          return yield* failure(
            "parent_not_active",
            "Thread creation requires an active run owned by this MCP provider session.",
          );
        }
        const parentNodeId = parentRun.rootNodeId;
        const providers = yield* loadProviders;
        const key = yield* requestKey(input.clientRequestId);
        const created = yield* Effect.forEach(
          input.threads,
          (request, index) =>
            Effect.gen(function* () {
              const target = yield* resolveTargetRechecking({
                parent,
                target: request.target,
                providers,
              });
              const runtimeMode = yield* resolveSpawnRuntimeMode(
                parent.thread.runtimeMode,
                request.runtimeMode,
              );
              const interactionMode = yield* resolveInteractionMode(
                parent.thread.interactionMode,
                request.interactionMode,
              );
              const threadId = stableThreadId({
                scope,
                requestKey: key,
                index,
              });
              const title = threadTitle({
                parentTitle: parent.thread.title,
                prompt: request.prompt,
                title: request.title,
                index,
              });
              yield* threadManagement
                .dispatch({
                  type: "thread.create",
                  createdBy: "agent",
                  creationSource: "mcp",
                  commandId: stableCommandId({
                    scope,
                    requestKey: key,
                    operation: "create-thread",
                    index,
                  }),
                  threadId,
                  projectId: parent.thread.projectId,
                  title,
                  modelSelection: target.modelSelection,
                  runtimeMode,
                  interactionMode,
                  branch: parent.thread.branch,
                  worktreePath: parent.thread.worktreePath,
                })
                .pipe(
                  Effect.mapError((error) =>
                    failure(
                      "orchestration_error",
                      `Unable to create thread ${index + 1}: ${errorMessage(error)}`,
                    ),
                  ),
                );
              if (request.prompt !== undefined) {
                yield* threadManagement
                  .dispatch({
                    type: "message.dispatch",
                    createdBy: "agent",
                    creationSource: "mcp",
                    commandId: stableCommandId({
                      scope,
                      requestKey: key,
                      operation: "dispatch-thread",
                      index,
                    }),
                    threadId,
                    senderThreadId: scope.threadId,
                    messageId: stableMessageId({
                      scope,
                      requestKey: key,
                      index,
                    }),
                    text: request.prompt,
                    attachments: [],
                    modelSelection: target.modelSelection,
                    dispatchMode: { type: "start_immediately" },
                  })
                  .pipe(
                    Effect.mapError((error) =>
                      failure(
                        "orchestration_error",
                        `Unable to start thread ${index + 1}: ${errorMessage(error)}`,
                      ),
                    ),
                  );
              }
              const projection = yield* loadProjection(threadId);
              const run = projection.runs.at(-1);
              yield* threadManagement
                .dispatch({
                  type: "thread.created.record",
                  commandId: stableCommandId({
                    scope,
                    requestKey: key,
                    operation: "record-created-thread",
                    index,
                  }),
                  parentThreadId: scope.threadId,
                  parentRunId: parentRun.id,
                  parentNodeId,
                  targetThreadId: threadId,
                  targetRunId: run?.id ?? null,
                })
                .pipe(
                  Effect.mapError((error) =>
                    failure(
                      "orchestration_error",
                      `Unable to record thread ${index + 1} in the parent timeline: ${errorMessage(error)}`,
                    ),
                  ),
                );
              return {
                threadId,
                link: threadLinkFor(scope, threadId, projection.thread.title),
                runId: run?.id ?? null,
                status: run?.status ?? "idle",
                title: projection.thread.title,
                createdBy: projection.thread.createdBy,
                creationSource: projection.thread.creationSource,
                providerInstanceId: target.modelSelection.instanceId,
                model: target.modelSelection.model,
              } satisfies OrchestratorMcpCreatedThread;
            }),
          { concurrency: 1 },
        );
        return { threads: created };
      }),
    listThreads: (scope, input) =>
      Effect.gen(function* () {
        yield* requireCapability(scope);
        const parent = yield* loadProjection(scope.threadId);
        const projectId =
          input.allProjects === true ? undefined : (input.projectId ?? parent.thread.projectId);
        const projectThreads = yield* threadManagement
          .listProjectThreads({
            projectId,
            includeSubagents: input.includeSubagents !== false,
          })
          .pipe(
            Effect.mapError((error) =>
              failure("orchestration_error", `Unable to list threads: ${errorMessage(error)}`),
            ),
          );
        const nowMs = yield* Clock.currentTimeMillis;
        const statuses = input.statuses === undefined ? null : new Set(input.statuses);
        const titleContains = input.titleContains?.toLocaleLowerCase();
        const filtered = projectThreads
          .filter((thread) => statuses === null || statuses.has(listedThreadStatus(thread)))
          .filter(
            (thread) =>
              input.settled === undefined || threadSettlement(thread).settled === input.settled,
          )
          .filter(
            (thread) => input.snoozed === undefined || isSnoozed(thread, nowMs) === input.snoozed,
          )
          .filter(
            (thread) =>
              titleContains === undefined ||
              thread.title.toLocaleLowerCase().includes(titleContains),
          );
        const cursor = input.cursor ?? 0;
        const limit = input.limit ?? DEFAULT_THREAD_LIST_LIMIT;
        const page = filtered.slice(cursor, cursor + limit);
        const nextCursor = cursor + page.length < filtered.length ? cursor + page.length : null;
        return {
          projectId: projectId ?? null,
          currentThreadId: scope.threadId,
          threads: page.map((shell) => listItemFromShell(scope, shell, nowMs)),
          nextCursor,
          total: filtered.length,
        } satisfies OrchestratorMcpThreadListResult;
      }),
    readThread: (scope, input) =>
      Effect.gen(function* () {
        const { parent, target, shell } = yield* loadReadableThread(scope, input.threadId);
        const view = input.view ?? "messages";
        const limit = input.limit ?? DEFAULT_THREAD_READ_LIMIT;
        const maxChars = input.maxCharsPerItem ?? DEFAULT_THREAD_ITEM_MAX_CHARS;
        // Without a cursor the newest page comes first; `earlierPosition` pages back from it.
        const newestFirst = input.beforePosition !== undefined || input.afterPosition === undefined;
        const timeline = yield* threadManagement
          .getTimelinePage(input.threadId, {
            ...(input.afterPosition === undefined ? {} : { afterPosition: input.afterPosition }),
            ...(newestFirst
              ? { beforePosition: input.beforePosition ?? Number.POSITIVE_INFINITY }
              : {}),
            limit,
            view,
            ...(input.itemId === undefined ? {} : { itemId: input.itemId }),
          })
          .pipe(Effect.mapError(threadManagementFailure));
        const page = timeline.items;
        const messageIdsByThread = new Map<ThreadId, Array<MessageId>>();
        for (const row of page) {
          if (row.item.type !== "user_message" && row.item.type !== "assistant_message") continue;
          const ids = messageIdsByThread.get(row.sourceThreadId) ?? [];
          ids.push(row.item.messageId);
          messageIdsByThread.set(row.sourceThreadId, ids);
        }
        const sourceMessages = yield* Effect.forEach(
          [...messageIdsByThread],
          ([threadId, messageIds]) =>
            threadManagement.getThreadRecords(threadId, ["messages"], { messageIds }).pipe(
              Effect.map((records) => [threadId, records.messages] as const),
              Effect.mapError(threadManagementFailure),
            ),
          { concurrency: 1 },
        );
        const messagesByThreadId = new Map(sourceMessages);
        const returnedRunIds = new Set(
          page
            .filter((row) => row.sourceThreadId === target.thread.id)
            .map((row) => row.item.runId),
        );
        const tasks = directAppOwnedChildTasks(parent, target, returnedRunIds);
        for (const task of (input.textOffset ?? 0) === 0 ? tasks : []) {
          const transfer = taskResultTransfer(parent, target, task);
          const resultRunId = transfer?.sourcePoint.runId ?? delegatedTaskRun(target, task)?.id;
          const resultRunIds = resultRunId === undefined ? [] : [resultRunId];
          const resultRecords = yield* threadManagement
            .getThreadRecords(target.thread.id, ["messages", "turnItems"], {
              messageRoles: ["assistant"],
              messageRunIds: resultRunIds,
              turnItemRunIds: resultRunIds,
              turnItemTypes: ["assistant_message", "error"],
            })
            .pipe(Effect.mapError(threadManagementFailure));
          if (
            pageIncludesTerminalTaskResult({
              parent,
              page,
              task,
              target: { ...target, ...resultRecords },
              maxChars,
            })
          ) {
            yield* readTask(scope, task.id, false, true, "thread-read-acknowledge");
          }
        }
        return {
          thread: threadDetail(
            scope,
            target,
            timeline.totalItems,
            shell,
            yield* Clock.currentTimeMillis,
          ),
          recentRuns: target.runs
            .toSorted((left, right) => right.ordinal - left.ordinal)
            .slice(0, input.runLimit ?? DEFAULT_THREAD_RUN_LIMIT)
            .map((run) => threadRun(target, run)),
          items: page.map((row) =>
            timelineItem({
              row,
              maxChars,
              messagesByThreadId,
              ...(input.itemId === undefined ? {} : { textOffset: input.textOffset ?? 0 }),
            }),
          ),
          nextPosition: page.at(-1)?.position ?? null,
          hasMore: timeline.hasMore,
          earlierPosition: timeline.hasEarlier ? (page[0]?.position ?? null) : null,
        } satisfies OrchestratorMcpThreadReadResult;
      }),
    sendToThread: (scope, input) =>
      Effect.gen(function* () {
        const { target } = yield* loadWritableThread(scope, input.threadId);

        const mode = input.mode ?? "auto";
        const key = yield* requestKey(input.clientRequestId);
        const messageId = stableOperationMessageId({
          scope,
          requestKey: key,
          operation: "thread-send",
        });
        const result = yield* threadManagement
          .sendToThread({
            projectId: target.thread.projectId,
            commandId: stableCommandId({
              scope,
              requestKey: key,
              operation: "thread-send",
            }),
            threadId: input.threadId,
            senderThreadId: scope.threadId,
            messageId,
            text: input.message,
            attachments: [],
            mode,
            ...(input.freshContext === true ? { freshContext: true } : {}),
            createdBy: "agent",
            creationSource: "mcp",
          })
          .pipe(
            Effect.mapError((error) =>
              isThreadManagementError(error)
                ? threadManagementFailure(error)
                : failure(
                    "orchestration_error",
                    `Unable to send to thread ${input.threadId}: ${errorMessage(error)}`,
                  ),
            ),
          );
        return {
          threadId: input.threadId,
          link: threadLinkFor(scope, input.threadId, target.thread.title),
          messageId,
          runId: result.run.id,
          ...(result.run.delegatedTaskId === undefined
            ? {}
            : { taskId: result.run.delegatedTaskId }),
          status: result.run.status,
          delivery: result.delivery,
        } satisfies OrchestratorMcpThreadSendResult;
      }),
    waitForThread: (scope, input) =>
      Effect.gen(function* () {
        const { parent, target } = yield* loadScopedThread(scope, input.threadId);
        const result = yield* threadManagement
          .waitForThread({
            projectId: target.thread.projectId,
            threadId: input.threadId,
            ...(input.runId === undefined ? {} : { runId: input.runId }),
            timeoutMs: Math.min(
              MAX_WAIT_TIMEOUT_MS,
              Math.max(1, input.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS),
            ),
            ...(input.untilDelegatedWorkSettled === true
              ? { untilDelegatedWorkSettled: true }
              : {}),
          })
          .pipe(Effect.mapError(threadManagementFailure));
        const status = result.run?.status ?? "idle";
        const taskId = result.run?.delegatedTaskId;
        // A task this thread delegated wakes it when it ends, so a timed-out wait need not repeat.
        // Read tasks and requests again: either can change while the wait runs.
        const ownedTask =
          result.timedOut &&
          status !== "waiting" &&
          taskId !== undefined &&
          (yield* threadManagement
            .getThreadRecords(parent.thread.id, ["subagents"])
            .pipe(Effect.mapError(threadManagementFailure))).subagents.some(
            (task) =>
              task.id === taskId &&
              task.origin === "app_owned" &&
              task.threadId === parent.thread.id &&
              task.childThreadId === input.threadId &&
              task.completionDelivery?.state !== "disposed",
          );
        // A child waiting on a question or approval needs an answer, not a wake.
        const childRequests = ownedTask
          ? (yield* threadManagement
              .getThreadRecords(input.threadId, ["runtimeRequests"])
              .pipe(Effect.mapError(threadManagementFailure))).runtimeRequests
          : [];
        const wakesCaller =
          ownedTask && !childRequests.some((request) => request.status === "pending");
        return {
          threadId: input.threadId,
          runId: result.run?.id ?? null,
          status,
          timedOut: result.timedOut,
          ...(wakesCaller ? { next: ORCHESTRATOR_MCP_RUNNING_TASK_NEXT } : {}),
          ...(result.resultRun === undefined
            ? {}
            : { resultRun: { runId: result.resultRun.id, status: result.resultRun.status } }),
        } satisfies OrchestratorMcpThreadWaitResult;
      }),
    interruptThread: (scope, input) =>
      Effect.gen(function* () {
        const { target } = yield* loadWritableThread(scope, input.threadId);
        const key = yield* requestKey(input.clientRequestId);
        if (input.stop === true) {
          const commandId = stableCommandId({ scope, requestKey: key, operation: "thread-stop" });
          const reason = agentStopReason(input.reason);
          const stopFailed = (error: unknown) =>
            failure(
              "orchestration_error",
              `Unable to stop thread ${input.threadId}: ${errorMessage(error)}`,
            );
          const stopped = yield* threadManagement
            .dispatch({ type: "thread.stop", commandId, threadId: input.threadId, reason })
            .pipe(Effect.mapError(stopFailed));
          // A retry with the same clientRequestId repeats only the stops that failed.
          yield* threadManagement
            .stopDelegatedTasks({ threadId: input.threadId, commandId, reason })
            .pipe(Effect.mapError(stopFailed));
          // The run this stop interrupted, from its own events, so a retry reports the same run
          // even if another has started since. Held queued runs are not the run it interrupted.
          const interrupted = stopped.storedEvents.find(
            ({ event }) =>
              (event.type === "run.updated" && event.payload.status === "interrupted") ||
              (event.type === "turn-item.updated" &&
                event.payload.type === "run_interrupt_request" &&
                event.payload.providerTurnId !== null),
          )?.event.runId;
          return {
            threadId: input.threadId,
            runId: interrupted ?? null,
            status: interrupted == null ? "no_active_run" : "interrupt_requested",
          } satisfies OrchestratorMcpThreadInterruptResult;
        }
        const result = yield* threadManagement
          .interruptThread({
            projectId: target.thread.projectId,
            commandId: stableCommandId({
              scope,
              requestKey: key,
              operation: "thread-interrupt",
            }),
            threadId: input.threadId,
            ...(input.runId === undefined ? {} : { runId: input.runId }),
            reason: agentStopReason(input.reason),
          })
          .pipe(
            Effect.mapError((error) =>
              isThreadManagementError(error)
                ? threadManagementFailure(error)
                : failure(
                    "orchestration_error",
                    `Unable to interrupt thread ${input.threadId}: ${errorMessage(error)}`,
                  ),
            ),
          );
        if (result.type === "no_active_run") {
          return {
            threadId: input.threadId,
            runId: null,
            status: "no_active_run",
          } satisfies OrchestratorMcpThreadInterruptResult;
        }
        return {
          threadId: input.threadId,
          runId: result.run.id,
          status: result.type === "already_terminal" ? result.run.status : "interrupt_requested",
        } satisfies OrchestratorMcpThreadInterruptResult;
      }),
    stopWorkflow: (scope, input) =>
      Effect.gen(function* () {
        yield* loadWritableThread(scope, input.threadId);
        yield* threadManagement
          .stopWorkflow(input)
          .pipe(
            Effect.mapError((cause) =>
              failure(
                cause.reason === "unavailable" || cause.reason === "stop-failed"
                  ? "orchestration_error"
                  : "invalid_request",
                cause.message,
              ),
            ),
          );
      }),
    backgroundWait: (scope, input) =>
      threadManagement
        .awaitBackgroundTasks({
          threadId: scope.threadId,
          taskIds: input.taskIds,
          awaited: input.waiting ?? true,
        })
        .pipe(
          Effect.mapError((cause) =>
            failure(
              cause.reason === "unsupported" ? "invalid_request" : "orchestration_error",
              cause.message,
            ),
          ),
        ),
  });
});

export const layer: Layer.Layer<
  OrchestratorMcpService,
  never,
  | Crypto.Crypto
  | ThreadLaunchService.ThreadLaunchService
  | GitVcsDriver.GitVcsDriver
  | ProjectService.ProjectService
  | ThreadManagementService.ThreadManagementService
  | ProviderRegistry.ProviderRegistry
  | ProviderAdapterRegistry.ProviderAdapterRegistryV2
  | ScheduledTaskService.ScheduledTaskService
  | SecretRequests.SecretRequests
  | TaskFolders.TaskFolders
> = Layer.effect(OrchestratorMcpService, make);
