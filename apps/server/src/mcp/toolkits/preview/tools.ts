import * as SecretRequests from "../../../secrets/SecretRequests.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import {
  PreviewAutomationDialogInput,
  PreviewAutomationHoverInput,
  PreviewAutomationSelectInput,
  PreviewAutomationDragInput,
  PreviewAutomationUploadInput,
  PreviewAutomationSelectResult,
  PreviewAutomationClickInput,
  PreviewAutomationError,
  PreviewAutomationEvaluateInput,
  PreviewAutomationNavigateInput,
  PreviewAutomationOpenInput,
  PreviewAutomationPressInput,
  PreviewAutomationRecordingArtifact,
  PreviewAutomationRecordingStatus,
  PreviewAutomationResizeInput,
  PreviewAutomationResizeResult,
  PreviewAutomationScrollInput,
  PreviewAutomationSetColorSchemeInput,
  PreviewAutomationSetColorSchemeResult,
  PreviewAutomationSnapshot,
  PreviewAutomationStatus,
  PreviewAutomationTabTargetInput,
  PreviewAutomationTypeInput,
  PreviewAutomationTypeSecretInput,
  SecretRequestError,
  PreviewAutomationWaitForInput,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as FileSystem from "effect/FileSystem";
import * as ServerConfig from "../../../config.ts";
import { Tool, Toolkit } from "effect/unstable/ai";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as PreviewAutomationBroker from "../../PreviewAutomationBroker.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  PreviewAutomationBroker.PreviewAutomationBroker,
];

const browserTool = <T extends Tool.Any>(tool: T): T =>
  tool.annotate(Tool.OpenWorld, true).annotate(Tool.Destructive, true) as T;

const safeBrowserTool = <T extends Tool.Any>(tool: T): T =>
  browserTool(tool).annotate(Tool.Destructive, false) as T;

const readonlyBrowserTool = <T extends Tool.Any>(tool: T): T =>
  safeBrowserTool(tool).annotate(Tool.Readonly, true).annotate(Tool.Idempotent, true) as T;

export const PreviewStatusTool = Tool.make("preview_status", {
  description:
    "Report automation availability, URL, title, visibility, loading, viewport, and size. Select tabId or omit it for this session's current tab.",
  parameters: PreviewAutomationTabTargetInput,
  success: PreviewAutomationStatus,
  failure: PreviewAutomationError,
  dependencies,
})
  .annotate(Tool.Title, "Get preview status")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

export const PreviewOpenTool = browserTool(
  Tool.make("preview_open", {
    description:
      "Open and show a browser tab. open=false keeps it in the background. Use tabId for an existing tab, reuseExistingTab=false for a new one, or omit both for this session's current tab.",
    parameters: PreviewAutomationOpenInput,
    success: PreviewAutomationStatus,
    failure: PreviewAutomationError,
    dependencies,
  })
    .annotate(Tool.Title, "Open browser preview")
    .annotate(Tool.Destructive, false),
);

export const PreviewNavigateTool = safeBrowserTool(
  Tool.make("preview_navigate", {
    description:
      "Navigate the chosen tab. Pass `url` for a website, or `target:{kind:'environment-port',port}` for a dev server. Exactly one of `url` and `target`.",
    parameters: PreviewAutomationNavigateInput,
    success: PreviewAutomationStatus,
    failure: PreviewAutomationError,
    dependencies,
  }).annotate(Tool.Title, "Navigate browser preview"),
);

export const PreviewResizeTool = safeBrowserTool(
  Tool.make("preview_resize", {
    description:
      "Resize the chosen tab: {mode:'fill'}, {mode:'freeform',width,height}, or {mode:'preset',preset,orientation}. Changes CSS size only, not the user agent.",
    parameters: PreviewAutomationResizeInput,
    success: PreviewAutomationResizeResult,
    failure: PreviewAutomationError,
    dependencies,
  })
    .annotate(Tool.Title, "Resize browser viewport")
    .annotate(Tool.Idempotent, true),
);

export const PreviewSetAppearanceTool = safeBrowserTool(
  Tool.make("preview_set_appearance", {
    description:
      "Set `prefers-color-scheme` for the chosen tab: 'dark', 'light', or 'system' to clear the override.",
    parameters: PreviewAutomationSetColorSchemeInput,
    success: PreviewAutomationSetColorSchemeResult,
    failure: PreviewAutomationError,
    dependencies,
  })
    .annotate(Tool.Title, "Set preview appearance")
    .annotate(Tool.Idempotent, true),
);

export const PreviewSnapshotTool = readonlyBrowserTool(
  Tool.make("preview_snapshot", {
    description:
      "Inspect before interacting: bounded text, element selectors, diagnostics, and PNG. Select tabId or omit for the current tab. Trimmed-data notes guide targeted preview_evaluate reads. includeImage=false omits PNG; save=true returns local screenshotPath and screenshotMarkdown. Include screenshotMarkdown verbatim to show it in chat.",
    parameters: Schema.Struct({
      ...PreviewAutomationTabTargetInput.fields,
      includeImage: Schema.optional(Schema.Boolean).annotate({
        description: "Include the PNG image in the tool response. Defaults to true.",
      }),
      save: Schema.optional(Schema.Boolean).annotate({
        description:
          "Save the PNG locally and return its absolute screenshotPath. Defaults to false.",
      }),
    }),
    success: PreviewAutomationSnapshot,
    failure: PreviewAutomationError,
    dependencies,
  }).annotate(Tool.Title, "Inspect browser page"),
);

export const PreviewClickTool = browserTool(
  Tool.make("preview_click", {
    description:
      "Click exactly one target. Prefer a Playwright locator; selector is CSS. Coordinates x/y go together. Select tabId or omit for the current tab.",
    parameters: PreviewAutomationClickInput,
    success: Schema.Null,
    failure: PreviewAutomationError,
    dependencies,
  }).annotate(Tool.Title, "Click preview page"),
);

export const PreviewTypeTool = browserTool(
  Tool.make("preview_type", {
    description: "Type literal text into one input. `clear=true` replaces the current text.",
    parameters: PreviewAutomationTypeInput,
    success: Schema.Null,
    failure: PreviewAutomationError,
    dependencies,
  }).annotate(Tool.Title, "Type into preview page"),
);

export const PreviewTypeSecretTool = browserTool(
  Tool.make("preview_type_secret", {
    description:
      "Enter a one-use secretRef from request_secret into an explicit browser tab and field, replacing its contents. The private value is not included in this call or result. The page receives it; do not read it back or echo it. A failed entry may require asking again.",
    parameters: PreviewAutomationTypeSecretInput,
    success: Schema.Null,
    failure: Schema.Union([PreviewAutomationError, SecretRequestError]),
    dependencies: [
      ...dependencies,
      SecretRequests.SecretRequests,
      ThreadManagementService.ThreadManagementService,
    ],
  }).annotate(Tool.Title, "Enter a private value"),
);

export const PreviewPressTool = browserTool(
  Tool.make("preview_press", {
    description: "Press one key, such as {key:'Enter'} or {key:'a',modifiers:['Meta']}.",
    parameters: PreviewAutomationPressInput,
    success: Schema.Null,
    failure: PreviewAutomationError,
    dependencies,
  }).annotate(Tool.Title, "Press key in preview page"),
);

export const PreviewScrollTool = safeBrowserTool(
  Tool.make("preview_scroll", {
    description:
      "Scroll the chosen tab, or one container with a locator or selector. Positive `deltaY` scrolls down. Positive `deltaX` scrolls right.",
    parameters: PreviewAutomationScrollInput,
    success: Schema.Null,
    failure: PreviewAutomationError,
    dependencies,
  }).annotate(Tool.Title, "Scroll preview page"),
);

export const PreviewEvaluateTool = browserTool(
  Tool.make("preview_evaluate", {
    description:
      "Evaluate JavaScript in the tab selected by tabId, or this agent session's current tab when omitted. Returns {value} with a serializable result up to 64 KB, or null for undefined. The expression may mutate page state.",
    parameters: PreviewAutomationEvaluateInput,
    success: Schema.Struct({ value: Schema.Unknown }),
    failure: PreviewAutomationError,
    dependencies,
  }).annotate(Tool.Title, "Evaluate JavaScript in preview"),
);

export const PreviewWaitForTool = readonlyBrowserTool(
  Tool.make("preview_wait_for", {
    description:
      "Wait until all given locator, selector, text, and URL conditions match in the chosen tab.",
    parameters: PreviewAutomationWaitForInput,
    success: Schema.Null,
    failure: PreviewAutomationError,
    dependencies,
  }).annotate(Tool.Title, "Wait for preview page condition"),
);

export const PreviewRecordingStartTool = safeBrowserTool(
  Tool.make("preview_recording_start", {
    description:
      "Start recording the collaborative browser tab selected by tabId, or this agent session's current tab when omitted. For a desktop walkthrough, first use preview_resize with a fixed desktop viewport so the recording does not inherit a narrow side panel. Preserve an intentional mobile or responsive-test viewport. Recordings capture the browser without sound.",
    parameters: PreviewAutomationTabTargetInput,
    success: PreviewAutomationRecordingStatus,
    failure: PreviewAutomationError,
    dependencies,
  }).annotate(Tool.Title, "Start browser recording"),
);

export const PreviewRecordingStopTool = safeBrowserTool(
  Tool.make("preview_recording_stop", {
    description:
      "Stop recording the collaborative browser tab selected by tabId, or this agent session's current tab when omitted. Save the recording in the agent environment and return its absolute path and recordingMarkdown. Include recordingMarkdown verbatim in your reply so the user can play the video in chat. Recordings must be at most 50 MiB; make shorter clips for longer workflows.",
    parameters: PreviewAutomationTabTargetInput,
    success: Schema.Struct({
      ...PreviewAutomationRecordingArtifact.fields,
      recordingMarkdown: Schema.String,
    }),
    failure: PreviewAutomationError,
    dependencies: [...dependencies, ServerConfig.ServerConfig, FileSystem.FileSystem],
  }).annotate(Tool.Title, "Stop browser recording"),
);

const PreviewDialogTool = browserTool(
  Tool.make("preview_dialog", {
    description:
      "Accept or dismiss the server browser dialog reported by preview_status. For a prompt, supply promptText when accepting. Requires this agent to own the tab. Desktop hosts may not support this operation.",
    parameters: PreviewAutomationDialogInput,
    success: PreviewAutomationStatus,
    failure: PreviewAutomationError,
    dependencies,
  }).annotate(Tool.Title, "Resolve browser dialog"),
);

const PreviewHoverTool = safeBrowserTool(
  Tool.make("preview_hover", {
    description: "Hover one target to show menus or tooltips.",
    parameters: PreviewAutomationHoverInput,
    success: Schema.Null,
    failure: PreviewAutomationError,
    dependencies,
  }).annotate(Tool.Title, "Hover preview page"),
);

const PreviewSelectTool = browserTool(
  Tool.make("preview_select", {
    description:
      "Pick options in one native <select>, by value or label. For a custom dropdown, click it open, then click the option.",
    parameters: PreviewAutomationSelectInput,
    success: PreviewAutomationSelectResult,
    failure: PreviewAutomationError,
    dependencies,
  }).annotate(Tool.Title, "Select preview option"),
);

const PreviewDragTool = browserTool(
  Tool.make("preview_drag", {
    description: "Drag one element onto another.",
    parameters: PreviewAutomationDragInput,
    success: Schema.Null,
    failure: PreviewAutomationError,
    dependencies,
  }).annotate(Tool.Title, "Drag in preview page"),
);

const PreviewUploadTool = browserTool(
  Tool.make("preview_upload", {
    description:
      "Give files from this environment to the page. After a click opens a file picker, `preview_status` reports it. Pass absolute paths to answer it, or an empty list to cancel. Or pass a locator for an <input type=file>.",
    parameters: PreviewAutomationUploadInput,
    success: Schema.Null,
    failure: PreviewAutomationError,
    dependencies,
  }).annotate(Tool.Title, "Upload files to preview page"),
);

const PreviewCloseTool = browserTool(
  Tool.make("preview_close", {
    description:
      "Close a server browser tab owned by this agent session. Pass tabId when multiple tabs are open.",
    parameters: PreviewAutomationTabTargetInput,
    success: Schema.Null,
    failure: PreviewAutomationError,
    dependencies,
  }),
);

export const PreviewToolkit = Toolkit.make(
  PreviewDialogTool,
  PreviewHoverTool,
  PreviewSelectTool,
  PreviewDragTool,
  PreviewUploadTool,
  PreviewCloseTool,
  PreviewStatusTool,
  PreviewOpenTool,
  PreviewNavigateTool,
  PreviewResizeTool,
  PreviewSetAppearanceTool,
  PreviewSnapshotTool,
  PreviewClickTool,
  PreviewTypeTool,
  PreviewTypeSecretTool,
  PreviewPressTool,
  PreviewScrollTool,
  PreviewEvaluateTool,
  PreviewWaitForTool,
  PreviewRecordingStartTool,
  PreviewRecordingStopTool,
);

export const PreviewStandardToolkit = Toolkit.make(
  PreviewDialogTool,
  PreviewHoverTool,
  PreviewSelectTool,
  PreviewDragTool,
  PreviewUploadTool,
  PreviewCloseTool,
  PreviewStatusTool,
  PreviewOpenTool,
  PreviewNavigateTool,
  PreviewResizeTool,
  PreviewSetAppearanceTool,
  PreviewClickTool,
  PreviewTypeTool,
  PreviewTypeSecretTool,
  PreviewPressTool,
  PreviewScrollTool,
  PreviewEvaluateTool,
  PreviewWaitForTool,
  PreviewRecordingStartTool,
  PreviewRecordingStopTool,
);

export const PreviewSnapshotToolkit = Toolkit.make(PreviewSnapshotTool);
