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
import { resolveRuntimeMode, resolveSpawnRuntimeMode } from "./OrchestratorMcpService.ts";
import { assertUnattendedCaller, readMutationCaller } from "./threadAccess.ts";

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

const shell = (fields: Partial<OrchestrationV2ThreadShell>) =>
  ({
    ...background,
    runtimeMode: "auto",
    interactionMode: "default",
    ...fields,
  }) as OrchestrationV2ThreadShell;

it.effect.each([
  ["full access", shell({ runtimeMode: "full-access" }), true],
  ["auto", shell({ runtimeMode: "auto" }), true],
  ["auto-accept edits", shell({ runtimeMode: "auto-accept-edits" }), false],
  ["approval required", shell({ runtimeMode: "approval-required" }), false],
  ["auto in Plan mode", shell({ interactionMode: "plan" }), false],
  ["archived auto", shell({ archivedAt: DateTime.makeUnsafe(1) }), false],
] as const)("allows app changes from unattended callers only: %s", ([, caller, allowed]) =>
  Effect.gen(function* () {
    const result = yield* assertUnattendedCaller(caller, "Project changes").pipe(
      Effect.match({ onSuccess: () => "allowed", onFailure: (error) => error.code }),
    );
    assert.strictEqual(result, allowed ? "allowed" : "capability_denied");
  }),
);

it.effect.each([
  ["auto inherits auto", "auto", undefined, "auto"],
  ["auto asks for full access", "auto", "full-access", "full-access"],
  ["full access asks for auto", "full-access", "auto", "auto"],
  ["supervised inherits", "approval-required", undefined, "capability_denied"],
  ["auto-accept edits inherits", "auto-accept-edits", "inherit", "capability_denied"],
] as const)(
  "spawned work runs in Auto or Full access only: %s",
  ([, parent, requested, expected]) =>
    Effect.gen(function* () {
      const result = yield* resolveSpawnRuntimeMode(parent, requested).pipe(
        Effect.match({ onSuccess: (mode) => mode, onFailure: (error) => error.code }),
      );
      assert.strictEqual(result, expected);
    }),
);

it.effect("auto and full-access threads may drive each other", () =>
  Effect.gen(function* () {
    assert.strictEqual(yield* resolveRuntimeMode("auto", "full-access"), "full-access");
    assert.strictEqual(yield* resolveRuntimeMode("full-access", "auto"), "auto");
    const denied = yield* resolveRuntimeMode("approval-required", "auto").pipe(Effect.flip);
    assert.strictEqual(denied.code, "runtime_mode_escalation_denied");
  }),
);
