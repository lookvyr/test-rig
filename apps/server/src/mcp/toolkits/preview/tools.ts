import * as SecretRequests from "../../../secrets/SecretRequests.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import {
  BrowserNavigationTarget,
  OrchestratorMcpFailure,
  PreviewAutomationActInput,
  PreviewAutomationDialogInput,
  PreviewAutomationSelectResult,
  PreviewAutomationError,
  PreviewAutomationEvaluateInput,
  PreviewAutomationNavigateInput,
  PreviewAutomationOpenInput,
  PreviewAutomationRecordingArtifact,
  PreviewAutomationRecordingStatus,
  PreviewAutomationResizeInput,
  PreviewAutomationResizeResult,
  PreviewAutomationSetColorSchemeInput,
  PreviewAutomationSetColorSchemeResult,
  PreviewAutomationSnapshot,
  PreviewAutomationStatus,
  PreviewAutomationTabTargetInput,
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

// `url` already covers websites, so open only adds the dev-server target.
const EnvironmentPortTarget = BrowserNavigationTarget.members[1];

export const PreviewOpenTool = browserTool(
  Tool.make("preview_open", {
    description:
      "Open and show a browser tab. For a dev server, pass `target` instead of `url`. open=false keeps it in the background. Use tabId for an existing tab, reuseExistingTab=false for a new one, or omit both for this session's current tab.",
    parameters: PreviewAutomationOpenInput.mapFields(
      (fields) => ({ ...fields, target: Schema.optional(EnvironmentPortTarget) }),
      { unsafePreserveChecks: true },
    ),
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
      "Inspect before interacting: page text, `accessibilityTree` of controls with refs, and console and network errors since the last snapshot. Target an element with `locator='aria-ref=<ref>'`; refs die on navigation or a new snapshot. Text caps near 20 KB; `omitted` notes guide targeted preview_evaluate reads. To show a screenshot when asked: `save=true`, then include `screenshotMarkdown` verbatim.",
    parameters: Schema.Struct({
      ...PreviewAutomationTabTargetInput.fields,
      includeImage: Schema.optional(Schema.Boolean).annotate({
        description: "Default false. True only to see the page.",
      }),
      fullTree: Schema.optional(Schema.Boolean).annotate({
        description: "Default false. True adds every node and link URL to the tree.",
      }),
      save: Schema.optional(Schema.Boolean).annotate({
        description:
          "Write a full-size PNG; return only `screenshotPath` and `screenshotMarkdown`.",
      }),
    }),
    success: PreviewAutomationSnapshot,
    failure: PreviewAutomationError,
    dependencies,
  }).annotate(Tool.Title, "Inspect browser page"),
);

export const PreviewActTool = browserTool(
  Tool.make("preview_act", {
    description:
      "Act on the chosen tab. Target with `locator='aria-ref=<ref>'` from `preview_snapshot`; `x` and `y` go together. `timeoutMs` defaults to 15000. click: `button`, `clickCount` 1 to 3. type: literal `text`, `clear=true` replaces it. hover: shows menus or tooltips. select: `values` in one native <select>, by value or label; for a custom dropdown, click it open, then click the option. drag: `source` onto `target`. upload: absolute `paths` answer the file picker `preview_status` reports, [] cancels it, or a `locator` sets an <input type=file>. press: one `key`, such as 'Enter', with `modifiers`, to the focused element; click a field first to focus it. scroll: the tab, or one container with a locator; positive `deltaY` scrolls down, positive `deltaX` right. For passwords and other private values, use `preview_type_secret` instead of `type`.",
    parameters: PreviewAutomationActInput,
    success: Schema.Union([PreviewAutomationSelectResult, Schema.Null]),
    failure: Schema.Union([PreviewAutomationError, OrchestratorMcpFailure]),
    dependencies,
  }).annotate(Tool.Title, "Act in preview page"),
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

export const PreviewEvaluateTool = browserTool(
  Tool.make("preview_evaluate", {
    description:
      "Run JavaScript in the chosen tab; top-level await works. It can change page state. Returns `{value}`, up to 64 KB, null for undefined.",
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
      "Start recording the chosen tab, without sound. For a desktop walkthrough, first `preview_resize` to a fixed desktop viewport; keep an intentional mobile one.",
    parameters: PreviewAutomationTabTargetInput,
    success: PreviewAutomationRecordingStatus,
    failure: PreviewAutomationError,
    dependencies,
  }).annotate(Tool.Title, "Start browser recording"),
);

export const PreviewRecordingStopTool = safeBrowserTool(
  Tool.make("preview_recording_stop", {
    description:
      "Stop recording the chosen tab. Returns a local path (max 50 MiB) and `recordingMarkdown`; include it verbatim so the user can play the video in chat.",
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
      "Accept or dismiss the dialog `preview_status` reports. Pass `promptText` to accept a prompt. Needs your own tab. Desktop hosts may not support this.",
    parameters: PreviewAutomationDialogInput,
    success: PreviewAutomationStatus,
    failure: PreviewAutomationError,
    dependencies,
  }).annotate(Tool.Title, "Resolve browser dialog"),
);

export const PreviewToolkit = Toolkit.make(
  PreviewDialogTool,
  PreviewStatusTool,
  PreviewOpenTool,
  PreviewNavigateTool,
  PreviewResizeTool,
  PreviewSetAppearanceTool,
  PreviewSnapshotTool,
  PreviewActTool,
  PreviewTypeSecretTool,
  PreviewEvaluateTool,
  PreviewWaitForTool,
  PreviewRecordingStartTool,
  PreviewRecordingStopTool,
);

export const PreviewStandardToolkit = Toolkit.make(
  PreviewDialogTool,
  PreviewStatusTool,
  PreviewOpenTool,
  PreviewNavigateTool,
  PreviewResizeTool,
  PreviewSetAppearanceTool,
  PreviewActTool,
  PreviewTypeSecretTool,
  PreviewEvaluateTool,
  PreviewWaitForTool,
  PreviewRecordingStartTool,
  PreviewRecordingStopTool,
);

export const PreviewSnapshotToolkit = Toolkit.make(PreviewSnapshotTool);
