import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { ThreadToolkitHandlersLive } from "./handlers.ts";
import { ThreadToolkit } from "./tools.ts";

it.effect.each(["omitted", "self", "other"] as const)(
  "routes settlement of %s to the correct lifecycle behavior",
  (target) =>
    Effect.gen(function* () {
      const callerId = ThreadId.make("thread:caller");
      const targetId = target === "other" ? ThreadId.make("thread:other") : callerId;
      const providerInstanceId = ProviderInstanceId.make("codex");
      const caller = {
        id: callerId,
        projectId: ProjectId.make("project:caller"),
        activeRunId: RunId.make("run:caller"),
        providerInstanceId,
        archivedAt: null,
        deletedAt: null,
        runtimeMode: "full-access",
        interactionMode: "default",
      } as OrchestrationV2ThreadShell;
      const settled: { threadId: ThreadId; byOwnAgent: boolean }[] = [];
      const dependencies = Layer.mergeAll(
        NodeCrypto.layer,
        Layer.succeed(McpInvocationContext.McpInvocationContext, {
          environmentId: EnvironmentId.make("environment:test"),
          threadId: callerId,
          providerSessionId: "session:test",
          providerInstanceId,
          capabilities: new Set(["orchestration" as const]),
          issuedAt: 0,
        }),
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getThreadShell: () => Effect.succeed(caller),
          getProjectThreadRecords: () =>
            Effect.succeed({ thread: { ...caller, id: targetId } } as never),
          settleThread: (input) =>
            Effect.sync(() => {
              settled.push(input);
              return input.byOwnAgent ? { settlesWhenTurnEnds: true as const } : { sequence: 1 };
            }),
        }),
      );
      const toolkit = yield* ThreadToolkit.pipe(
        Effect.provide(ThreadToolkitHandlersLive.pipe(Layer.provide(dependencies))),
      );
      const result = yield* toolkit
        .handle("t3_thread_organize", {
          action: "settle",
          ...(target === "omitted" ? {} : { threadId: targetId }),
        })
        .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(dependencies));
      expect(settled).toHaveLength(1);
      expect(settled[0]).toMatchObject({ threadId: targetId, byOwnAgent: target !== "other" });
      expect(result.at(-1)?.result).toEqual(
        target === "other" ? { sequence: 1 } : { settlesWhenTurnEnds: true },
      );
    }),
);
