import * as NodeAssert from "node:assert/strict";

import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe } from "vite-plus/test";
import { DEFAULT_MODEL, ThreadId } from "@t3tools/contracts";
import * as CodexErrors from "effect-codex-app-server/errors";
import * as CodexRpc from "effect-codex-app-server/rpc";

import {
  buildCodexDeveloperInstructions,
  CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS,
  CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS,
} from "../CodexDeveloperInstructions.ts";
import { codexSessionAppServerArgs } from "./codexLaunchArgs.ts";
import {
  buildTurnStartParams,
  hasConfiguredMcpServer,
  isRecoverableThreadResumeError,
  openCodexThread,
  readCodexThread,
  rollbackCodexThread,
} from "./CodexSessionRuntime.ts";
const isCodexAppServerRequestError = Schema.is(CodexErrors.CodexAppServerRequestError);
type ThreadOpenMethod = "thread/start" | "thread/resume" | "thread/fork";

describe("CodexSessionRuntimeIdentifierGenerationError", () => {
  it("retains identifier purpose and the random source failure", () => {
    const cause = new Error("random source unavailable");
    const error = new CodexErrors.CodexAppServerIdentifierGenerationError({
      purpose: "provider-event",
      cause,
    });

    NodeAssert.equal(error.purpose, "provider-event");
    NodeAssert.strictEqual(error.cause, cause);
    NodeAssert.equal(
      error.message,
      "Failed to generate Codex App Server identifier for provider-event.",
    );
  });
});

function makeThreadOpenResponse(
  threadId: string,
): CodexRpc.ClientRequestResponsesByMethod["thread/start"] {
  return {
    cwd: "/tmp/project",
    model: "gpt-5.3-codex",
    modelProvider: "openai",
    approvalPolicy: "never",
    approvalsReviewer: "user",
    sandbox: { type: "danger-full-access" },
    thread: {
      id: threadId,
      createdAt: "2026-04-18T00:00:00.000Z",
      source: { session: "cli" },
      turns: [],
      status: {
        state: "idle",
        activeFlags: [],
      },
    },
  } as unknown as CodexRpc.ClientRequestResponsesByMethod["thread/start"];
}

describe("Codex thread history", () => {
  function historyClient(
    responses: ReadonlyArray<unknown | CodexErrors.CodexAppServerRequestError>,
  ) {
    const calls: Array<{ method: string; payload: unknown }> = [];
    const client: Parameters<typeof readCodexThread>[0] = {
      request: <M extends CodexRpc.ClientRequestMethod>(
        method: M,
        payload: CodexRpc.ClientRequestParamsByMethod[M],
      ) => {
        const response = responses[calls.length];
        calls.push({ method, payload });
        NodeAssert.ok(calls.length <= responses.length, `Unexpected request: ${method}`);
        return isCodexAppServerRequestError(response)
          ? Effect.fail(response)
          : Effect.succeed(response as CodexRpc.ClientRequestResponsesByMethod[M]);
      },
    };
    return { client, calls };
  }
  const metadata = { thread: { historyMode: "paginated" } };
  const first = { id: "turn-1", items: [{ type: "userMessage", id: "message-1", content: [] }] };
  const second = { id: "turn-2", items: [{ type: "agentMessage", id: "message-2", text: "Done" }] };

  it.effect("reads complete paginated turns in chronological order", () =>
    Effect.gen(function* () {
      const { client, calls } = historyClient([
        metadata,
        { data: [first], nextCursor: "page-2" },
        { data: [second], nextCursor: null },
      ]);
      NodeAssert.deepEqual(yield* readCodexThread(client, "thread-1"), {
        threadId: "thread-1",
        turns: [first, second],
      });
      NodeAssert.deepEqual(calls, [
        { method: "thread/read", payload: { threadId: "thread-1", includeTurns: false } },
        ...[null, "page-2"].map((cursor) => ({
          method: "thread/turns/list",
          payload: {
            threadId: "thread-1",
            cursor,
            limit: 100,
            sortDirection: "asc",
            itemsView: "full",
          },
        })),
      ]);
    }),
  );

  it.effect("stops when the final history page omits its cursor", () =>
    Effect.gen(function* () {
      const { client, calls } = historyClient([
        metadata,
        { data: [first], nextCursor: "page-2" },
        { data: [second] },
      ]);
      NodeAssert.deepEqual(yield* readCodexThread(client, "thread-1"), {
        threadId: "thread-1",
        turns: [first, second],
      });
      NodeAssert.equal(calls.length, 3);
    }),
  );

  for (const historyMode of ["legacy", undefined]) {
    it.effect(`reads legacy history when mode is ${historyMode}`, () =>
      Effect.gen(function* () {
        const { client, calls } = historyClient([
          { thread: { historyMode } },
          { thread: { id: "thread-1", turns: [first] } },
        ]);
        NodeAssert.deepEqual(yield* readCodexThread(client, "thread-1"), {
          threadId: "thread-1",
          turns: [first],
        });
        NodeAssert.deepEqual(calls[1], {
          method: "thread/read",
          payload: { threadId: "thread-1", includeTurns: true },
        });
      }),
    );
  }

  it.effect("fails if pagination repeats a cursor", () =>
    Effect.gen(function* () {
      const { client, calls } = historyClient([
        metadata,
        { data: [], nextCursor: "same" },
        { data: [], nextCursor: "same" },
      ]);
      const error = yield* readCodexThread(client, "thread-1").pipe(Effect.flip);
      NodeAssert.match(error.message, /repeated a pagination cursor/);
      NodeAssert.equal(calls.length, 3);
    }),
  );

  for (const numTurns of [0, 1, 2, 3]) {
    it.effect(`reverts ${numTurns} turns at the first removed turn boundary`, () =>
      Effect.gen(function* () {
        const { client, calls } = historyClient([
          metadata,
          { data: [first, second], nextCursor: null },
          {},
        ]);
        const retainedCount = Math.max(0, 2 - numTurns);
        NodeAssert.deepEqual(yield* rollbackCodexThread(client, "thread-1", numTurns), {
          threadId: "thread-1",
          turns: [first, second].slice(0, retainedCount),
        });
        NodeAssert.deepEqual(
          calls.slice(2),
          numTurns === 0
            ? []
            : [
                {
                  method: "thread/revert",
                  payload: {
                    threadId: "thread-1",
                    beforeTurnId: retainedCount === 1 ? "turn-2" : "turn-1",
                  },
                },
              ],
        );
      }),
    );
  }

  it.effect("rejects legacy rollback without mutating the thread", () =>
    Effect.gen(function* () {
      const { client, calls } = historyClient([{ thread: { historyMode: "legacy" } }]);
      const error = yield* rollbackCodexThread(client, "thread-1", 1).pipe(Effect.flip);
      NodeAssert.match(error.message, /cannot revert legacy conversations/);
      NodeAssert.equal(calls.length, 1);
    }),
  );

  it.effect("preserves the original snapshot and propagates a failed revert", () =>
    Effect.gen(function* () {
      const original = { data: [first, second], nextCursor: null };
      const rejection = CodexErrors.CodexAppServerRequestError.invalidRequest("Revert failed");
      const { client } = historyClient([metadata, original, rejection]);
      const error = yield* rollbackCodexThread(client, "thread-1", 1).pipe(Effect.flip);
      NodeAssert.strictEqual(error, rejection);
      NodeAssert.deepEqual(original.data, [first, second]);
    }),
  );
});

describe("buildTurnStartParams", () => {
  it("keeps invalid turn values only in the schema cause", () => {
    const secret = "codex-turn-input-secret-sentinel";
    const error = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "full-access",
        attachments: [
          {
            type: "image",
            url: { secret } as unknown as string,
          },
        ],
      }).pipe(Effect.flip),
    );
    const { cause, ...directDiagnostics } = error;

    NodeAssert.equal(error.operation, "decode-request-payload");
    NodeAssert.equal(error.method, "turn/start");
    NodeAssert.ok((error.issueCount ?? 0) > 0);
    NodeAssert.ok(error.issueKinds?.includes("Pointer"));
    NodeAssert.ok((error.maximumPathDepth ?? 0) > 0);
    NodeAssert.ok(Schema.isSchemaError(cause));
    NodeAssert.doesNotMatch(error.message, new RegExp(secret));
    NodeAssert.doesNotMatch(JSON.stringify(directDiagnostics), new RegExp(secret));
  });

  it("includes plan collaboration mode when requested", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "full-access",
        prompt: "Make a plan",
        model: "gpt-5.3-codex",
        effort: "medium",
        interactionMode: "plan",
      }),
    );

    NodeAssert.deepStrictEqual(params, {
      threadId: "provider-thread-1",
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandboxPolicy: {
        type: "dangerFullAccess",
      },
      input: [
        {
          type: "text",
          text: "Make a plan",
        },
      ],
      model: "gpt-5.3-codex",
      effort: "medium",
      collaborationMode: {
        mode: "plan",
        settings: {
          model: "gpt-5.3-codex",
          reasoning_effort: "medium",
          developer_instructions: buildCodexDeveloperInstructions("plan", {
            model: "gpt-5.3-codex",
            reasoningEffort: "medium",
          }),
        },
      },
    });
  });

  it("includes default collaboration mode and image attachments", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "auto-accept-edits",
        prompt: "Implement it",
        model: "gpt-5.3-codex",
        interactionMode: "default",
        attachments: [
          {
            type: "image",
            url: "data:image/png;base64,abc",
          },
        ],
      }),
    );

    NodeAssert.deepStrictEqual(params, {
      threadId: "provider-thread-1",
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandboxPolicy: {
        type: "workspaceWrite",
      },
      input: [
        {
          type: "text",
          text: "Implement it",
        },
        {
          type: "image",
          url: "data:image/png;base64,abc",
        },
      ],
      model: "gpt-5.3-codex",
      collaborationMode: {
        mode: "default",
        settings: {
          model: "gpt-5.3-codex",
          reasoning_effort: "medium",
          developer_instructions: buildCodexDeveloperInstructions("default", {
            model: "gpt-5.3-codex",
            reasoningEffort: "medium",
          }),
        },
      },
    });
  });

  it("reports the same fallback model and effort in settings and instructions", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "full-access",
        prompt: "Go",
        interactionMode: "default",
      }),
    );

    const settings = params.collaborationMode?.settings;
    NodeAssert.equal(settings?.model, DEFAULT_MODEL);
    NodeAssert.equal(settings?.reasoning_effort, "medium");
    NodeAssert.ok(settings?.developer_instructions?.includes(`as ${DEFAULT_MODEL} with medium`));
  });

  it.effect("routes approvals to the auto reviewer in auto mode", () =>
    Effect.gen(function* () {
      const params = yield* buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "auto",
        prompt: "Ship it",
      });

      NodeAssert.deepStrictEqual(params, {
        threadId: "provider-thread-1",
        approvalPolicy: "on-request",
        approvalsReviewer: "auto_review",
        sandboxPolicy: {
          type: "workspaceWrite",
        },
        input: [
          {
            type: "text",
            text: "Ship it",
          },
        ],
      });
    }),
  );

  it("omits collaboration mode when interaction mode is absent", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "approval-required",
        prompt: "Review",
      }),
    );

    NodeAssert.deepStrictEqual(params, {
      threadId: "provider-thread-1",
      approvalPolicy: "untrusted",
      approvalsReviewer: "user",
      sandboxPolicy: {
        type: "readOnly",
      },
      input: [
        {
          type: "text",
          text: "Review",
        },
      ],
    });
  });
});

describe("buildCodexDeveloperInstructions", () => {
  it("appends runtime info after the mode instructions", () => {
    const instructions = buildCodexDeveloperInstructions("default", {
      model: "gpt-5.3-codex",
      reasoningEffort: "high",
    });

    NodeAssert.ok(instructions.startsWith(CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS));
    NodeAssert.match(instructions, /Test Rig/);
    NodeAssert.match(instructions, /Codex harness/);
    NodeAssert.match(instructions, /as gpt-5\.3-codex with high reasoning effort/);
  });

  it("includes runtime info alongside plan mode instructions", () => {
    const instructions = buildCodexDeveloperInstructions("plan", {
      model: "gpt-5.3-codex",
      reasoningEffort: "medium",
    });

    NodeAssert.ok(instructions.startsWith(CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS));
    NodeAssert.match(instructions, /as gpt-5\.3-codex with medium reasoning effort/);
  });

  it("varies with the model and effort of each turn", () => {
    const first = buildCodexDeveloperInstructions("default", {
      model: "gpt-5.3-codex",
      reasoningEffort: "medium",
    });
    const second = buildCodexDeveloperInstructions("default", {
      model: "gpt-5.4",
      reasoningEffort: "high",
    });

    NodeAssert.notEqual(first, second);
  });

  it("flattens multiline metadata into single-line runtime info", () => {
    const instructions = buildCodexDeveloperInstructions("default", {
      model: "gpt\n5.3\ncodex",
      reasoningEffort: " high\neffort ",
    });

    NodeAssert.match(instructions, /as gpt 5\.3 codex with high effort reasoning effort/);
    NodeAssert.doesNotMatch(instructions, /<runtime_info>[^<]*\n/);
  });
});

describe("T3 browser developer instructions", () => {
  it("prefers the product-native preview tools in both collaboration modes", () => {
    for (const instructions of [
      CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS,
      CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS,
    ]) {
      NodeAssert.match(instructions, /test_rig/);
      NodeAssert.match(instructions, /preview_status/);
      NodeAssert.match(instructions, /preview_open/);
      NodeAssert.match(instructions, /Do not switch to global browser skills/);
    }
  });
});

describe("hasConfiguredMcpServer", () => {
  it("detects inline Codex MCP configuration arguments", () => {
    NodeAssert.equal(hasConfiguredMcpServer(undefined), false);
    NodeAssert.equal(hasConfiguredMcpServer(["--model", "gpt-5.4"]), false);
    NodeAssert.equal(
      hasConfiguredMcpServer(["-c", 'mcp_servers.test_rig.url="http://127.0.0.1/mcp"']),
      true,
    );
  });
});

describe("codexSessionAppServerArgs", () => {
  it("keeps the app-server subcommand when explicit args are provided", () => {
    NodeAssert.deepStrictEqual(codexSessionAppServerArgs(["-c", "model=gpt-5"], undefined), [
      "app-server",
      "-c",
      "model=gpt-5",
    ]);
  });

  it("keeps launch args when explicit app-server args are provided", () => {
    NodeAssert.deepStrictEqual(
      codexSessionAppServerArgs(
        ["-c", "mcp_servers.test_rig.url=http://127.0.0.1/mcp"],
        "--strict-config --enable foo",
      ),
      [
        "app-server",
        "--strict-config",
        "--enable",
        "foo",
        "-c",
        "mcp_servers.test_rig.url=http://127.0.0.1/mcp",
      ],
    );
  });
});

describe("isRecoverableThreadResumeError", () => {
  it("matches missing thread errors", () => {
    NodeAssert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "Thread does not exist",
        }),
      ),
      true,
    );
  });

  it("ignores non-recoverable resume errors", () => {
    NodeAssert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "Permission denied",
        }),
      ),
      false,
    );
  });

  it("ignores unrelated missing-resource errors that do not mention threads", () => {
    NodeAssert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "Config file not found",
        }),
      ),
      false,
    );
    NodeAssert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "Model does not exist",
        }),
      ),
      false,
    );
  });
});

describe("openCodexThread", () => {
  for (const operation of ["start", "resume", "fork"] as const) {
    it.effect(`preserves history mode for ${operation}`, () =>
      Effect.gen(function* () {
        const client = {
          request: <M extends ThreadOpenMethod>(
            method: M,
            payload: CodexRpc.ClientRequestParamsByMethod[M],
          ) => {
            NodeAssert.equal(method, `thread/${operation}`);
            NodeAssert.equal(
              "historyMode" in payload ? payload.historyMode : undefined,
              operation === "start" ? "paginated" : undefined,
            );
            return Effect.succeed(
              makeThreadOpenResponse("thread-1") as CodexRpc.ClientRequestResponsesByMethod[M],
            );
          },
        };
        yield* openCodexThread({
          client,
          threadId: ThreadId.make("thread-1"),
          runtimeMode: "full-access",
          cwd: "/tmp/project",
          requestedModel: undefined,
          serviceTier: undefined,
          resumeThreadId: operation === "resume" ? "thread-1" : undefined,
          ...(operation === "fork" ? { forkThreadId: "parent-thread" } : {}),
        });
      }),
    );
  }

  for (const mode of ["fork", "strict-resume", "missing-strict-cursor"] as const) {
    it.effect(`never starts a fresh thread after ${mode} fails`, () =>
      Effect.gen(function* () {
        const calls: Array<ThreadOpenMethod> = [];
        const client = {
          request: <M extends ThreadOpenMethod>(
            method: M,
            _payload: CodexRpc.ClientRequestParamsByMethod[M],
          ) => {
            calls.push(method);
            return Effect.fail(
              new CodexErrors.CodexAppServerRequestError({
                code: -32603,
                errorMessage: "thread not found",
              }),
            );
          },
        };
        const failure = yield* openCodexThread({
          client,
          threadId: ThreadId.make("side-thread"),
          runtimeMode: "auto-accept-edits",
          cwd: "/tmp/project",
          requestedModel: undefined,
          serviceTier: undefined,
          resumeThreadId: mode === "strict-resume" ? "child-native" : undefined,
          ...(mode === "fork" ? { forkThreadId: "parent-native" } : { strictResume: true }),
        }).pipe(Effect.flip);
        NodeAssert.ok(isCodexAppServerRequestError(failure));
        NodeAssert.deepStrictEqual(
          calls,
          mode === "fork" ? ["thread/fork"] : mode === "strict-resume" ? ["thread/resume"] : [],
        );
      }),
    );
  }

  it.effect("falls back to thread/start when resume fails recoverably", () =>
    Effect.gen(function* () {
      const calls: Array<{ method: ThreadOpenMethod; payload: unknown }> = [];
      const started = makeThreadOpenResponse("fresh-thread");
      const client = {
        request: <M extends ThreadOpenMethod>(
          method: M,
          payload: CodexRpc.ClientRequestParamsByMethod[M],
        ) => {
          calls.push({ method, payload });
          if (method === "thread/resume") {
            return Effect.fail(
              new CodexErrors.CodexAppServerRequestError({
                code: -32603,
                errorMessage: "thread not found",
              }),
            );
          }
          return Effect.succeed(started as CodexRpc.ClientRequestResponsesByMethod[M]);
        },
      };

      const opened = yield* openCodexThread({
        client,
        threadId: ThreadId.make("thread-1"),
        runtimeMode: "full-access",
        cwd: "/tmp/project",
        requestedModel: "gpt-5.3-codex",
        serviceTier: undefined,
        resumeThreadId: "stale-thread",
      });

      NodeAssert.equal(opened.thread.id, "fresh-thread");
      NodeAssert.ok(calls[1]);
      NodeAssert.equal((calls[1].payload as { historyMode: string }).historyMode, "paginated");
      NodeAssert.deepStrictEqual(
        calls.map((call) => call.method),
        ["thread/resume", "thread/start"],
      );
    }),
  );

  it.effect("propagates non-recoverable resume failures", () =>
    Effect.gen(function* () {
      const client = {
        request: <M extends ThreadOpenMethod>(
          method: M,
          _payload: CodexRpc.ClientRequestParamsByMethod[M],
        ) => {
          if (method === "thread/resume") {
            return Effect.fail(
              new CodexErrors.CodexAppServerRequestError({
                code: -32603,
                errorMessage: "timed out waiting for server",
              }),
            );
          }
          return Effect.succeed(
            makeThreadOpenResponse("fresh-thread") as CodexRpc.ClientRequestResponsesByMethod[M],
          );
        },
      };

      const error = yield* openCodexThread({
        client,
        threadId: ThreadId.make("thread-1"),
        runtimeMode: "full-access",
        cwd: "/tmp/project",
        requestedModel: "gpt-5.3-codex",
        serviceTier: undefined,
        resumeThreadId: "stale-thread",
      }).pipe(Effect.flip);

      NodeAssert.ok(isCodexAppServerRequestError(error));
      NodeAssert.equal(error.errorMessage, "timed out waiting for server");
    }),
  );
});
