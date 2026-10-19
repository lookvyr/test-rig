import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { EnvironmentId, ThreadId, type ThreadPullRequestLink } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import { ProviderInstanceRegistry } from "../provider/Services/ProviderInstanceRegistry.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderRegistry from "../provider/Services/ProviderRegistry.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import { v2Projection, v2ThreadShell } from "../orchestration-v2/testkit/fixtures.ts";
import * as OrchestratorMcpService from "./OrchestratorMcpService.ts";
import type { McpInvocationScope } from "./McpInvocationContext.ts";

it.effect(
  "list and read agree on effective snooze and every visible PR, with filtering before pagination",
  () =>
    Effect.gen(function* () {
      const now = DateTime.makeUnsafe("2026-10-19T12:00:00Z");
      yield* TestClock.setTime(DateTime.toEpochMillis(now));
      const until = DateTime.makeUnsafe("2026-10-20T12:00:00Z");
      const snoozedAt = DateTime.makeUnsafe("2026-10-19T10:00:00Z");
      const fresh = DateTime.makeUnsafe("2026-10-19T11:00:00Z");
      const old = DateTime.makeUnsafe("2026-10-19T09:00:00Z");
      const link: ThreadPullRequestLink = {
        host: "github.com",
        repository: "example/repo",
        number: 1,
        url: "https://github.com/example/repo/pull/1",
        source: "agent",
        linkedAt: DateTime.formatIso(now),
        snapshot: null,
        stack: null,
      };
      const links = [
        link,
        {
          ...link,
          number: 2,
          url: "https://github.com/example/repo/pull/2",
          snapshot: {
            state: "merged" as const,
            title: "Second",
            headBranch: "feature",
            baseBranch: "main",
            isDraft: false,
            updatedAt: null,
            syncedAt: DateTime.formatIso(now),
          },
        },
        { ...link, number: 3, source: "stack-dismissed" as const },
      ];
      const base = { ...v2ThreadShell, snoozedAt, snoozedUntil: until, pullRequests: links };
      const shells = [
        base,
        { ...base, id: ThreadId.make("expired"), snoozedUntil: old },
        {
          ...base,
          id: ThreadId.make("completed"),
          status: "completed" as const,
          latestRunCompletedAt: fresh,
        },
        {
          ...base,
          id: ThreadId.make("failed"),
          status: "failed" as const,
          latestRunCompletedAt: fresh,
        },
        {
          ...base,
          id: ThreadId.make("seen-failure"),
          status: "failed" as const,
          latestRunCompletedAt: old,
        },
        {
          ...base,
          id: ThreadId.make("interrupted"),
          status: "interrupted" as const,
          latestRunCompletedAt: fresh,
        },
        {
          ...base,
          id: ThreadId.make("question"),
          pendingRuntimeRequest: { kind: "user_input" } as never,
        },
      ];
      const projection = {
        ...v2Projection,
        thread: { ...v2Projection.thread, pullRequests: links },
      };
      const scope: McpInvocationScope = {
        environmentId: EnvironmentId.make("state-test"),
        threadId: base.id,
        providerSessionId: "state-test",
        providerInstanceId: base.providerInstanceId,
        capabilities: new Set(["orchestration"]),
        issuedAt: 1,
      };
      const dependencies = Layer.mergeAll(
        NodeServices.layer,
        Layer.mock(SecretRequests.SecretRequests)({}),
        Layer.mock(ProviderInstanceRegistry)({ getInstance: () => Effect.succeed(undefined) }),
        Layer.mock(ProjectService.ProjectService)({}),
        Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
        Layer.mock(GitVcsDriver.GitVcsDriver)({}),
        Layer.mock(ProviderRegistry.ProviderRegistry)({ getProviders: Effect.succeed([]) }),
        Layer.mock(ProviderAdapterRegistry.ProviderAdapterRegistryV2)({}),
        Layer.mock(ScheduledTaskService.ScheduledTaskService)({}),
        Layer.mock(ThreadManagementService.ThreadManagementService)({
          getThreadRecords: () => Effect.succeed(projection),
          getProjectThreadRecords: ({ threadId }) =>
            Effect.succeed({ ...projection, thread: { ...projection.thread, id: threadId } }),
          getThreadShell: (id) => Effect.succeed(shells.find((shell) => shell.id === id)!),
          listProjectThreads: ({ projectId }) => {
            assert.equal(projectId, base.projectId);
            return Effect.succeed(shells);
          },
          getTimelinePage: () => Effect.succeed({ items: [], totalItems: 0, hasMore: false }),
        }),
      );
      yield* Effect.gen(function* () {
        const service = yield* OrchestratorMcpService.OrchestratorMcpService;
        const list = yield* service.listThreads(scope, {});
        assert.deepEqual(
          list.threads.map((thread) => thread.snoozed),
          [true, false, false, false, true, true, false],
        );
        for (const item of list.threads) {
          const read = yield* service.readThread(scope, { threadId: item.threadId });
          assert.equal(read.thread.snoozed, item.snoozed);
          assert.equal(read.thread.snoozedUntil, item.snoozedUntil);
          assert.deepEqual(read.thread.pullRequests, item.pullRequests);
          assert.deepEqual(
            item.pullRequests?.map(({ number, state }) => ({ number, state })),
            [
              { number: 1, state: null },
              { number: 2, state: "merged" },
            ],
          );
        }
        const page = yield* service.listThreads(scope, { snoozed: true, limit: 1, cursor: 1 });
        assert.equal(page.total, 3);
        assert.equal(page.nextCursor, 2);
        assert.equal(page.threads[0]?.threadId, "seen-failure");
        const awake = yield* service.listThreads(scope, { snoozed: false });
        assert.equal(awake.total, 4);
      }).pipe(Effect.provide(OrchestratorMcpService.layer.pipe(Layer.provide(dependencies))));
    }),
);
