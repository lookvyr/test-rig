/**
 * Subagent status helpers shared by web and mobile, and the runtime shape the
 * web agent rows render.
 */
import * as DateTime from "effect/DateTime";
import type {
  OrchestrationV2Subagent,
  OrchestrationV2SubagentPresentation,
  RuntimeTaskUsage,
} from "@t3tools/contracts";
import { isOrchestrationV2WorkActive } from "@t3tools/contracts";

export type RuntimeSubagentStatus =
  | "pending"
  | "running"
  | "waiting"
  | "idle"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export type SubagentUsage = RuntimeTaskUsage;

export interface SubagentActivityEntry {
  readonly at: string;
  readonly summary: string;
}

export interface SubagentWorkflowPhase {
  readonly index: number;
  readonly title: string;
}

export type SubagentRunHandles = NonNullable<OrchestrationV2SubagentPresentation["runHandles"]>;

export interface RuntimeSubagent {
  readonly id: string;
  readonly kind: "subagent" | "subagent_batch" | "workflow" | "workflow_agent";
  readonly title: string;
  readonly role: string | null;
  readonly model: string | null;
  readonly effort: string | null;
  readonly status: RuntimeSubagentStatus;
  readonly activationCount: number;
  readonly usage: SubagentUsage | null;
  readonly progress: string | null;
  readonly lastToolName: string | null;
  readonly result: string | null;
  readonly error: string | null;
  readonly outputFile: string | null;
  readonly parentAgentId: string | null;
  readonly agentIndex: number | null;
  readonly phaseIndex: number | null;
  readonly phaseTitle: string | null;
  readonly attempt: number | null;
  readonly workflowName: string | null;
  readonly phases: ReadonlyArray<SubagentWorkflowPhase>;
  readonly runHandles: SubagentRunHandles | null;
  readonly recentActivity: ReadonlyArray<SubagentActivityEntry>;
  /** First retained observation, used as the roster's stable display order. */
  readonly firstSeenAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly updatedAt: string;
}

const TERMINAL_STATUSES: ReadonlySet<RuntimeSubagentStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

export function isTerminalSubagentStatus(status: RuntimeSubagentStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** Active = the user may still need to care while it runs. Idle is settled-ish
 * but resumable; waiting counts as active because it needs the user. */
export function isActiveSubagentStatus(status: RuntimeSubagentStatus): boolean {
  return isOrchestrationV2WorkActive(status);
}

/**
 * Projects orchestration-v2 subagent entities into the runtime shape the web
 * agent rows render.
 */
export function projectedSubagentsToRuntime(
  subagents: ReadonlyArray<OrchestrationV2Subagent>,
): ReadonlyArray<RuntimeSubagent> {
  const agentIds = new Set(subagents.map((agent) => agent.id));
  return subagents.map((subagent) => {
    const info = subagent.presentation;
    const parentAgentId = agentIds.has(subagent.parentNodeId) ? subagent.parentNodeId : null;
    const updatedAt = DateTime.formatIso(subagent.updatedAt);
    const startedAt = subagent.startedAt === null ? null : DateTime.formatIso(subagent.startedAt);
    return {
      id: subagent.id,
      kind:
        info?.taskType === "local_workflow"
          ? "workflow"
          : parentAgentId !== null
            ? "workflow_agent"
            : "subagent",
      title:
        subagent.title ??
        (subagent.prompt.length > 80 ? `${subagent.prompt.slice(0, 77)}...` : subagent.prompt),
      role: info?.role ?? null,
      model: subagent.model,
      effort: info?.effort ?? null,
      status: subagent.status,
      activationCount: info?.activationCount ?? 1,
      usage: info?.usage ?? null,
      progress: subagent.progress ?? null,
      lastToolName: info?.lastToolName ?? null,
      result: subagent.result,
      error: info?.error ?? (subagent.status === "failed" ? subagent.result : null),
      outputFile: info?.outputFile ?? null,
      parentAgentId,
      agentIndex: info?.agentIndex ?? null,
      phaseIndex: info?.phaseIndex ?? null,
      phaseTitle: info?.phaseTitle ?? null,
      attempt: info?.attempt ?? null,
      workflowName: info?.workflowName ?? null,
      phases: info?.phases ?? [],
      runHandles: info?.runHandles ?? null,
      recentActivity: info?.recentActivity ?? [],
      firstSeenAt: info?.firstSeenAt ?? startedAt ?? updatedAt,
      startedAt,
      completedAt: subagent.completedAt === null ? null : DateTime.formatIso(subagent.completedAt),
      updatedAt,
    } satisfies RuntimeSubagent;
  });
}
