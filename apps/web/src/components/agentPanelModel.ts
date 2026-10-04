import {
  isActiveSubagentStatus,
  isTerminalSubagentStatus,
  type RuntimeSubagent,
} from "@t3tools/client-runtime/state/subagentRuntime";
export type { RuntimeSubagent } from "@t3tools/client-runtime/state/subagentRuntime";
export interface AgentPanelWorkflowGroup {
  readonly workflow: RuntimeSubagent;
  readonly phases: ReadonlyArray<{
    readonly index: number;
    readonly title: string;
    readonly members: ReadonlyArray<RuntimeSubagent>;
    /** done = every member settled (success or error); running = any active. */
    readonly state: "pending" | "running" | "done";
    readonly activeCount: number;
    readonly settledCount: number;
  }>;
  /** Members with no resolvable phase (orphans render under the workflow). */
  readonly unphasedMembers: ReadonlyArray<RuntimeSubagent>;
}

export interface AgentPanelModel {
  readonly workflows: ReadonlyArray<AgentPanelWorkflowGroup>;
  readonly directAgents: ReadonlyArray<RuntimeSubagent>;
  readonly runningCount: number;
  readonly waitingCount: number;
  readonly idleCount: number;
  readonly settledCount: number;
  readonly totalTokens: number;
  readonly hasAgents: boolean;
  readonly liveCount: number;
}

const EMPTY_PANEL_MODEL: AgentPanelModel = {
  workflows: [],
  directAgents: [],
  runningCount: 0,
  waitingCount: 0,
  idleCount: 0,
  settledCount: 0,
  totalTokens: 0,
  hasAgents: false,
  liveCount: 0,
};

export function emptyAgentPanelModel(): AgentPanelModel {
  return EMPTY_PANEL_MODEL;
}

/** Groups the native roster for the retained Agents panel. */
export function deriveAgentPanelModel(source: ReadonlyArray<RuntimeSubagent>): AgentPanelModel {
  if (source.length === 0) {
    return EMPTY_PANEL_MODEL;
  }

  const workflows = source
    .filter((agent) => agent.kind === "workflow")
    .slice()
    .sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt) || a.id.localeCompare(b.id));
  const workflowIds = new Set(workflows.map((workflow) => workflow.id));
  const members = new Map<string, RuntimeSubagent[]>();
  const direct: RuntimeSubagent[] = [];

  for (const agent of source) {
    if (agent.kind === "workflow") {
      continue;
    }
    if (agent.parentAgentId !== null && workflowIds.has(agent.parentAgentId)) {
      const list = members.get(agent.parentAgentId) ?? [];
      list.push(agent);
      members.set(agent.parentAgentId, list);
    } else {
      // Orphaned members (coordinator aged out) fall back to the direct list.
      direct.push(agent);
    }
  }

  const workflowGroups: AgentPanelWorkflowGroup[] = workflows.map((workflow) => {
    const workflowMembers = members.get(workflow.id) ?? [];
    const knownPhases =
      workflow.phases.length > 0
        ? workflow.phases
        : (() => {
            const derived = new Map<number, string>();
            for (const member of workflowMembers) {
              if (member.phaseIndex !== null && !derived.has(member.phaseIndex)) {
                derived.set(
                  member.phaseIndex,
                  member.phaseTitle ?? `Phase ${member.phaseIndex + 1}`,
                );
              }
            }
            return Array.from(derived.entries())
              .map(([index, title]) => ({ index, title }))
              .slice()
              .sort((a, b) => a.index - b.index);
          })();

    const knownPhaseIndices = new Set(knownPhases.map((phase) => phase.index));
    const phases = knownPhases.map((phase) => {
      const phaseMembers = workflowMembers
        .filter((member) => member.phaseIndex === phase.index)
        .slice()
        .sort((a, b) => (a.agentIndex ?? 0) - (b.agentIndex ?? 0));
      const activeCount = phaseMembers.filter(
        // Idle members count as active for phase-liveness: a resumable Codex
        // member has not finished the phase.
        (member) => isActiveSubagentStatus(member.status) || member.status === "idle",
      ).length;
      const settledCount = phaseMembers.filter((member) =>
        isTerminalSubagentStatus(member.status),
      ).length;
      const state: "pending" | "running" | "done" =
        phaseMembers.length === 0
          ? "pending"
          : activeCount > 0
            ? "running"
            : settledCount === phaseMembers.length
              ? "done"
              : "pending";
      return {
        index: phase.index,
        title: phase.title,
        members: phaseMembers,
        state,
        activeCount,
        settledCount,
      };
    });

    // Unknown phase indices land here too — a member must never vanish just
    // because its phase row was lost (review finding).
    const unphasedMembers = workflowMembers
      .filter((member) => member.phaseIndex === null || !knownPhaseIndices.has(member.phaseIndex))
      .slice()
      .sort((a, b) => (a.agentIndex ?? 0) - (b.agentIndex ?? 0));

    return { workflow, phases, unphasedMembers };
  });

  let runningCount = 0;
  let waitingCount = 0;
  let idleCount = 0;
  let settledCount = 0;
  let totalTokens = 0;
  for (const agent of source) {
    if (agent.status === "running" || agent.status === "pending") runningCount += 1;
    else if (agent.status === "waiting") waitingCount += 1;
    else if (agent.status === "idle") idleCount += 1;
    else settledCount += 1;
    // Workflow coordinators aggregate member usage upstream in some providers;
    // avoid double counting by only summing leaf agents when members exist.
    if (agent.kind !== "workflow" || (members.get(agent.id) ?? []).length === 0) {
      totalTokens += agent.usage?.totalTokens ?? 0;
    }
  }

  return {
    workflows: workflowGroups,
    // Updates and the >100-agent retention ranking must never reshuffle rows
    // that remain visible.
    directAgents: direct
      .slice()
      .sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt) || a.id.localeCompare(b.id)),
    runningCount,
    waitingCount,
    idleCount,
    settledCount,
    totalTokens,
    hasAgents: true,
    liveCount: runningCount + waitingCount,
  };
}

/**
 * Members ordered by urgency for the capped inline workflow card: running and
 * failed first, then waiting, then most recently updated.
 */
export function workflowCardMembers(
  group: AgentPanelWorkflowGroup,
  limit: number,
): { readonly visible: ReadonlyArray<RuntimeSubagent>; readonly overflow: number } {
  const all = [...group.phases.flatMap((phase) => phase.members), ...group.unphasedMembers];
  const urgency = (agent: RuntimeSubagent): number => {
    if (agent.status === "failed") return 0;
    if (agent.status === "running") return 1;
    if (agent.status === "waiting") return 2;
    return 3;
  };
  const ordered = all
    .slice()
    .sort((a, b) => urgency(a) - urgency(b) || b.updatedAt.localeCompare(a.updatedAt));
  return {
    visible: ordered.slice(0, limit),
    overflow: Math.max(0, ordered.length - limit),
  };
}

export function formatSubagentModelLabel(
  model: string | null,
  effort: string | null,
): string | null {
  if (!model) {
    return null;
  }
  const compact = model
    .replace(/^claude-/, "")
    .replace(/-\d{8}$/, "")
    .replace(/-latest$/, "");
  return effort ? `${compact} · ${effort}` : compact;
}

export function formatSubagentTokenCount(totalTokens: number): string {
  if (totalTokens < 1000) {
    return `${totalTokens}`;
  }
  if (totalTokens < 1_000_000) {
    const value = totalTokens / 1000;
    return `${value >= 100 ? Math.round(value) : value.toFixed(1)}k`;
  }
  return `${(totalTokens / 1_000_000).toFixed(1)}M`;
}
