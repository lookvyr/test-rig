import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EnvironmentId,
  NodeId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  ContextTransferId,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as DateTime from "effect/DateTime";
import { ProviderInstanceRegistry } from "../provider/Services/ProviderInstanceRegistry.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProviderRegistry from "../provider/Services/ProviderRegistry.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as Service from "./OrchestratorMcpService.ts";
import type { McpInvocationScope } from "./McpInvocationContext.ts";

it.effect.each(["completed", "queued", "running", "waiting_for_children"] as const)(
  "keeps original and %s follow-up task results separate",
  (state) =>
    Effect.gen(function* () {
      const parentId = ThreadId.make("status-parent");
      const childId = ThreadId.make("status-child");
      const originalId = NodeId.make("original-task");
      const followupId = NodeId.make("followup-task");
      const originalRunId = RunId.make("original-run");
      const followupRunId = RunId.make("followup-run");
      const now = yield* DateTime.now;
      const baseTask = {
        threadId: parentId,
        childThreadId: childId,
        origin: "app_owned",
        driver: "codex",
        model: "model",
        completionDelivery: { state: "acknowledged" },
      };
      const original = {
        ...baseTask,
        id: originalId,
        status: "completed",
        result: "Original result",
      };
      const followup = {
        ...baseTask,
        id: followupId,
        status: state === "queued" ? "pending" : "running",
        result: state === "completed" ? "Follow-up result" : null,
      };
      const transfer = (runId: RunId, id: string) => ({
        id: ContextTransferId.make(id),
        type: "subagent_result",
        sourceThreadId: childId,
        targetThreadId: parentId,
        sourcePoint: { runId },
      });
      const parent = {
        thread: { id: parentId },
        runs: [],
        subagents: [original, followup],
        contextTransfers: [
          transfer(originalRunId, "original-transfer"),
          ...(state === "completed" ? [transfer(followupRunId, "followup-transfer")] : []),
        ],
      } as unknown as OrchestrationV2ThreadProjection;
      const child = {
        thread: { id: childId, projectId: ProjectId.make("project") },
        runs: [
          { id: originalRunId, ordinal: 1, status: "completed", startedAt: now },
          {
            id: followupRunId,
            ordinal: 2,
            status: state === "waiting_for_children" ? "completed" : state,
            delegatedTaskId: followupId,
            startedAt: state === "queued" ? null : now,
          },
        ],
        messages: [],
        turnItems: [],
        contextTransfers: [],
        providerThreads: [],
        runtimeRequests: [],
        subagents:
          state === "waiting_for_children" ? [{ runId: followupRunId, status: "running" }] : [],
      } as unknown as OrchestrationV2ThreadProjection;
      const pendingCalls: Array<string | undefined> = [];
      const scope: McpInvocationScope = {
        environmentId: EnvironmentId.make("env"),
        threadId: parentId,
        providerSessionId: "session",
        providerInstanceId: ProviderInstanceId.make("codex"),
        capabilities: new Set(["orchestration"]),
        issuedAt: 1,
      };
      yield* Effect.gen(function* () {
        const service = yield* Service.OrchestratorMcpService;
        const prior = yield* service.taskStatus(scope, originalId);
        assert.equal(prior.summary, "Original result");
        assert.equal(prior.childRunId, originalRunId);
        assert.equal(prior.resultContextTransferId, "original-transfer");
        const next = yield* service.taskStatus(scope, followupId);
        assert.equal(next.childRunId, followupRunId);
        assert.equal(
          next.resultContextTransferId,
          state === "completed" ? "followup-transfer" : null,
        );
        assert.equal(
          next.workState,
          state === "completed"
            ? "result_available"
            : state === "waiting_for_children"
              ? "waiting_for_children"
              : "working",
        );
        assert.equal(
          next.status,
          state === "completed" ? "completed" : state === "queued" ? "queued" : "running",
        );
        if (state === "waiting_for_children") assert.isNull(next.summary);
        assert.equal((yield* service.taskStatus(scope, originalId)).summary, "Original result");
      }).pipe(
        Effect.provide(
          Service.layer.pipe(
            Layer.provide(
              Layer.mergeAll(
                NodeServices.layer,
                Layer.mock(ProviderInstanceRegistry)({
                  getInstance: () => Effect.succeed(undefined),
                }),
                Layer.mock(ProjectService.ProjectService)({}),
                Layer.mock(SecretRequests.SecretRequests)({}),
                Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
                Layer.mock(GitVcsDriver.GitVcsDriver)({}),
                Layer.mock(ThreadManagementService.ThreadManagementService)({
                  getThreadRecords: (id) => Effect.succeed(id === parentId ? parent : child),
                  delegatedTaskResultPending: (_id, taskId) =>
                    Effect.sync(() => {
                      pendingCalls.push(taskId);
                      return state === "waiting_for_children";
                    }),
                  dispatch: () => Effect.succeed({} as never),
                }),
                Layer.mock(ProviderRegistry.ProviderRegistry)({ getProviders: Effect.succeed([]) }),
                Layer.mock(ProviderAdapterRegistry.ProviderAdapterRegistryV2)({
                  list: () => Effect.succeed([]),
                }),
                Layer.mock(ScheduledTaskService.ScheduledTaskService)({}),
              ),
            ),
          ),
        ),
      );
    }),
);

it.effect.each(["original", "followup", "stale_original"] as const)(
  "only exposes a pending question to its %s task",
  (questionOwner) =>
    Effect.gen(function* () {
      const parentId = ThreadId.make("question-parent");
      const childId = ThreadId.make("question-child");
      const originalId = NodeId.make("question-original");
      const followupId = NodeId.make("question-followup");
      const originalRunId = RunId.make("question-original-run");
      const followupRunId = RunId.make("question-followup-run");
      const now = yield* DateTime.now;
      const baseTask = {
        threadId: parentId,
        childThreadId: childId,
        origin: "app_owned",
        driver: "codex",
        result: null,
        completionDelivery: { state: "acknowledged" },
      };
      const parent = {
        thread: { id: parentId },
        runs: [],
        subagents: [
          {
            ...baseTask,
            id: originalId,
            status: questionOwner === "original" ? "running" : "completed",
            result: questionOwner === "original" ? null : "Original result",
          },
          {
            ...baseTask,
            id: followupId,
            status: questionOwner === "original" ? "pending" : "running",
          },
        ],
        contextTransfers: [],
      } as unknown as OrchestrationV2ThreadProjection;
      const child = {
        thread: { id: childId, projectId: ProjectId.make("project") },
        runs: [
          {
            id: originalRunId,
            ordinal: 1,
            status: questionOwner === "original" ? "waiting" : "completed",
            startedAt: now,
          },
          {
            id: followupRunId,
            ordinal: 2,
            status: questionOwner === "original" ? "queued" : "waiting",
            delegatedTaskId: followupId,
            startedAt: questionOwner === "original" ? null : now,
          },
        ],
        nodes: [
          {
            id: NodeId.make("question-node"),
            runId: questionOwner === "followup" ? followupRunId : originalRunId,
          },
        ],
        messages: [],
        turnItems: [],
        contextTransfers: [],
        subagents: [],
        providerThreads: [],
        runtimeRequests: [
          {
            nodeId: NodeId.make("question-node"),
            kind: "user_input",
            status: "pending",
            responseCapability: { type: "live" },
          },
        ],
      } as unknown as OrchestrationV2ThreadProjection;
      const scope: McpInvocationScope = {
        environmentId: EnvironmentId.make("env"),
        threadId: parentId,
        providerSessionId: "session",
        providerInstanceId: ProviderInstanceId.make("codex"),
        capabilities: new Set(["orchestration"]),
        issuedAt: 1,
      };
      yield* Effect.gen(function* () {
        const service = yield* Service.OrchestratorMcpService;
        assert.equal(
          (yield* service.taskStatus(scope, originalId)).hasPendingQuestion,
          questionOwner === "original",
        );
        assert.equal(
          (yield* service.taskStatus(scope, followupId)).hasPendingQuestion,
          questionOwner === "followup",
        );
      }).pipe(
        Effect.provide(
          Service.layer.pipe(
            Layer.provide(
              Layer.mergeAll(
                NodeServices.layer,
                Layer.mock(ProviderInstanceRegistry)({
                  getInstance: () => Effect.succeed(undefined),
                }),
                Layer.mock(ProjectService.ProjectService)({}),
                Layer.mock(SecretRequests.SecretRequests)({}),
                Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
                Layer.mock(GitVcsDriver.GitVcsDriver)({}),
                Layer.mock(ThreadManagementService.ThreadManagementService)({
                  getThreadRecords: (id) => Effect.succeed(id === parentId ? parent : child),
                  delegatedTaskResultPending: () => Effect.succeed(false),
                  dispatch: () => Effect.succeed({} as never),
                }),
                Layer.mock(ProviderRegistry.ProviderRegistry)({ getProviders: Effect.succeed([]) }),
                Layer.mock(ProviderAdapterRegistry.ProviderAdapterRegistryV2)({
                  list: () => Effect.succeed([]),
                }),
                Layer.mock(ScheduledTaskService.ScheduledTaskService)({}),
              ),
            ),
          ),
        ),
      );
    }),
);
