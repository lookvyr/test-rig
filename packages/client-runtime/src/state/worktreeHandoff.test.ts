import { describe, expect, it } from "vite-plus/test";
import { RunId, TurnItemId, type OrchestrationV2TurnItem } from "@t3tools/contracts";
import { v2Now, v2ThreadId } from "./orchestrationV2TestFixtures.ts";
import { createWorktreeHandoffProjector } from "./worktreeHandoff.ts";

const projectWorktreeHandoffs = createWorktreeHandoffProjector();

const base = {
  threadId: v2ThreadId,
  runId: RunId.make("handoff-run"),
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal: 1,
  title: null,
  startedAt: v2Now,
  completedAt: v2Now,
  updatedAt: v2Now,
};
const tool: OrchestrationV2TurnItem = {
  ...base,
  id: TurnItemId.make("handoff-tool"),
  type: "dynamic_tool",
  status: "failed",
  toolName: "mcp__test_rig__t3_worktree_handoff",
  input: { branch: "feature/demo" },
  output: "Tool execution was interrupted",
};
const receipt: Extract<OrchestrationV2TurnItem, { type: "system_notice" }> = {
  ...base,
  id: TurnItemId.make("receipt"),
  type: "system_notice",
  status: "completed",
  parentItemId: tool.id,
  message: "Moved to worktree feature/demo.",
  worktreeHandoff: {
    branch: "feature/demo",
    worktreePath: "/worktrees/demo",
    baseRef: "main",
    startedFromOrigin: false,
    setupScript: { status: "skipped" },
    continuation: { status: "skipped" },
    note: "Handoff recorded.",
  },
};
const interrupted: OrchestrationV2TurnItem = {
  ...base,
  id: TurnItemId.make("interrupted"),
  type: "run_interrupt_result",
  status: "interrupted",
  message: "Run interrupted by user",
};
const rows = (...items: OrchestrationV2TurnItem[]) =>
  items.map((item, position) => ({
    item,
    position,
    sourceItemId: item.id,
    sourceThreadId: item.threadId,
    visibility: "local" as const,
  }));

describe("worktree handoff receipts", () => {
  it("shows the app-owned result when detaching cancelled the provider response", () => {
    const displayed = projectWorktreeHandoffs(rows(tool, interrupted, receipt));
    expect(displayed.map((row) => row.item.type)).toEqual(["dynamic_tool", "system_notice"]);
    expect(displayed[0]?.item).toMatchObject({
      status: "completed",
      output: JSON.stringify(receipt.worktreeHandoff),
    });
    expect(tool.status).toBe("failed"); // The durable provider record is untouched.
  });
  it("keeps both sides of a manual Stop even if the workspace also moved", () => {
    const request: OrchestrationV2TurnItem = {
      ...base,
      id: TurnItemId.make("stop"),
      type: "run_interrupt_request",
      status: "completed",
      message: "Stop",
    };
    expect(
      projectWorktreeHandoffs(rows(request, interrupted, receipt)).map((row) => row.item.type),
    ).toEqual(["run_interrupt_request", "run_interrupt_result", "system_notice"]);
  });
  it("does not turn a failed binding into success without a receipt", () => {
    const original = rows(tool, interrupted);
    expect(projectWorktreeHandoffs(original)).toBe(original);
  });
  it("preserves setup and continuation errors in the recorded result", () => {
    const failed = {
      ...receipt,
      worktreeHandoff: {
        ...receipt.worktreeHandoff!,
        setupScript: { status: "failed" as const, detail: "install failed" },
        continuation: { status: "failed" as const, detail: "queue unavailable" },
      },
    };
    const displayed = projectWorktreeHandoffs(rows(tool, interrupted, failed));
    expect(displayed[1]?.item).toBe(failed);
    expect(displayed[0]?.item).toMatchObject({ output: JSON.stringify(failed.worktreeHandoff) });
  });
  it("leaves unrelated failed tools, provider errors, and later interruptions intact", () => {
    const other = { ...tool, id: TurnItemId.make("other-tool"), input: { branch: "other-branch" } };
    const later = {
      ...interrupted,
      id: TurnItemId.make("later-stop"),
      runId: RunId.make("next-run"),
    };
    const error: OrchestrationV2TurnItem = {
      ...base,
      id: TurnItemId.make("provider-error"),
      type: "error",
      status: "failed",
      failure: {
        class: "unknown",
        message: "Provider crashed",
        code: null,
        retryable: null,
        resetAt: null,
      },
    };
    const displayed = projectWorktreeHandoffs(rows(other, error, later, receipt));
    expect(displayed.slice(0, 3).map((row) => row.item)).toEqual([other, error, later]);
  });
  it.each([
    "test_rig.t3_worktree_handoff",
    "mcp__test_rig__t3_worktree_handoff",
    "test_rig-thread_123_t3_worktree_handoff",
  ])("recognizes %s even when its provider event arrives after the receipt", (toolName) => {
    const unlinked = { ...receipt, parentItemId: null };
    expect(projectWorktreeHandoffs(rows(unlinked))).toHaveLength(1);
    expect(projectWorktreeHandoffs(rows({ ...tool, toolName }, unlinked))[0]?.item.status).toBe(
      "completed",
    );
  });
  it("does not guess between duplicate calls for the same branch", () => {
    const duplicate = { ...tool, id: TurnItemId.make("duplicate") };
    const displayed = projectWorktreeHandoffs(rows(tool, duplicate, receipt));
    expect(displayed.slice(0, 2).map((row) => row.item.status)).toEqual(["failed", "failed"]);
  });
  it("does not infer uniqueness when a duplicate call is outside the visible window", () => {
    const duplicate = { ...tool, id: TurnItemId.make("retained-duplicate") };
    expect(projectWorktreeHandoffs(rows(tool, receipt), [duplicate])[0]?.item).toBe(tool);
  });
  it("reuses the displayed tool row while unrelated rows stream", () => {
    const original = rows(tool, receipt);
    const first = projectWorktreeHandoffs(original);
    const next = projectWorktreeHandoffs([
      ...original,
      ...rows({ ...interrupted, runId: RunId.make("other-run") }),
    ]);
    expect(next[0]).toBe(first[0]);
  });
  it("retains a manual Stop whose request is outside the visible history window", () => {
    const request: OrchestrationV2TurnItem = {
      ...base,
      id: TurnItemId.make("paged-stop"),
      type: "run_interrupt_request",
      status: "completed",
      message: "Stop",
    };
    expect(projectWorktreeHandoffs(rows(interrupted, receipt), [request])[0]?.item).toBe(
      interrupted,
    );
  });
  it("uses a retained receipt when the receipt is outside the visible window", () => {
    expect(
      projectWorktreeHandoffs(rows(tool, interrupted), [receipt]).map((row) => row.item.status),
    ).toEqual(["completed"]);
  });
});
