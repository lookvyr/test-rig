import type { OrchestrationV2ThreadShell } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { backgroundWorkHoldsCompletion } from "./orchestrationV2PendingBackgroundWork.ts";
import type {
  EnvironmentId,
  OrchestrationProjectShell,
  OrchestrationThreadShell,
  ThreadId,
} from "@t3tools/contracts";

export type AgentAwarenessPhase =
  | "starting"
  | "running"
  | "waiting_for_approval"
  | "waiting_for_input"
  | "completed"
  | "failed"
  | "stale";

export interface AgentAwarenessState {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly projectTitle: string;
  readonly threadTitle: string;
  readonly phase: AgentAwarenessPhase;
  readonly headline: string;
  readonly detail?: string;
  readonly modelTitle: string;
  readonly updatedAt: string;
  readonly deepLink: string;
}

export interface ProjectThreadAwarenessInput {
  readonly environmentId: EnvironmentId;
  readonly project: Pick<OrchestrationProjectShell, "title">;
  readonly thread: Pick<
    OrchestrationThreadShell,
    | "id"
    | "title"
    | "modelSelection"
    | "session"
    | "latestTurn"
    | "updatedAt"
    | "hasPendingApprovals"
    | "hasPendingUserInput"
  >;
}

export function buildAgentAwarenessDeepLink(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}): string {
  return `/threads/${encodeURIComponent(input.environmentId)}/${encodeURIComponent(input.threadId)}`;
}

export function projectThreadAwareness(
  input: ProjectThreadAwarenessInput,
): AgentAwarenessState | null {
  const { environmentId, project, thread } = input;
  const phase = resolveThreadAwarenessPhase(thread);
  if (!phase) {
    return null;
  }

  const detail = detailForPhase(phase, thread);
  return {
    environmentId,
    threadId: thread.id,
    projectTitle: project.title,
    threadTitle: thread.title,
    phase,
    headline: headlineForPhase(phase),
    ...(detail === undefined ? {} : { detail }),
    modelTitle: thread.modelSelection.model,
    updatedAt: thread.updatedAt,
    deepLink: buildAgentAwarenessDeepLink({ environmentId, threadId: thread.id }),
  };
}

function resolveThreadAwarenessPhase(
  thread: ProjectThreadAwarenessInput["thread"],
): AgentAwarenessPhase | null {
  if (thread.hasPendingApprovals) {
    return "waiting_for_approval";
  }
  if (thread.hasPendingUserInput) {
    return "waiting_for_input";
  }
  if (thread.session?.status === "error" || thread.latestTurn?.state === "error") {
    return "failed";
  }
  if (thread.session?.status === "starting") {
    return "starting";
  }
  if (thread.session?.status === "running" || thread.latestTurn?.state === "running") {
    return "running";
  }
  if (thread.latestTurn?.state === "completed") {
    return "completed";
  }
  // A turn that finished can still read as "interrupted" here: session
  // teardown settles still-running turns by session status, and that write
  // can race the turn.completed one. completedAt survives the race — a turn
  // that has a completion timestamp finished, whatever the state column says.
  // Without this, quick finish-then-teardown threads resolve to null
  // persistently and get tombstoned instead of published as completed.
  if (thread.latestTurn?.state === "interrupted" && thread.latestTurn.completedAt !== null) {
    return "completed";
  }
  // Threads whose turns never produce a checkpoint (no code changes) have no
  // materialized latestTurn in the shell at all, and the session-set
  // projection clears latest_turn_id the moment the session settles. The
  // session status is then the only surviving completion signal: a live
  // session at "ready"/"idle" with nothing pending and nothing running means
  // the agent finished and is waiting for the next prompt — Done.
  if (thread.session?.status === "ready" || thread.session?.status === "idle") {
    return "completed";
  }
  return null;
}

function headlineForPhase(phase: AgentAwarenessPhase): string {
  switch (phase) {
    case "starting":
      return "Starting agent";
    case "running":
      return "Agent is working";
    case "waiting_for_approval":
      return "Approval needed";
    case "waiting_for_input":
      return "Waiting for input";
    case "completed":
      return "Agent finished";
    case "failed":
      return "Agent failed";
    case "stale":
      return "Update delayed";
  }
}

function detailForPhase(
  phase: AgentAwarenessPhase,
  thread: ProjectThreadAwarenessInput["thread"],
): string | undefined {
  if (phase === "failed") {
    return thread.session?.lastError ?? undefined;
  }
  if (phase === "completed") {
    return "Review the completed task.";
  }
  if (phase === "running" && thread.session?.providerName) {
    return `${thread.session.providerName} is active.`;
  }
  return undefined;
}

export interface ProjectThreadAwarenessV2Input {
  readonly environmentId: EnvironmentId;
  readonly project: Pick<OrchestrationProjectShell, "title">;
  readonly thread: Pick<
    OrchestrationV2ThreadShell,
    | "activityRunStatus"
    | "id"
    | "lineage"
    | "modelSelection"
    | "pendingBackgroundTasks"
    | "pendingRuntimeRequest"
    | "status"
    | "title"
    | "updatedAt"
  >;
}

/** Build relay activity directly from the V2 shell projection. */
export function projectThreadAwarenessV2(
  input: ProjectThreadAwarenessV2Input,
): AgentAwarenessState | null {
  const { environmentId, project, thread } = input;
  if (thread.lineage.relationshipToParent === "subagent") return null;
  const phase = resolveThreadAwarenessPhaseV2(thread);
  if (phase === null) {
    return null;
  }
  const detail =
    phase === "completed"
      ? "Review the completed task."
      : phase === "failed"
        ? "The agent run failed."
        : undefined;
  return {
    environmentId,
    threadId: thread.id,
    projectTitle: project.title,
    threadTitle: thread.title,
    phase,
    headline: headlineForPhase(phase),
    ...(detail === undefined ? {} : { detail }),
    modelTitle: thread.modelSelection.model,
    updatedAt: DateTime.formatIso(thread.updatedAt),
    deepLink: buildAgentAwarenessDeepLink({ environmentId, threadId: thread.id }),
  };
}

function resolveThreadAwarenessPhaseV2(
  thread: ProjectThreadAwarenessV2Input["thread"],
): AgentAwarenessPhase | null {
  if (thread.pendingRuntimeRequest?.kind === "user_input") {
    return "waiting_for_input";
  }
  if (
    thread.pendingRuntimeRequest !== null &&
    thread.pendingRuntimeRequest.kind !== "auth_refresh"
  ) {
    return "waiting_for_approval";
  }
  switch (thread.activityRunStatus ?? thread.status) {
    case "preparing":
    case "starting":
      return "starting";
    case "running":
    case "waiting":
      return "running";
    case "completed":
      // Work that will wake the agent keeps the run going; a dev server does not.
      return backgroundWorkHoldsCompletion(thread.pendingBackgroundTasks ?? [])
        ? "running"
        : "completed";
    case "failed":
      return "failed";
    case "idle":
    case "queued":
    case "interrupted":
    case "cancelled":
    case "rolled_back":
      return null;
  }
}
