import { ProviderInstanceId, ProviderThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  backgroundWorkHoldsCompletion,
  derivePendingBackgroundWork,
} from "./orchestrationV2PendingBackgroundWork.ts";

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

  it("keeps a settled run waiting on each visible watch, as a monitor", () => {
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
