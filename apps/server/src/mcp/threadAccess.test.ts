import { assert, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as DateTime from "effect/DateTime";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "./McpInvocationContext.ts";
import { readMutationCaller } from "./threadAccess.ts";

const owner = ProviderInstanceId.make("codex");
const other = ProviderInstanceId.make("claude");
const scope: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("environment:background-tools"),
  threadId: ThreadId.make("thread:background-tools"),
  providerSessionId: "session:background-tools",
  providerInstanceId: owner,
  capabilities: new Set(["orchestration"]),
  issuedAt: 1,
};
const background = {
  id: scope.threadId,
  archivedAt: null,
  deletedAt: null,
  activeRunId: null,
  providerInstanceId: owner,
  pendingBackgroundTasks: [{ kind: "subagent", taskId: "agent", providerInstanceId: owner }],
} as unknown as OrchestrationV2ThreadShell;

it.effect.each([
  ["own background subagent", background, true],
  [
    "fresh run",
    { ...background, activeRunId: RunId.make("run:new"), pendingBackgroundTasks: [] },
    true,
  ],
  ["stopped work", { ...background, pendingBackgroundTasks: [] }, false],
  ["archived caller", { ...background, archivedAt: DateTime.makeUnsafe(0) }, false],
  ["deleted caller", { ...background, deletedAt: DateTime.makeUnsafe(0) }, false],
  ["switched provider", { ...background, providerInstanceId: other }, false],
  [
    "old provider's work",
    {
      ...background,
      pendingBackgroundTasks: [{ kind: "subagent", taskId: "agent", providerInstanceId: other }],
    },
    false,
  ],
  [
    "unknown owner",
    { ...background, pendingBackgroundTasks: [{ kind: "subagent", taskId: "agent" }] },
    false,
  ],
  [
    "background command",
    { ...background, pendingBackgroundTasks: [{ kind: "command", taskId: "shell" }] },
    false,
  ],
] as const)("authorizes mutation tools only for a live caller: %s", ([, shell, allowed]) =>
  Effect.gen(function* () {
    const result = yield* readMutationCaller().pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(McpInvocationContext.McpInvocationContext, scope),
          Layer.mock(ThreadManagement.ThreadManagementService)({
            getThreadShell: () => Effect.succeed(shell),
          }),
        ),
      ),
      Effect.match({ onSuccess: () => "allowed", onFailure: (error) => error.code }),
    );
    assert.equal(
      result,
      allowed ? "allowed" : shell.deletedAt === null ? "parent_not_active" : "thread_not_found",
    );
  }),
);
