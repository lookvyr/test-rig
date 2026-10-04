import { describe, expect, it } from "vite-plus/test";
import {
  deriveAgentPanelModel,
  workflowCardMembers,
  formatSubagentModelLabel,
  formatSubagentTokenCount,
  type RuntimeSubagent,
} from "./agentPanelModel";

const agent = (id: string, patch: Partial<RuntimeSubagent> = {}): RuntimeSubagent => ({
  id,
  kind: "subagent",
  title: id,
  role: null,
  model: null,
  effort: null,
  status: "running",
  activationCount: 1,
  usage: null,
  progress: null,
  lastToolName: null,
  result: null,
  error: null,
  outputFile: null,
  parentAgentId: null,
  agentIndex: null,
  phaseIndex: null,
  phaseTitle: null,
  attempt: null,
  workflowName: null,
  phases: [],
  runHandles: null,
  recentActivity: [],
  firstSeenAt: "2026-10-03T10:00:00Z",
  startedAt: null,
  completedAt: null,
  updatedAt: "2026-10-03T10:00:00Z",
  ...patch,
});

describe("native Agents panel", () => {
  it("retains orphaned and unknown-phase members and does not double-count coordinator usage", () => {
    const model = deriveAgentPanelModel([
      agent("workflow", {
        kind: "workflow",
        phases: [
          { index: 0, title: "Build" },
          { index: 1, title: "Review" },
        ],
        usage: { totalTokens: 300 },
      }),
      agent("child", {
        parentAgentId: "workflow",
        phaseIndex: 0,
        status: "idle",
        usage: { totalTokens: 100 },
      }),
      agent("unknown", {
        parentAgentId: "workflow",
        phaseIndex: 9,
        status: "failed",
        usage: { totalTokens: 200 },
      }),
      agent("orphan", { parentAgentId: "missing", status: "waiting", usage: { totalTokens: 50 } }),
    ]);
    expect(model.workflows[0]?.phases.map((phase) => phase.state)).toEqual(["running", "pending"]);
    expect(model.workflows[0]?.unphasedMembers.map((member) => member.id)).toEqual(["unknown"]);
    expect(model.directAgents.map((member) => member.id)).toEqual(["orphan"]);
    expect(model).toMatchObject({
      totalTokens: 350,
      runningCount: 1,
      waitingCount: 1,
      idleCount: 1,
      settledCount: 1,
      liveCount: 2,
    });
  });
  it("derives phases and keeps members ordered while terminal outcomes settle a phase", () => {
    const model = deriveAgentPanelModel([
      agent("workflow", { kind: "workflow" }),
      agent("second", {
        parentAgentId: "workflow",
        phaseIndex: 1,
        agentIndex: 2,
        status: "failed",
      }),
      agent("first", {
        parentAgentId: "workflow",
        phaseIndex: 1,
        agentIndex: 1,
        status: "completed",
      }),
    ]);
    expect(model.workflows[0]?.phases[0]).toMatchObject({
      index: 1,
      title: "Phase 2",
      state: "done",
      activeCount: 0,
      settledCount: 2,
    });
    expect(model.workflows[0]?.phases[0]?.members.map((member) => member.id)).toEqual([
      "first",
      "second",
    ]);
  });
  it("keeps direct rows stable when activity changes", () => {
    const first = agent("a");
    const second = agent("b", { firstSeenAt: "2026-10-03T10:01:00Z" });
    expect(
      deriveAgentPanelModel([
        second,
        { ...first, updatedAt: "2026-10-03T11:00:00Z" },
      ]).directAgents.map((member) => member.id),
    ).toEqual(["a", "b"]);
  });
  it("keeps urgent members visible when the workflow card overflows", () => {
    const group = deriveAgentPanelModel([
      agent("workflow", { kind: "workflow" }),
      ...(["completed", "running", "failed", "waiting"] as const).map((status) =>
        agent(status, { parentAgentId: "workflow", status }),
      ),
    ]).workflows[0]!;
    const card = workflowCardMembers(group, 2);
    expect(card.visible.map((member) => member.id)).toEqual(["failed", "running"]);
    expect(card.overflow).toBe(2);
  });
  it("preserves compact model and token labels", () => {
    expect(formatSubagentModelLabel("claude-sonnet-4-20250514", "high")).toBe("sonnet-4 · high");
    expect(formatSubagentModelLabel(null, "high")).toBeNull();
    expect([99, 1500, 125000, 1500000].map(formatSubagentTokenCount)).toEqual([
      "99",
      "1.5k",
      "125k",
      "1.5M",
    ]);
  });
});
