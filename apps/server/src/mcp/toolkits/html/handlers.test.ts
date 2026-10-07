import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as HtmlRender from "../../../htmlRender/HtmlRender.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { HtmlRenderHandlersLive } from "./handlers.ts";
import { HtmlRenderToolkit } from "./tools.ts";

it.effect(
  "publishes only for the credential's live caller and returns actionable page errors",
  () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("render-owner");
      const providerInstanceId = ProviderInstanceId.make("codex");
      let active = true;
      let fail = false;
      const published: ThreadId[] = [];
      const reference = { attachmentId: "page", title: "Chart", height: 300 };
      const dependencies = Layer.mergeAll(
        Layer.succeed(McpInvocationContext.McpInvocationContext, {
          environmentId: EnvironmentId.make("environment"),
          threadId,
          providerSessionId: "session",
          providerInstanceId,
          issuedAt: 0,
          capabilities: new Set(["orchestration" as const]),
        }),
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getThreadShell: () =>
            Effect.succeed({
              id: threadId,
              providerInstanceId,
              activeRunId: active ? "run" : null,
              archivedAt: null,
              deletedAt: null,
            } as OrchestrationV2ThreadShell),
        }),
        Layer.mock(HtmlRender.HtmlRender)({
          publish: (input) => {
            published.push(input.threadId);
            return fail
              ? Effect.fail(
                  new HtmlRender.HtmlRenderImagesNotFoundError({ paths: ["/missing.png"] }),
                )
              : Effect.succeed(reference);
          },
        }),
      );
      yield* Effect.gen(function* () {
        const toolkit = yield* HtmlRenderToolkit.pipe(Effect.provide(HtmlRenderHandlersLive));
        const render = () =>
          toolkit
            .handle("html_render", { html: "<p>Chart</p>", title: "Chart", height: 300 })
            .pipe(Stream.unwrap, Stream.runCollect);
        expect((yield* render()).at(-1)?.result).toMatchObject({ htmlRender: reference });
        expect(published).toEqual([threadId]);
        active = false;
        expect((yield* render()).at(-1)?.result).toMatchObject({ code: "parent_not_active" });
        expect(published).toEqual([threadId]);
        active = true;
        fail = true;
        expect((yield* render()).at(-1)?.result).toMatchObject({
          code: "invalid_request",
          message: expect.stringContaining("/missing.png"),
        });
      }).pipe(Effect.provide(dependencies));
    }),
);
