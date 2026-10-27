import {
  NonNegativeInt,
  OrchestratorMcpFailure,
  PreviewAutomationUnavailableError,
  PreviewListResult,
  PreviewTabId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";
import * as PreviewManager from "../../../preview/Manager.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: Schema.Union([OrchestratorMcpFailure, PreviewAutomationUnavailableError]),
  failureMode: "return" as const,
  dependencies: [McpInvocationContext.McpInvocationContext, PreviewManager.PreviewManager],
};
const PreviewListTool = Tool.make("t3_preview_list", {
  ...shared,
  description: "List this thread's preview tabs. Pages reflect current state and can shift.",
  parameters: Schema.Struct({
    cursor: Schema.optional(NonNegativeInt),
    limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))),
  }),
  success: Schema.Struct({
    ...PreviewListResult.fields,
    nextCursor: Schema.NullOr(NonNegativeInt),
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);
const PreviewCloseTool = Tool.make("t3_preview_close", {
  ...shared,
  description: "Close one preview tab this thread owns. Does not wait for renderer cleanup.",
  parameters: Schema.Struct({ tabId: PreviewTabId }),
  success: Schema.Struct({}),
}).annotate(Tool.Destructive, true);
export const PreviewControlsToolkit = Toolkit.make(PreviewListTool, PreviewCloseTool);
