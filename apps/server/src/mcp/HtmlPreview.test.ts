import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpSchema, McpServer } from "effect/unstable/ai";
import * as HtmlRender from "../htmlRender/HtmlRender.ts";
import * as PreviewBrowser from "../preview/PreviewBrowser.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import { HtmlPreviewRegistrationLive } from "./McpHttpServer.ts";
import * as McpInvocationContext from "./McpInvocationContext.ts";

it.effect(
  "delivers a real MCP image with compact metadata, authorization, and actionable setup errors",
  () =>
    Effect.gen(function* () {
      let calls = 0;
      let fail = false;
      const threadId = ThreadId.make("preview-owner");
      const providerInstanceId = ProviderInstanceId.make("codex");
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      const dependencies = Layer.mergeAll(
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getThreadShell: () =>
            Effect.succeed({
              id: threadId,
              providerInstanceId,
              deletedAt: null,
            } as OrchestrationV2ThreadShell),
        }),
        Layer.mock(HtmlRender.HtmlRender)({
          preview: () => {
            calls++;
            return fail
              ? Effect.fail(
                  new PreviewBrowser.PreviewBrowserInstallingError({
                    downloadedBytes: 100,
                    totalBytes: 1000,
                    unpacking: false,
                  }),
                )
              : Effect.succeed({
                  png: png.toString("base64"),
                  width: 390,
                  contentHeight: 320,
                  capturedHeight: 320,
                  consoleMessages: [{ level: "log" as const, text: "ready" }],
                });
          },
        }),
      );
      const layer = HtmlPreviewRegistrationLive.pipe(
        Layer.provide(dependencies),
        Layer.provideMerge(McpServer.McpServer.layer),
      );
      yield* Effect.gen(function* () {
        const server = yield* McpServer.McpServer;
        const invoke = (capabilities: Set<"orchestration">, html = "<p>Ready</p>") =>
          server.callTool({ name: "html_preview", arguments: { html, width: 390 } }).pipe(
            Effect.provideService(McpInvocationContext.McpInvocationContext, {
              environmentId: EnvironmentId.make("test"),
              threadId,
              providerInstanceId,
              providerSessionId: "session",
              issuedAt: 0,
              capabilities,
            }),
            Effect.provideService(McpSchema.McpServerClient, {
              clientId: 1,
              clientCapabilities: {},
              clientInfo: { name: "test", version: "1" },
              protocolVersion: "2025-06-18",
              initializePayload: {
                protocolVersion: "2025-06-18",
                capabilities: {},
                clientInfo: { name: "test", version: "1" },
              },
              getClient: Effect.die("unused"),
            }),
          );
        const result = yield* invoke(new Set(["orchestration"]));
        expect(result.isError).toBe(false);
        expect(result.structuredContent).toEqual({
          width: 390,
          contentHeight: 320,
          capturedHeight: 320,
          consoleMessages: [{ level: "log", text: "ready" }],
        });
        expect(result.content).toContainEqual({
          type: "image",
          data: new Uint8Array(png),
          mimeType: "image/png",
        });
        expect(result.structuredContent).not.toHaveProperty("screenshot");
        expect((yield* invoke(new Set())).isError).toBe(true);
        expect(calls).toBe(1);
        expect((yield* invoke(new Set(["orchestration"]), "")).isError).toBe(true);
        expect(calls).toBe(1);
        fail = true;
        const failure = yield* invoke(new Set(["orchestration"]));
        expect(failure.isError).toBe(true);
        expect(failure.content).toEqual([
          { type: "text", text: expect.stringContaining("installing") },
        ]);
      }).pipe(Effect.provide(layer));
    }),
);
