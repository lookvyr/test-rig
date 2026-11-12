import {
  ProviderInstanceId,
  ProviderThreadId,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  backgroundWorkHoldsCompletion,
  deriveBlockedOnThreadWait,
  derivePendingBackgroundWork,
} from "./orchestrationV2PendingBackgroundWork.ts";

describe("backgroundWorkHoldsCompletion", () => {
  it.each([
    ["a dev server", false, [{ taskId: "dev", kind: "command" }]],
    ["a dev server's watchdog monitor", false, [{ taskId: "watch", kind: "monitor" }]],
    ["a command the agent waits on", true, [{ taskId: "tests", kind: "command", awaited: true }]],
    ["a subagent", true, [{ taskId: "review", kind: "subagent" }]],
  ] as const)("with %s pending, holds completion: %s", (_case, holds, tasks) => {
    expect(backgroundWorkHoldsCompletion(tasks)).toBe(holds);
  });
});

describe("deriveBlockedOnThreadWait", () => {
  const activeRun = { id: "run-1" as never, status: "running" as const };
  // Only the fields deriveBlockedOnThreadWait reads.
  const item = (fields: Record<string, unknown>) =>
    ({ runId: "run-1", status: "running", ...fields }) as unknown as OrchestrationV2TurnItem;
  const wait = item({ type: "dynamic_tool", toolName: "mcp__t3-code__t3_thread_wait" });

  it.each([
    ["a Claude thread wait", [wait], true],
    [
      "a Codex thread wait",
      [item({ type: "dynamic_tool", toolName: "t3-code.t3_thread_wait" })],
      true,
    ],
    [
      "a blocking delegate",
      [item({ type: "dynamic_tool", toolName: "delegate_task", input: { mode: "wait" } })],
      true,
    ],
    [
      "an async delegate",
      [item({ type: "dynamic_tool", toolName: "delegate_task", input: { mode: "async" } })],
      false,
    ],
    [
      "a foreign tool named like a wait",
      [item({ type: "dynamic_tool", toolName: "x.t3_thread_wait" })],
      false,
    ],
    ["a wait beside a running command", [wait, item({ type: "command_execution" })], false],
    ["a wait beside a file edit", [wait, item({ type: "file_change" })], false],
    [
      "a wait beside the app-owned child it tracks",
      [wait, item({ type: "subagent", origin: "app_owned" })],
      true,
    ],
    ["a wait beside a streaming message", [wait, item({ type: "assistant_message" })], true],
    ["a wait on a previous run", [item({ ...wait, runId: "run-0" })], false],
    ["a pending wait", [item({ ...wait, status: "pending" })], false],
    ["nothing", [], false],
  ] as const)("with %s open, is blocked: %s", (_case, turnItems, blocked) => {
    expect(deriveBlockedOnThreadWait({ activeRun, turnItems })).toBe(blocked);
  });

  it("is never blocked without a running active run", () => {
    expect(deriveBlockedOnThreadWait({ activeRun: null, turnItems: [wait] })).toBe(false);
    expect(
      deriveBlockedOnThreadWait({
        activeRun: { ...activeRun, status: "starting" },
        turnItems: [wait],
      }),
    ).toBe(false);
  });
});

describe("pull request watches", () => {
  const watch = {
    startedAt: "2026-10-05T00:00:00.000Z",
    headSha: null,
    failedChecks: [],
    passed: false,
    passedChecks: [],
    remarksThrough: "2026-10-05T00:00:00.000Z",
    remarkIds: [],
    conflicting: false,
    wakes: 0,
  };
  const link = (
    number: number,
    extra: { source?: "agent" | "stack-dismissed"; watched?: boolean },
  ) => ({
    host: "github.com",
    repository: "acme/app",
    number,
    url: `https://github.com/acme/app/pull/${number}`,
    source: extra.source ?? "agent",
    ...(extra.watched === false ? {} : { watch }),
  });
  const pullRequests = [
    link(1, {}),
    link(2, { watched: false }),
    link(3, { source: "stack-dismissed" }),
  ];

  it("keeps a settled run waiting on each visible watch, as an awaited monitor", () => {
    const tasks = derivePendingBackgroundWork({
      latestRun: { id: "run-1" as never, ordinal: 1, status: "completed" },
      providerThreads: [],
      turnItems: [],
      pullRequests,
    });
    expect(tasks).toEqual([
      {
        taskId: "pull-request-watch:github.com/acme/app#1",
        description: "Watching pull request #1",
        kind: "monitor",
        awaited: true,
      },
    ]);
    expect(backgroundWorkHoldsCompletion(tasks)).toBe(true);
  });

  it("keeps a thread that never ran waiting on its watch", () => {
    expect(
      derivePendingBackgroundWork({
        latestRun: null,
        providerThreads: [],
        turnItems: [],
        pullRequests,
      }).map((task) => task.taskId),
    ).toEqual(["pull-request-watch:github.com/acme/app#1"]);
  });

  it("lists no watch while a run is active", () => {
    expect(
      derivePendingBackgroundWork({
        latestRun: { id: "run-1" as never, ordinal: 1, status: "running" },
        providerThreads: [],
        turnItems: [],
        pullRequests,
      }),
    ).toEqual([]);
  });
});

it("takes each subagent item's instance from its joined owner", () => {
  const owner = ProviderInstanceId.make("claude-owner");
  const tasks = derivePendingBackgroundWork({
    latestRun: { id: "run-1" as never, ordinal: 1, status: "completed" },
    providerThreads: [],
    turnItems: [
      {
        id: "owned-item",
        owningProviderInstanceId: owner,
        type: "subagent",
        status: "running",
        title: null,
      },
      { id: "unknown-item", type: "subagent", status: "running", title: null },
    ],
  });
  expect(tasks).toEqual([
    { taskId: "owned-item", kind: "subagent", providerInstanceId: owner },
    { taskId: "unknown-item", kind: "subagent" },
  ]);
});

it("takes a roster subagent's instance from its owning provider thread", () => {
  const owner = ProviderInstanceId.make("claude-owner");
  const tasks = derivePendingBackgroundWork({
    latestRun: { id: "run-1" as never, ordinal: 1, status: "completed" },
    providerThreads: [
      {
        id: ProviderThreadId.make("pt-owner"),
        providerInstanceId: owner,
        pendingBackgroundTasks: [
          {
            taskId: "roster-item",
            kind: "subagent",
            providerInstanceId: ProviderInstanceId.make("other"),
          },
        ],
      },
    ],
    turnItems: [],
  });
  expect(tasks).toEqual([{ taskId: "roster-item", kind: "subagent", providerInstanceId: owner }]);
});
