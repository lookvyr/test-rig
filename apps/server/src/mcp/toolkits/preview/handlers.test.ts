import { describe, expect, it } from "vite-plus/test";
import { it as effectIt } from "@effect/vitest";
import {
  EnvironmentId,
  PreviewAutomationStreamEvent,
  PreviewTabId,
  ProjectId,
  ProviderInstanceId,
  SecretRef,
  ThreadId,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SecretRequests from "../../../secrets/SecretRequests.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as PreviewAutomationBroker from "../../PreviewAutomationBroker.ts";

import { normalizePreviewOpenInput, PreviewToolkitHandlersLive } from "./handlers.ts";
import { PreviewToolkit } from "./tools.ts";

describe("normalizePreviewOpenInput", () => {
  it("opens the inline preview and reuses the current tab by default", () => {
    expect(normalizePreviewOpenInput({})).toEqual({
      open: true,
      reuseExistingTab: true,
      show: true,
    });
  });

  it("preserves an explicit background-only opt-out", () => {
    expect(normalizePreviewOpenInput({ open: false })).toEqual({
      open: false,
      reuseExistingTab: true,
      show: false,
    });
  });

  it("supports show as a legacy alias while preferring open", () => {
    expect(normalizePreviewOpenInput({ show: false })).toEqual({
      open: false,
      reuseExistingTab: true,
      show: false,
    });
    expect(normalizePreviewOpenInput({ open: true, show: false })).toEqual({
      open: true,
      reuseExistingTab: true,
      show: true,
    });
  });
});

effectIt.effect(
  "transports private entry with omitted or explicit timeout through the RPC JSON codec",
  () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("private-entry-thread");
      const environmentId = EnvironmentId.make("private-entry-environment");
      const projectId = ProjectId.make("private-entry-project");
      const entries: unknown[] = [];
      const dependencies = Layer.mergeAll(
        Layer.succeed(McpInvocationContext.McpInvocationContext, {
          environmentId,
          threadId,
          providerSessionId: "session",
          providerInstanceId: ProviderInstanceId.make("codex"),
          capabilities: new Set(["preview" as const]),
          issuedAt: 0,
        }),
        Layer.mock(ThreadManagementService.ThreadManagementService)({
          getThreadRecords: () =>
            Effect.succeed({ thread: { projectId } } as OrchestrationV2ThreadProjection),
        }),
        Layer.mock(SecretRequests.SecretRequests)({
          consume: () => Effect.succeed("private-test-value"),
        }),
        Layer.mock(PreviewAutomationBroker.PreviewAutomationBroker)({
          invoke: <A>(request: PreviewAutomationBroker.PreviewAutomationInvokeInput) =>
            Effect.gen(function* () {
              const encode = Schema.encodeEffect(Schema.toCodecJson(PreviewAutomationStreamEvent));
              const decode = Schema.decodeUnknownEffect(
                Schema.toCodecJson(PreviewAutomationStreamEvent),
              );
              entries.push(
                yield* decode(
                  yield* encode({
                    type: "request",
                    connectionId: "connection",
                    request: {
                      requestId: "request",
                      threadId,
                      operation: request.operation,
                      input: request.input,
                      timeoutMs: request.timeoutMs ?? 15_000,
                    },
                  }),
                ),
              );
              return undefined as A;
            }).pipe(Effect.orDie),
        }),
      );
      yield* Effect.gen(function* () {
        const toolkit = yield* PreviewToolkit.pipe(Effect.provide(PreviewToolkitHandlersLive));
        for (const timeoutMs of [undefined, 10_000]) {
          const result = yield* toolkit
            .handle("preview_type_secret", {
              secretRef: SecretRef.make("secret-ref:0123456789abcdef0123456789abcdef"),
              tabId: PreviewTabId.make("private-tab"),
              locator: "#password",
              ...(timeoutMs === undefined ? {} : { timeoutMs }),
            })
            .pipe(Stream.unwrap, Stream.runCollect);
          expect(result.at(-1)?.result).toBeNull();
        }
        expect(entries).toMatchObject([
          {
            request: {
              input: { text: "private-test-value", locator: "#password", clear: true },
              timeoutMs: 15_000,
            },
          },
          {
            request: {
              input: {
                text: "private-test-value",
                locator: "#password",
                clear: true,
                timeoutMs: 10_000,
              },
              timeoutMs: 10_000,
            },
          },
        ]);
      }).pipe(Effect.provide(dependencies));
    }),
);
