import { describe, expect, it } from "vite-plus/test";
import {
  NodeId,
  ProviderInstanceId,
  ProviderDriverKind,
  RunId,
  ThreadId,
  type OrchestrationV2Subagent,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import {
  isActiveSubagentStatus,
  isTerminalSubagentStatus,
  projectedSubagentsToRuntime,
} from "./subagentRuntime.ts";

const now = DateTime.makeUnsafe("2026-08-01T10:00:00.000Z");
function agent(overrides: Partial<OrchestrationV2Subagent> = {}): OrchestrationV2Subagent {
  return {
    id: NodeId.make("child"),
    threadId: ThreadId.make("thread"),
    runId: RunId.make("run"),
    parentNodeId: NodeId.make("root"),
    origin: "provider_native",
    driver: ProviderDriverKind.make("codex"),
    providerInstanceId: ProviderInstanceId.make("codex"),
    createdBy: "agent",
    providerThreadId: null,
    childThreadId: null,
    nativeTaskRef: null,
    title: "Audit",
    prompt: "Inspect the changes",
    model: "gpt-5.4",
    status: "running",
    result: null,
    startedAt: now,
    completedAt: null,
    updatedAt: now,
    ...overrides,
  };
}

describe("projectedSubagentsToRuntime", () => {
  it("preserves durable identity, lifecycle and model attribution", () => {
    const [value] = projectedSubagentsToRuntime([
      agent({ status: "completed", result: "Done", completedAt: now }),
    ]);
    expect(value).toMatchObject({
      id: "child",
      title: "Audit",
      status: "completed",
      result: "Done",
      model: "gpt-5.4",
      completedAt: DateTime.formatIso(now),
    });
  });
  it("preserves the server-owned usage, retry and workflow presentation", () => {
    const [value] = projectedSubagentsToRuntime([
      agent({
        presentation: {
          firstSeenAt: DateTime.formatIso(now),
          taskType: "local_workflow",
          activationCount: 3,
          usage: { totalTokens: 42 },
          role: "reviewer",
          effort: "high",
          phaseIndex: 2,
          attempt: 3,
          phases: [{ index: 2, title: "Verify" }],
          recentActivity: [{ at: DateTime.formatIso(now), summary: "Read file" }],
        },
      }),
    ]);
    expect(value).toMatchObject({
      kind: "workflow",
      activationCount: 3,
      usage: { totalTokens: 42 },
      role: "reviewer",
      effort: "high",
      phaseIndex: 2,
      attempt: 3,
      phases: [{ index: 2, title: "Verify" }],
      recentActivity: [{ at: DateTime.formatIso(now), summary: "Read file" }],
    });
  });
  it("links members only when the native parent is retained", () => {
    const parent = agent({
      id: NodeId.make("workflow"),
      presentation: {
        firstSeenAt: DateTime.formatIso(now),
        activationCount: 1,
        recentActivity: [],
        taskType: "local_workflow",
      },
    });
    const child = agent({ parentNodeId: parent.id });
    expect(projectedSubagentsToRuntime([parent, child])[1]).toMatchObject({
      parentAgentId: "workflow",
      kind: "workflow_agent",
    });
    expect(projectedSubagentsToRuntime([child])[0]).toMatchObject({
      parentAgentId: null,
      kind: "subagent",
    });
  });
  it("keeps first-seen order stable through a late update", () => {
    const firstSeenAt = "2026-08-01T09:00:00.000Z";
    expect(
      projectedSubagentsToRuntime([
        agent({ presentation: { activationCount: 1, recentActivity: [], firstSeenAt } }),
      ])[0]?.firstSeenAt,
    ).toBe(firstSeenAt);
  });
  it("uses bounded prompt text when there is no title", () => {
    expect(
      projectedSubagentsToRuntime([agent({ title: null, prompt: "a".repeat(100) })])[0]?.title,
    ).toBe("a".repeat(77) + "...");
  });
  it("surfaces failure details and explicit errors", () => {
    expect(
      projectedSubagentsToRuntime([agent({ status: "failed", result: "Failed" })])[0]?.error,
    ).toBe("Failed");
    expect(
      projectedSubagentsToRuntime([
        agent({
          status: "failed",
          result: "Failed",
          presentation: {
            firstSeenAt: DateTime.formatIso(now),
            activationCount: 1,
            recentActivity: [],
            error: "Specific error",
          },
        }),
      ])[0]?.error,
    ).toBe("Specific error");
  });
  it.each(["pending", "running", "waiting"] as const)("treats %s as active", (status) => {
    expect(isActiveSubagentStatus(status)).toBe(true);
    expect(isTerminalSubagentStatus(status)).toBe(false);
  });
  it.each(["completed", "failed", "cancelled", "interrupted"] as const)(
    "treats %s as terminal",
    (status) => {
      expect(isActiveSubagentStatus(status)).toBe(false);
      expect(isTerminalSubagentStatus(status)).toBe(true);
    },
  );
  it("keeps idle resumable without counting it as active", () => {
    expect(isActiveSubagentStatus("idle")).toBe(false);
    expect(isTerminalSubagentStatus("idle")).toBe(false);
  });
});
