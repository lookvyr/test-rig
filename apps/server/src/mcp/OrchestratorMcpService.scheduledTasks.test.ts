// @effect-diagnostics anyUnknownInErrorContext:off
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ScheduledTaskId,
  ThreadId,
  type OrchestrationV2ThreadProjection,
  type ProviderInteractionMode,
  type RuntimeMode,
  type ScheduledTask,
  type ScheduledTaskUpsertInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import * as ProjectService from "../project/ProjectService.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProviderRegistry from "../provider/Services/ProviderRegistry.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import type { McpInvocationScope } from "./McpInvocationContext.ts";
import * as OrchestratorMcpService from "./OrchestratorMcpService.ts";
import * as TaskFolders from "../workspace/TaskFolders.ts";

const callerThreadId = ThreadId.make("thread:schedule-caller");
const ownProjectId = ProjectId.make("project:own");
const otherProjectId = ProjectId.make("project:other");
const boundThreadId = ThreadId.make("thread:schedule-bound");
const codex = ProviderInstanceId.make("codex");

const scope: McpInvocationScope = {
  environmentId: EnvironmentId.make("environment:schedule"),
  threadId: callerThreadId,
  providerSessionId: "provider-session:schedule",
  providerInstanceId: codex,
  capabilities: new Set(["orchestration"]),
  issuedAt: 1,
};

const task = (input: {
  readonly id: string;
  readonly projectId: ProjectId;
  readonly runtimeMode?: RuntimeMode;
  readonly interactionMode?: ProviderInteractionMode;
  readonly threadId?: ThreadId | null;
}): ScheduledTask => ({
  id: ScheduledTaskId.make(input.id),
  title: input.id,
  prompt: "Check the build",
  enabled: true,
  schedule: { type: "interval", everyMs: 3_600_000 },
  projectId: input.projectId,
  threadId: input.threadId ?? null,
  workspaceStrategy: { type: "root" },
  modelSelection: { instanceId: codex, model: "gpt-5" },
  runtimeMode: input.runtimeMode ?? "approval-required",
  interactionMode: input.interactionMode ?? "default",
  createdBy: "user",
  creationSource: "web",
  createdAt: "2026-11-16T00:00:00.000Z",
  updatedAt: "2026-11-16T00:00:00.000Z",
  nextRunAt: null,
  lastRunAt: null,
  lastRunStatus: "never",
  lastRunError: null,
  runCount: 0,
});

const tasks = [
  task({ id: "task:full-access", projectId: otherProjectId, runtimeMode: "full-access" }),
  task({ id: "task:supervised", projectId: otherProjectId }),
  task({ id: "task:own", projectId: ownProjectId }),
  // The task itself is supervised, but its runs post into a full-access thread.
  task({ id: "task:bound-full-access", projectId: otherProjectId, threadId: boundThreadId }),
];

const run = (scenario: {
  readonly liveCaller: boolean;
  readonly callerRuntimeMode?: RuntimeMode;
  readonly body: (context: {
    readonly service: OrchestratorMcpService.OrchestratorMcpService["Service"];
    readonly upserts: Ref.Ref<ReadonlyArray<ScheduledTaskUpsertInput>>;
    readonly deletes: Ref.Ref<ReadonlyArray<string>>;
  }) => Effect.Effect<void, unknown>;
}) =>
  Effect.gen(function* () {
    const upserts = yield* Ref.make<ReadonlyArray<ScheduledTaskUpsertInput>>([]);
    const deletes = yield* Ref.make<ReadonlyArray<string>>([]);
    const caller = {
      thread: {
        id: callerThreadId,
        projectId: ownProjectId,
        runtimeMode: scenario.callerRuntimeMode ?? "auto",
        interactionMode: "default",
        modelSelection: { instanceId: codex, model: "gpt-5" },
        archivedAt: null,
        deletedAt: null,
      },
      runs: scenario.liveCaller
        ? [
            {
              id: RunId.make("run:schedule-caller"),
              ordinal: 1,
              status: "running",
              providerInstanceId: codex,
            },
          ]
        : [],
      messages: [],
      subagents: [],
      providerThreads: [],
      providerTurns: [],
      runtimeRequests: [],
      contextTransfers: [],
      turnItems: [],
    } as unknown as OrchestrationV2ThreadProjection;
    const dependencies = Layer.mergeAll(
      NodeServices.layer,
      Layer.mock(ProjectService.ProjectService)({
        getById: (projectId) =>
          Effect.succeed(
            Option.some({ id: projectId, workspaceRoot: `/repos/${projectId}` } as never),
          ),
      }),
      Layer.mock(ThreadManagementService.ThreadManagementService)({
        getThreadRecords: () => Effect.succeed(caller),
        getThreadShell: (threadId) =>
          Effect.succeed(
            threadId === boundThreadId
              ? ({
                  id: boundThreadId,
                  runtimeMode: "full-access",
                  interactionMode: "default",
                  deletedAt: null,
                } as never)
              : ({
                  id: callerThreadId,
                  archivedAt: null,
                  activeRunId: null,
                  providerInstanceId: codex,
                  pendingBackgroundTasks: [],
                } as never),
          ),
      }),
      Layer.mock(ProviderRegistry.ProviderRegistry)({ getProviders: Effect.succeed([]) }),
      Layer.mock(ProviderAdapterRegistry.ProviderAdapterRegistryV2)({
        list: () => Effect.succeed([]),
      }),
      Layer.mock(ScheduledTaskService.ScheduledTaskService)({
        list: () => Effect.succeed({ timeZone: "UTC", tasks }),
        upsert: (input) =>
          Ref.update(upserts, (current) => [...current, input]).pipe(
            Effect.as({
              task: {
                ...task({
                  id: input.id ?? "task:new",
                  projectId: input.projectId,
                  threadId: input.threadId ?? null,
                }),
                workspaceStrategy: input.workspaceStrategy,
              },
            }),
          ),
        delete: ({ id }) =>
          Ref.update(deletes, (current) => [...current, id]).pipe(Effect.as({ id })),
      }),
      Layer.mock(SecretRequests.SecretRequests)({}),
    );
    const layer = OrchestratorMcpService.layer.pipe(
      Layer.provide(TaskFolders.layerTest),
      Layer.provide(Layer.mock(ThreadLaunchService.ThreadLaunchService)({})),
      Layer.provide(
        Layer.mock(GitVcsDriver.GitVcsDriver)({
          resolvePrimaryRemoteName: () => Effect.succeed("origin"),
          resolveDefaultBranchName: () => Effect.succeed("trunk"),
          resolveCommit: ({ revision }) =>
            revision === "refs/remotes/origin/trunk"
              ? Effect.succeed({ commitSha: "abc123" } as never)
              : Effect.fail({ _tag: "GitCommandError" } as never),
        }),
      ),
      Layer.provide(dependencies),
    );
    yield* Effect.gen(function* () {
      const service = yield* OrchestratorMcpService.OrchestratorMcpService;
      yield* scenario.body({ service, upserts, deletes });
    }).pipe(Effect.provide(layer));
  });

describe("OrchestratorMcpService scheduled tasks", () => {
  it.effect("refuses to change a task that runs above the caller's modes", () =>
    run({
      liveCaller: true,
      callerRuntimeMode: "approval-required",
      body: ({ service, upserts, deletes }) =>
        Effect.gen(function* () {
          for (const scheduledTaskId of ["task:full-access", "task:bound-full-access"]) {
            const update = yield* service
              .saveScheduledTask(scope, {
                scheduledTaskId: ScheduledTaskId.make(scheduledTaskId),
                prompt: "Push to production",
              })
              .pipe(Effect.flip);
            assert.equal(update.code, "runtime_mode_escalation_denied");
            const remove = yield* service
              .deleteScheduledTask(scope, {
                scheduledTaskId: ScheduledTaskId.make(scheduledTaskId),
              })
              .pipe(Effect.flip);
            assert.equal(remove.code, "runtime_mode_escalation_denied");
          }
          assert.deepEqual(yield* Ref.get(upserts), []);
          assert.deepEqual(yield* Ref.get(deletes), []);

          yield* service.saveScheduledTask(scope, {
            scheduledTaskId: ScheduledTaskId.make("task:supervised"),
            prompt: "Check the build again",
          });
          yield* service.deleteScheduledTask(scope, {
            scheduledTaskId: ScheduledTaskId.make("task:supervised"),
          });
          assert.equal((yield* Ref.get(upserts)).length, 1);
          assert.deepEqual(yield* Ref.get(deletes), ["task:supervised"]);
        }),
    }),
  );

  it.effect("acts on another project's tasks only from a live turn", () =>
    run({
      liveCaller: false,
      body: ({ service, upserts, deletes }) =>
        Effect.gen(function* () {
          const create = yield* service
            .saveScheduledTask(scope, {
              projectId: otherProjectId,
              prompt: "Check the build",
              schedule: { type: "interval", everyMs: 3_600_000 },
            })
            .pipe(Effect.flip);
          assert.equal(create.code, "parent_not_active");
          const update = yield* service
            .saveScheduledTask(scope, {
              scheduledTaskId: ScheduledTaskId.make("task:supervised"),
              prompt: "Check it again",
            })
            .pipe(Effect.flip);
          assert.equal(update.code, "parent_not_active");
          const remove = yield* service
            .deleteScheduledTask(scope, {
              scheduledTaskId: ScheduledTaskId.make("task:supervised"),
            })
            .pipe(Effect.flip);
          assert.equal(remove.code, "parent_not_active");
          // The caller's own project needs no live turn, as before.
          yield* service.deleteScheduledTask(scope, {
            scheduledTaskId: ScheduledTaskId.make("task:own"),
          });
          assert.deepEqual(yield* Ref.get(upserts), []);
          assert.deepEqual(yield* Ref.get(deletes), ["task:own"]);
        }),
    }),
  );

  it.effect("starts unbound runs from the project's default branch", () =>
    run({
      liveCaller: true,
      body: ({ service, upserts }) =>
        Effect.gen(function* () {
          yield* service.saveScheduledTask(scope, {
            projectId: otherProjectId,
            prompt: "Check the build",
            schedule: { type: "interval", everyMs: 3_600_000 },
          });
          assert.deepEqual((yield* Ref.get(upserts))[0]?.workspaceStrategy, {
            type: "worktree",
            baseRef: "trunk",
            startFromOrigin: true,
          });
        }),
    }),
  );

  it.effect("refuses freshSession for a task with no bound thread", () =>
    run({
      liveCaller: true,
      body: ({ service, upserts }) =>
        Effect.gen(function* () {
          const create = yield* service
            .saveScheduledTask(scope, {
              prompt: "Check the build",
              schedule: { type: "interval", everyMs: 3_600_000 },
              bindToCurrentThread: false,
              freshSession: true,
            })
            .pipe(Effect.flip);
          assert.equal(create.code, "invalid_request");
          const update = yield* service
            .saveScheduledTask(scope, {
              scheduledTaskId: ScheduledTaskId.make("task:supervised"),
              freshSession: true,
            })
            .pipe(Effect.flip);
          assert.equal(update.code, "invalid_request");
          assert.deepEqual(yield* Ref.get(upserts), []);
          // A bound task takes it.
          yield* service.saveScheduledTask(scope, {
            prompt: "Check the build",
            schedule: { type: "interval", everyMs: 3_600_000 },
            freshSession: true,
          });
          assert.equal((yield* Ref.get(upserts))[0]?.freshSession, true);
        }),
    }),
  );
  it.effect("an auto caller may change tasks that run at full access", () =>
    run({
      liveCaller: true,
      body: ({ service, upserts, deletes }) =>
        Effect.gen(function* () {
          for (const scheduledTaskId of ["task:full-access", "task:bound-full-access"]) {
            yield* service.saveScheduledTask(scope, {
              scheduledTaskId: ScheduledTaskId.make(scheduledTaskId),
              prompt: "Check the build again",
            });
            yield* service.deleteScheduledTask(scope, {
              scheduledTaskId: ScheduledTaskId.make(scheduledTaskId),
            });
          }
          assert.equal((yield* Ref.get(upserts)).length, 2);
          assert.deepEqual(yield* Ref.get(deletes), ["task:full-access", "task:bound-full-access"]);
        }),
    }),
  );

  it.effect.each(["approval-required", "auto-accept-edits"] as const)(
    "a %s caller cannot schedule tasks",
    (callerRuntimeMode) =>
      run({
        liveCaller: true,
        callerRuntimeMode,
        body: ({ service, upserts }) =>
          Effect.gen(function* () {
            const failure = yield* service
              .saveScheduledTask(scope, {
                prompt: "Check the build",
                schedule: { type: "interval", everyMs: 3_600_000 },
              })
              .pipe(Effect.flip);
            assert.equal(failure.code, "capability_denied");
            assert.deepEqual(yield* Ref.get(upserts), []);
          }),
      }),
  );

  it.effect("tasks scheduled from an auto thread run in Auto", () =>
    run({
      liveCaller: true,
      body: ({ service, upserts }) =>
        Effect.gen(function* () {
          yield* service.saveScheduledTask(scope, {
            prompt: "Check the build",
            schedule: { type: "interval", everyMs: 3_600_000 },
          });
          assert.equal((yield* Ref.get(upserts))[0]?.runtimeMode, "auto");
        }),
    }),
  );
});
