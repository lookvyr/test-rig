import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as HtmlRender from "../../../htmlRender/HtmlRender.ts";
import { readCaller, readMutationCaller } from "../../threadAccess.ts";
import { HtmlPreviewToolkit, HtmlRenderToolkit } from "./tools.ts";

const toFailure = (error: HtmlRender.HtmlRenderPrepareError | HtmlRender.HtmlRenderStoreError) =>
  new OrchestratorMcpFailure({
    code: error._tag === "HtmlRenderStoreError" ? "orchestration_error" : "invalid_request",
    message: error.message,
  });

export const HtmlRenderHandlersLive = HtmlRenderToolkit.toLayer({
  html_render: (input) =>
    Effect.gen(function* () {
      const { scope } = yield* readMutationCaller();
      const htmlRender = yield* HtmlRender.HtmlRender;
      const reference = yield* htmlRender
        .publish({ threadId: scope.threadId, ...input })
        .pipe(Effect.mapError(toFailure));
      return {
        htmlRender: reference,
        message:
          "Shown to the reader above your reply. Don't mention or describe the page; reply with only what it doesn't already say.",
      };
    }),
});

export const HtmlPreviewHandlersLive = HtmlPreviewToolkit.toLayer({
  html_preview: (input) =>
    Effect.gen(function* () {
      yield* readCaller();
      const htmlRender = yield* HtmlRender.HtmlRender;
      const { png, ...preview } = yield* htmlRender.preview(input).pipe(
        Effect.mapError(
          (error) =>
            new OrchestratorMcpFailure({
              code:
                error._tag === "HtmlRenderImageTooLargeError" ||
                error._tag === "HtmlRenderPageTooLargeError"
                  ? "invalid_request"
                  : "orchestration_error",
              message: error.message,
            }),
        ),
      );
      return {
        ...preview,
        screenshot: {
          mimeType: "image/png" as const,
          data: png,
          width: preview.width,
          height: preview.capturedHeight,
        },
      };
    }),
});
