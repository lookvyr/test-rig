import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ProviderInstanceRegistry } from "../provider/Services/ProviderInstanceRegistry.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderRegistry from "../provider/Services/ProviderRegistry.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import * as OrchestratorMcpService from "./OrchestratorMcpService.ts";
import type { McpInvocationScope } from "./McpInvocationContext.ts";

const threadId = ThreadId.make("background-wait-caller");
const scope: McpInvocationScope = {
  environmentId: EnvironmentId.make("background-wait-test"),
  threadId,
  providerSessionId: "background-wait-test",
  providerInstanceId: "claude" as never,
  capabilities: new Set(["orchestration"]),
  issuedAt: 1,
};

const serviceWith = (
  awaitBackgroundTasks: ThreadManagementService.ThreadManagementServiceShape["awaitBackgroundTasks"],
) =>
  OrchestratorMcpService.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        NodeServices.layer,
        Layer.mock(SecretRequests.SecretRequests)({}),
        Layer.mock(ProviderInstanceRegistry)({}),
        Layer.mock(ProjectService.ProjectService)({}),
        Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
        Layer.mock(GitVcsDriver.GitVcsDriver)({}),
        Layer.mock(ProviderRegistry.ProviderRegistry)({}),
        Layer.mock(ProviderAdapterRegistry.ProviderAdapterRegistryV2)({}),
        Layer.mock(ScheduledTaskService.ScheduledTaskService)({}),
        Layer.mock(ThreadManagementService.ThreadManagementService)({ awaitBackgroundTasks }),
      ),
    ),
  );

it.effect("marks the caller's own tasks awaited unless waiting is false", () =>
  Effect.gen(function* () {
    const calls: Array<{ threadId: ThreadId; awaited: boolean }> = [];
    const layer = serviceWith((input) =>
      Effect.sync(() => {
        calls.push({ threadId: input.threadId, awaited: input.awaited });
        return { matched: ["tests"], unmatched: input.taskIds.filter((id) => id !== "tests") };
      }),
    );
    yield* Effect.gen(function* () {
      const service = yield* OrchestratorMcpService.OrchestratorMcpService;
      const marked = yield* service.backgroundWait(scope, { taskIds: ["tests", "gone"] });
      assert.deepEqual(marked, { matched: ["tests"], unmatched: ["gone"] });
      yield* service.backgroundWait(scope, { taskIds: ["tests"], waiting: false });
    }).pipe(Effect.provide(layer));
    assert.deepEqual(calls, [
      { threadId, awaited: true },
      { threadId, awaited: false },
    ]);
  }),
);

it.effect.each([
  ["unsupported", "invalid_request"],
  ["unavailable", "orchestration_error"],
  ["failed", "orchestration_error"],
] as const)("reports a %s provider as %s", ([reason, code]) =>
  Effect.gen(function* () {
    const layer = serviceWith(() =>
      Effect.fail(
        new ThreadManagementService.ThreadManagementBackgroundWaitError({ threadId, reason }),
      ),
    );
    const failure = yield* Effect.gen(function* () {
      const service = yield* OrchestratorMcpService.OrchestratorMcpService;
      return yield* service.backgroundWait(scope, { taskIds: ["tests"] });
    }).pipe(Effect.provide(layer), Effect.flip);
    assert.equal(failure.code, code);
  }),
);
