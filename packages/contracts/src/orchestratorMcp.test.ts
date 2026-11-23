import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  OrchestratorMcpCreateThreadsInput,
  OrchestratorMcpDelegateTaskInput,
  OrchestratorMcpDelegateTaskResult,
  OrchestratorMcpRequestSecretInput,
  OrchestratorMcpSaveScheduledTaskInput,
  OrchestratorMcpScheduleTaskInput,
  OrchestratorMcpUpdateScheduledTaskInput,
  OrchestratorMcpThreadInterruptInput,
  OrchestratorMcpThreadListInput,
  OrchestratorMcpThreadReadInput,
  OrchestratorMcpThreadSendInput,
  OrchestratorMcpThreadWaitInput,
} from "./orchestratorMcp.ts";

const decodeCreateThreadsInput = Schema.decodeUnknownSync(OrchestratorMcpCreateThreadsInput);
const decodeDelegateTaskInput = Schema.decodeUnknownSync(OrchestratorMcpDelegateTaskInput);
const decodeDelegateTaskResult = Schema.decodeUnknownSync(OrchestratorMcpDelegateTaskResult);
const decodeRequestSecretInput = Schema.decodeUnknownSync(OrchestratorMcpRequestSecretInput);
const decodeSaveScheduledTaskInput = Schema.decodeUnknownSync(
  OrchestratorMcpSaveScheduledTaskInput,
);
const decodeThreadInterruptInput = Schema.decodeUnknownSync(OrchestratorMcpThreadInterruptInput);
const decodeThreadListInput = Schema.decodeUnknownSync(OrchestratorMcpThreadListInput);
const decodeThreadReadInput = Schema.decodeUnknownSync(OrchestratorMcpThreadReadInput);
const decodeThreadSendInput = Schema.decodeUnknownSync(OrchestratorMcpThreadSendInput);
const decodeThreadWaitInput = Schema.decodeUnknownSync(OrchestratorMcpThreadWaitInput);

const decodeScheduleTask = Schema.decodeUnknownSync(OrchestratorMcpScheduleTaskInput);
const decodeUpdateScheduledTask = Schema.decodeUnknownSync(OrchestratorMcpUpdateScheduledTaskInput);

describe("orchestrator MCP contracts", () => {
  it("accepts optional worktree isolation and setup opt-out", () => {
    expect(decodeDelegateTaskInput({ task: "Review changes" }).isolation).toBeUndefined();
    expect(decodeDelegateTaskInput({ task: "Review changes", isolation: "shared" }).isolation).toBe(
      "shared",
    );
    const isolated = decodeDelegateTaskInput({
      task: "Review changes",
      isolation: "worktree",
      runSetupScript: false,
    });
    expect(isolated.isolation).toBe("worktree");
    expect(isolated.runSetupScript).toBe(false);
    expect(() => decodeDelegateTaskInput({ task: "Review changes", isolation: "copy" })).toThrow();
  });
  it("decodes cross-provider delegated task requests and durable results", () => {
    const request = decodeDelegateTaskInput({
      task: "Inspect the workspace and report the result.",
      target: {
        providerInstanceId: "claudeAgent",
        model: "claude-sonnet-4-6",
      },
      mode: "wait",
      timeoutMs: 5_000,
      clientRequestId: "delegate-1",
      runtimeMode: "inherit",
      interactionMode: "inherit",
    });
    const result = decodeDelegateTaskResult({
      taskId: "node-task-1",
      childThreadId: "thread-child-1",
      childRunId: "run-child-1",
      childNodeId: "node-task-1",
      status: "completed",
      workState: "result_available",
      hasPendingChildRuns: false,
      providerInstanceId: "claudeAgent",
      model: "claude-sonnet-4-6",
      summary: "Workspace inspected.",
      resultContextTransferId: "context-transfer-result-1",
      latestTerminalRunId: "run-child-1",
      latestTerminalStatus: "completed",
      latestTerminalSummary: "Workspace inspected.",
      latestTerminalResultContextTransferId: "context-transfer-result-1",
      hasPendingQuestion: false,
      pendingApproval: null,
      waitTimedOut: false,
    });

    expect(request.target?.providerInstanceId).toBe("claudeAgent");
    expect(result.status).toBe("completed");
    expect(result.summary).toBe("Workspace inspected.");
    expect(result.pendingApproval).toBeNull();
    const pendingApproval = {
      requestId: "request-approval-1",
      kind: "command",
      runId: "run-child-1",
    };
    expect(
      decodeDelegateTaskResult({
        ...result,
        pendingApproval: { ...pendingApproval, input: { command: "private command" } },
      }).pendingApproval,
    ).toEqual(pendingApproval);
    expect(() =>
      decodeDelegateTaskResult({
        ...result,
        pendingApproval: { ...pendingApproval, kind: "user_input" },
      }),
    ).toThrow();
  });

  it("decodes target model options in canonical and shorthand shapes", () => {
    const canonical = decodeDelegateTaskInput({
      task: "Say hello.",
      target: {
        providerInstanceId: "codex",
        model: "gpt-5.6-luna",
        options: [{ id: "reasoning", value: "low" }],
      },
    });
    const shorthand = decodeDelegateTaskInput({
      task: "Say hello.",
      target: {
        providerInstanceId: "codex",
        model: "gpt-5.6-luna",
        options: { reasoning: "low", fastMode: true },
      },
    });

    expect(canonical.target?.options).toEqual([{ id: "reasoning", value: "low" }]);
    expect(shorthand.target?.options).toEqual([
      { id: "reasoning", value: "low" },
      { id: "fastMode", value: true },
    ]);
  });

  it("rejects target model options that are not strings or booleans", () => {
    expect(() =>
      decodeDelegateTaskInput({
        task: "Say hello.",
        target: {
          providerInstanceId: "codex",
          model: "gpt-5.6-luna",
          // Must fail loudly instead of being dropped like legacy persistence.
          options: { reasoning: 3 },
        },
      }),
    ).toThrow();
    expect(() =>
      decodeDelegateTaskInput({
        task: "Say hello.",
        target: {
          providerInstanceId: "codex",
          model: "gpt-5.6-luna",
          options: [{ id: "reasoning", value: null }],
        },
      }),
    ).toThrow();
  });

  it("decodes mixed prompted and empty thread batches", () => {
    const request = decodeCreateThreadsInput({
      clientRequestId: "threads-1",
      threads: [
        { title: "Inherited empty thread" },
        {
          prompt: "Review the API.",
          target: { driverKind: "claudeAgent" },
          runtimeMode: "full-access",
        },
      ],
    });

    expect(request.threads).toHaveLength(2);
    expect(request.threads[0]?.prompt).toBeUndefined();
    expect(request.threads[1]?.target?.driverKind).toBe("claudeAgent");
  });

  it("decodes project-scoped thread orchestration requests", () => {
    expect(
      decodeThreadListInput({
        statuses: ["running", "completed"],
        includeSubagents: false,
        limit: 25,
      }).statuses,
    ).toEqual(["running", "completed"]);
    expect(
      decodeThreadReadInput({
        threadId: "thread-loop-1",
        view: "activity",
        afterPosition: 10,
      }).afterPosition,
    ).toBe(10);
    expect(
      decodeThreadSendInput({
        threadId: "thread-loop-1",
        message: "Continue with the next iteration.",
        mode: "steer",
        clientRequestId: "send-loop-2",
      }).mode,
    ).toBe("steer");
    expect(
      decodeThreadWaitInput({
        threadId: "thread-loop-1",
        runId: "run-loop-2",
        timeoutMs: 5_000,
      }).runId,
    ).toBe("run-loop-2");
    expect(
      decodeThreadInterruptInput({
        threadId: "thread-loop-1",
        reason: "Loop converged.",
      }).reason,
    ).toBe("Loop converged.");
  });

  it("clamps limits above their maximum instead of failing", () => {
    expect(decodeThreadListInput({ limit: 500 }).limit).toBe(100);
    const read = decodeThreadReadInput({
      threadId: "thread-loop-1",
      limit: 1_000,
      runLimit: 99,
      maxCharsPerItem: 1_000_000,
    });
    expect([read.limit, read.runLimit, read.maxCharsPerItem]).toEqual([100, 50, 20_000]);
    expect(() => decodeThreadListInput({ limit: 0 })).toThrow();
  });

  it("decodes newest-first paging, fresh sends, and cross-project lists", () => {
    expect(
      decodeThreadReadInput({ threadId: "thread-loop-1", beforePosition: 40 }).beforePosition,
    ).toBe(40);
    expect(
      decodeThreadSendInput({
        threadId: "thread-loop-1",
        message: "Start over.",
        freshContext: true,
      }).freshContext,
    ).toBe(true);
    expect(decodeThreadListInput({ allProjects: true }).allProjects).toBe(true);
  });

  it("saves a scheduled task by create or partial update", () => {
    expect(
      decodeSaveScheduledTaskInput({ scheduledTaskId: "scheduled-task-1", enabled: false }),
    ).toEqual({ scheduledTaskId: "scheduled-task-1", enabled: false });
    const created = decodeSaveScheduledTaskInput({
      prompt: "Check the build.",
      schedule: { type: "interval", everyMs: 3_600_000 },
      projectId: "project-2",
      freshSession: true,
    });
    expect(created.projectId).toBe("project-2");
    expect(created.freshSession).toBe(true);
  });

  it("accepts secret delivery, sign-in links, and pasted values", () => {
    const request = decodeRequestSecretInput({
      label: "Pairing code",
      reason: "Pair the device.",
      url: "https://example.com/pair",
      delivery: "file",
    });
    expect(request.delivery).toBe("file");
    expect(request.url).toBe("https://example.com/pair");
    expect(
      decodeRequestSecretInput({
        label: "API key",
        reason: "For the script.",
        value: "sk-test-1234",
      }).value,
    ).toBe("sk-test-1234");
    expect(() =>
      decodeRequestSecretInput({
        label: "API key",
        reason: "Sign in.",
        url: "javascript:alert(1)",
      }),
    ).toThrow();
  });
});

it("normalizes structured and JSON-text schedules for create and update requests", () => {
  const schedule = { type: "interval", everyMs: 60_000 };
  for (const input of [schedule, JSON.stringify(schedule)]) {
    expect(decodeScheduleTask({ prompt: "Check progress", schedule: input }).schedule).toEqual(
      schedule,
    );
    expect(
      decodeUpdateScheduledTask({ scheduledTaskId: "task-1", schedule: input }).schedule,
    ).toEqual(schedule);
  }
});

describe("spawned thread runtime modes", () => {
  it.each(["approval-required", "auto-accept-edits"])("rejects a %s child", (runtimeMode) => {
    expect(() =>
      decodeCreateThreadsInput({ threads: [{ title: "Child", runtimeMode }] }),
    ).toThrow();
  });

  it.each(["inherit", "auto", "full-access"])("accepts a %s child", (runtimeMode) => {
    expect(
      decodeCreateThreadsInput({ threads: [{ title: "Child", runtimeMode }] }).threads[0]
        ?.runtimeMode,
    ).toBe(runtimeMode);
  });
});
