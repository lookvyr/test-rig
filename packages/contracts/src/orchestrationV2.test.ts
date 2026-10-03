import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import { NodeId, ProviderInstanceId, TrimmedNonEmptyString } from "./index.ts";
import {
  OrchestrationV2ProviderThread,
  OrchestrationV2ProviderThreadJson,
  OrchestrationV2ThreadShell,
  OrchestrationV2TurnItem,
  OrchestrationV2TurnItemJson,
} from "./orchestrationV2.ts";
const now = DateTime.makeUnsafe("2026-04-20T00:00:00.000Z");
const decodeOrchestrationV2ProviderThread = Schema.decodeUnknownSync(OrchestrationV2ProviderThread);
const decodeOrchestrationV2ProviderThreadJson = Schema.decodeUnknownSync(
  OrchestrationV2ProviderThreadJson,
);
const encodeOrchestrationV2ProviderThreadJson = Schema.encodeSync(
  OrchestrationV2ProviderThreadJson,
);
const decodeOrchestrationV2ThreadShell = Schema.decodeUnknownSync(OrchestrationV2ThreadShell);
const decodeOrchestrationV2TurnItem = Schema.decodeUnknownSync(OrchestrationV2TurnItem);
const decodeOrchestrationV2TurnItemJson = Schema.decodeUnknownSync(OrchestrationV2TurnItemJson);
const encodeOrchestrationV2TurnItemJson = Schema.encodeSync(OrchestrationV2TurnItemJson);
it("decodes historical provider-thread JSON without pendingBackgroundTasks as empty roster", () => {
  const providerThread = decodeOrchestrationV2ProviderThreadJson({
    id: "provider-thread-1",
    driver: "claude",
    providerInstanceId: "claudeAgent",
    providerSessionId: "provider-session-1",
    appThreadId: "thread-1",
    ownerNodeId: null,
    nativeThreadRef: {
      driver: "claude",
      nativeId: "native-session-1",
      strength: "strong",
    },
    nativeConversationHeadRef: null,
    status: "idle",
    firstRunOrdinal: 1,
    lastRunOrdinal: 1,
    handoffIds: [],
    forkedFrom: null,
    createdAt: "2026-04-20T00:00:00.000Z",
    updatedAt: "2026-04-20T00:00:00.000Z",
  });

  expect(providerThread.pendingBackgroundTasks).toEqual([]);
  expect(providerThread.contextUsage).toBeNull();
  expect(providerThread.nativeMetadata).toBeNull();

  const runtimeThread = decodeOrchestrationV2ProviderThread({
    id: "provider-thread-2",
    driver: "claude",
    providerInstanceId: "claudeAgent",
    providerSessionId: null,
    appThreadId: "thread-2",
    ownerNodeId: null,
    nativeThreadRef: null,
    nativeConversationHeadRef: null,
    status: "idle",
    firstRunOrdinal: null,
    lastRunOrdinal: null,
    handoffIds: [],
    forkedFrom: null,
    createdAt: now,
    updatedAt: now,
  });
  expect(runtimeThread.pendingBackgroundTasks).toEqual([]);
  expect(runtimeThread.contextUsage).toBeNull();
  expect(runtimeThread.nativeMetadata).toBeNull();
});

it("decodes historical thread shell JSON without pendingBackgroundTasks as empty roster", () => {
  const shell = decodeOrchestrationV2ThreadShell({
    createdBy: "user",
    creationSource: "web",
    id: "thread-1",
    projectId: "project-1",
    title: "Thread",
    providerInstanceId: "claudeAgent",
    modelSelection: {
      instanceId: ProviderInstanceId.make("claudeAgent"),
      model: "claude-sonnet",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    lineage: {
      parentThreadId: null,
      relationshipToParent: null,
      rootThreadId: "thread-1",
    },
    forkedFrom: null,
    activeProviderThreadId: "provider-thread-1",
    latestRunId: "run-1",
    activeRunId: null,
    status: "completed",
    pendingRuntimeRequest: null,
    latestVisibleMessage: null,
    latestUserMessageAt: null,
    hasActionableProposedPlan: false,
    itemCount: 0,
    visibleItemCount: 0,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
  });

  expect(shell.pendingBackgroundTasks).toEqual([]);
});

it("round-trips typed notifications and keeps work outcome separate from item status", () => {
  const now = DateTime.makeUnsafe("2026-09-09T00:00:00Z");
  const base = {
    id: "notification",
    threadId: "parent",
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 1,
    status: "completed",
    title: null,
    startedAt: null,
    completedAt: null,
    type: "notification",
    outcome: "failed",
    summary: "Build failed",
    detail: "Exit code 1",
  };
  for (const source of [
    { kind: "delegated_task", taskIds: ["task-1", "task-2"] },
    { kind: "delegated_task", taskIds: ["task-1"], childThreadId: "child" },
    { kind: "subagent", childThreadId: "child" },
    { kind: "subagent" },
    { kind: "command" },
    { kind: "monitor" },
    { kind: "background_task" },
  ]) {
    const runtime = decodeOrchestrationV2TurnItem({ ...base, source, updatedAt: now });
    const wire = encodeOrchestrationV2TurnItemJson(runtime);
    expect(decodeOrchestrationV2TurnItemJson(wire)).toEqual(runtime);
    expect(runtime).toMatchObject({ status: "completed", outcome: "failed", source });
    expect(runtime).not.toHaveProperty("messageId");
    expect(() =>
      decodeOrchestrationV2TurnItem({ ...base, source, summary: "", updatedAt: now }),
    ).toThrow();
  }
  // A known kind with fields that do not decode is a real defect, not a newer kind.
  expect(() =>
    decodeOrchestrationV2TurnItem({ ...base, source: { kind: "delegated_task" }, updatedAt: now }),
  ).toThrow();
  expect(() =>
    decodeOrchestrationV2TurnItem({
      ...base,
      source: { kind: "subagent", childThreadId: 7 },
      updatedAt: now,
    }),
  ).toThrow();
});

describe("background work kinds from older or newer servers", () => {
  const storedNotification = (source: unknown) => ({
    id: "notification",
    threadId: "parent",
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 1,
    status: "completed",
    title: null,
    startedAt: null,
    completedAt: null,
    updatedAt: "2026-09-09T00:00:00.000Z",
    type: "notification",
    outcome: "completed",
    summary: "Background activity updated",
    source,
  });

  it("decodes notification sources stored before specific kinds existed", () => {
    const sourceOf = (source: unknown) => {
      const item = decodeOrchestrationV2TurnItemJson(storedNotification(source));
      return item.type === "notification" ? item.source : undefined;
    };
    expect(
      sourceOf({ kind: "background_task", nativeRef: { driver: "claude", nativeId: "task-1" } }),
    ).toEqual({ kind: "background_task" });
    expect(sourceOf({ kind: "background_command" })).toEqual({ kind: "command" });
    expect(sourceOf({ kind: "monitor" })).toEqual({ kind: "monitor" });
  });

  it("sends and stores sources that clients from before specific kinds still decode", () => {
    // The notification source schema clients shipped with before #13948. They
    // reject a kind outside it, which fails the whole thread load.
    const PreSpecificKindsNotification = Schema.Struct({
      type: Schema.Literal("notification"),
      source: Schema.Union([
        Schema.Struct({ kind: Schema.Literal("delegated_task"), taskIds: Schema.Array(NodeId) }),
        Schema.Struct({
          kind: Schema.Literals(["background_task", "background_command", "monitor"]),
          nativeRef: Schema.optional(Schema.Unknown),
        }),
      ]),
      outcome: Schema.Literals(["completed", "failed", "cancelled", "updated", "unknown"]),
      summary: Schema.String,
      detail: Schema.optional(Schema.String),
    });
    const decodePreSpecificKinds = Schema.decodeUnknownSync(PreSpecificKindsNotification);
    const sendOverWire = Schema.encodeSync(Schema.toCodecJson(OrchestrationV2TurnItem));
    const cases = [
      [{ kind: "subagent", childThreadId: "child" }, { kind: "background_task" }],
      [{ kind: "subagent" }, { kind: "background_task" }],
      [{ kind: "command" }, { kind: "background_command" }],
      [{ kind: "monitor" }, { kind: "monitor" }],
      [{ kind: "background_task" }, { kind: "background_task" }],
      [
        { kind: "delegated_task", taskIds: ["task-1"], childThreadId: "child" },
        { kind: "delegated_task", taskIds: ["task-1"] },
      ],
    ] as const;
    for (const [source, preSpecificKindsSource] of cases) {
      const item = decodeOrchestrationV2TurnItemJson(storedNotification(source));
      for (const encoded of [encodeOrchestrationV2TurnItemJson(item), sendOverWire(item)]) {
        expect(decodePreSpecificKinds(encoded).source).toEqual(preSpecificKindsSource);
        // Current clients read the specific kind back.
        expect(decodeOrchestrationV2TurnItemJson(encoded)).toEqual(item);
      }
      expect(item).toMatchObject({ source });
    }
  });

  it("decodes a notification source kind from a newer server as generic background work", () => {
    const item = decodeOrchestrationV2TurnItemJson(
      storedNotification({ kind: "workflow", workflowId: "wf-1" }),
    );
    expect(item).toMatchObject({ type: "notification", source: { kind: "background_task" } });
  });

  it("decodes rosters stored before kinds existed, and kinds from a newer server, as generic tasks", () => {
    const providerThread = decodeOrchestrationV2ProviderThreadJson({
      id: "provider-thread-1",
      driver: "claude",
      providerInstanceId: "claudeAgent",
      providerSessionId: null,
      appThreadId: "thread-1",
      ownerNodeId: null,
      nativeThreadRef: null,
      nativeConversationHeadRef: null,
      status: "idle",
      firstRunOrdinal: 1,
      lastRunOrdinal: 1,
      handoffIds: [],
      forkedFrom: null,
      createdAt: "2026-04-20T00:00:00.000Z",
      updatedAt: "2026-04-20T00:00:00.000Z",
      pendingBackgroundTasks: [
        { taskId: "bg-1", description: "Background sleep", taskType: "local_bash" },
        { taskId: "bg-2" },
        { taskId: "bg-3", description: "Nightly", kind: "workflow", schedule: "0 3 * * *" },
        { taskId: "bg-4", description: "npm test", kind: "command" },
        { taskId: "bg-5", kind: "subagent", childThreadId: "thread-child" },
      ],
    });
    expect(providerThread.pendingBackgroundTasks).toEqual([
      { taskId: "bg-1", description: "Background sleep", kind: "background_task" },
      { taskId: "bg-2", kind: "background_task" },
      { taskId: "bg-3", description: "Nightly", kind: "background_task" },
      { taskId: "bg-4", description: "npm test", kind: "command" },
      { taskId: "bg-5", kind: "subagent", childThreadId: "thread-child" },
    ]);
    // The fallback is decode-only: what was decoded encodes as its known member.
    const encoded = encodeOrchestrationV2ProviderThreadJson(providerThread).pendingBackgroundTasks;
    expect(encoded).toEqual(providerThread.pendingBackgroundTasks);
    // Clients from before kinds read a roster entry as this struct and ignore `kind`.
    const decodePreKindsRoster = Schema.decodeUnknownSync(
      Schema.Array(
        Schema.Struct({
          taskId: TrimmedNonEmptyString,
          description: Schema.optional(TrimmedNonEmptyString),
          taskType: Schema.optional(TrimmedNonEmptyString),
        }),
      ),
    );
    expect(decodePreKindsRoster(encoded).map((task) => task.taskId)).toEqual([
      "bg-1",
      "bg-2",
      "bg-3",
      "bg-4",
      "bg-5",
    ]);
    expect(() =>
      decodeOrchestrationV2ProviderThreadJson({
        ...encodeOrchestrationV2ProviderThreadJson(providerThread),
        pendingBackgroundTasks: [{ taskId: "", kind: "command" }],
      }),
    ).toThrow();
  });
});
