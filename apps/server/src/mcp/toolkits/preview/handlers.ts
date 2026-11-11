import {
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  PREVIEW_RECORDING_STOP_TIMEOUT_MS,
  PreviewAutomationRecordingTransferError,
  PreviewAutomationRecordingDesktopUpdateRequiredError,
  PreviewAutomationRecordingArtifact,
  PreviewAutomationActInputs,
  OrchestratorMcpFailure,
  SecretRequestError,
  type ThreadId,
} from "@t3tools/contracts";
import * as FileSystem from "effect/FileSystem";
import * as Record from "effect/Record";
import * as Schema from "effect/Schema";
import {
  parseAttachmentUuid,
  parseAttachmentFileExtension,
  PENDING_ATTACHMENT_THREAD_SEGMENT,
  toSafeThreadAttachmentSegment,
} from "../../../attachmentStore.ts";
import { resolveAttachmentRelativePath } from "../../../attachmentPaths.ts";
import * as ServerConfig from "../../../config.ts";
import * as SecretRequests from "../../../secrets/SecretRequests.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as Effect from "effect/Effect";
import type {
  PreviewAutomationSelectResult,
  PreviewAutomationOperation,
  PreviewAutomationOpenInput,
  PreviewAutomationRecordingStatus,
  PreviewAutomationResizeResult,
  PreviewAutomationSetColorSchemeResult,
  PreviewAutomationSnapshot,
  PreviewAutomationStatus,
  PreviewTabId,
} from "@t3tools/contracts";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as PreviewAutomationBroker from "../../PreviewAutomationBroker.ts";
import { PreviewSnapshotToolkit, PreviewStandardToolkit, PreviewToolkit } from "./tools.ts";

/**
 * Leaves `open` unset when the agent says nothing: whether that preview floats is the
 * client's `browserAutoShowFloatingPreview` setting, and filling in `true` would force
 * every reveal past it.
 */
export function normalizePreviewOpenInput(
  input: PreviewAutomationOpenInput,
): PreviewAutomationOpenInput {
  const open = input.open ?? input.show;
  return {
    ...input,
    ...(open === undefined ? {} : { open, show: open }),
    reuseExistingTab: input.reuseExistingTab ?? true,
  };
}

const invoke = Effect.fn("PreviewToolkit.invoke")(function* <A>(
  operation: PreviewAutomationOperation,
  input: unknown,
  timeoutMs?: number,
  tabId?: PreviewTabId,
): Effect.fn.Return<
  A,
  import("@t3tools/contracts").PreviewAutomationError,
  McpInvocationContext.McpInvocationContext | PreviewAutomationBroker.PreviewAutomationBroker
> {
  const scope = yield* McpInvocationContext.requireMcpCapability("preview");
  const broker = yield* PreviewAutomationBroker.PreviewAutomationBroker;
  return yield* broker.invoke<A>({
    scope,
    operation,
    input,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(tabId === undefined ? {} : { tabId }),
  });
});

const invokeTargeted = <A>(
  operation: PreviewAutomationOperation,
  input: {
    readonly tabId?: PreviewTabId | undefined;
    readonly [key: string]: unknown;
  },
  timeoutMs?: number,
) => {
  const { tabId, ...operationInput } = input;
  return invoke<A>(operation, operationInput, timeoutMs, tabId);
};

const decodeActInput = Record.map(PreviewAutomationActInputs, (schema) =>
  Schema.decodeUnknownEffect(schema),
);

const UploadedRecordingArtifact = Schema.Struct({
  ...PreviewAutomationRecordingArtifact.fields,
  uploadedAttachmentId: Schema.optional(Schema.String),
});
const decodeUploadedRecordingArtifact = Schema.decodeUnknownEffect(UploadedRecordingArtifact);

export const claimPreviewRecording = Effect.fn("PreviewToolkit.claimRecording")(function* (
  threadId: ThreadId,
  response: unknown,
) {
  const artifact = yield* decodeUploadedRecordingArtifact(response).pipe(
    Effect.mapError(
      (cause) =>
        new PreviewAutomationRecordingTransferError({
          threadId,
          cause,
        }),
    ),
  );
  if (!artifact.uploadedAttachmentId) {
    return yield* new PreviewAutomationRecordingDesktopUpdateRequiredError({ threadId });
  }
  const config = yield* ServerConfig.ServerConfig;
  const uuid = parseAttachmentUuid(artifact.uploadedAttachmentId);
  const extension = parseAttachmentFileExtension(artifact.uploadedAttachmentId);
  const threadSegment = toSafeThreadAttachmentSegment(threadId);
  const pendingId = `${PENDING_ATTACHMENT_THREAD_SEGMENT}-${uuid}-${extension}`;
  if (!uuid || !extension || !threadSegment || artifact.uploadedAttachmentId !== pendingId) {
    return yield* new PreviewAutomationRecordingTransferError({
      threadId,
    });
  }
  const finalId = `${threadSegment}-${uuid}-${extension}`;
  const currentPath = resolveAttachmentRelativePath({
    attachmentsDir: config.attachmentsDir,
    relativePath: `${pendingId}.${extension}`,
  });
  const finalPath = resolveAttachmentRelativePath({
    attachmentsDir: config.attachmentsDir,
    relativePath: `${finalId}.${extension}`,
  });
  if (!currentPath || !finalPath) {
    return yield* new PreviewAutomationRecordingTransferError({ threadId });
  }
  const fileSystem = yield* FileSystem.FileSystem;
  const validateFile = (filePath: string) =>
    fileSystem.stat(filePath).pipe(
      Effect.filterOrFail(
        (stat) =>
          stat.type === "File" &&
          Number(stat.size) === artifact.sizeBytes &&
          artifact.sizeBytes > 0 &&
          artifact.sizeBytes <= PROVIDER_SEND_TURN_MAX_FILE_BYTES,
        () => new PreviewAutomationRecordingTransferError({ threadId }),
      ),
    );
  yield* Effect.gen(function* () {
    yield* validateFile(currentPath);
    yield* fileSystem.rename(currentPath, finalPath);
  }).pipe(
    Effect.catchIf(
      (cause) =>
        cause._tag !== "PreviewAutomationRecordingTransferError" &&
        cause.reason._tag === "NotFound",
      () => validateFile(finalPath),
    ),
    Effect.mapError((cause) => new PreviewAutomationRecordingTransferError({ threadId, cause })),
  );
  const { uploadedAttachmentId: _uploadedAttachmentId, ...recording } = artifact;
  return {
    ...recording,
    id: finalId,
    path: finalPath,
    recordingMarkdown: `![Browser recording](<${finalPath.replace(/([\\<>])/g, "\\$1")}>)`,
  };
});

const handlers = {
  preview_type_secret: (input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.requireMcpCapability("preview");
      const threads = yield* ThreadManagementService.ThreadManagementService;
      const secrets = yield* SecretRequests.SecretRequests;
      const records = yield* threads
        .getThreadRecords(scope.threadId, [], { turnItemTypes: [], messageRoles: [] })
        .pipe(Effect.mapError(() => new SecretRequestError({ reason: "load_failed" })));
      const text = yield* secrets.consume({
        ref: input.secretRef,
        projectId: records.thread.projectId,
      });
      yield* invoke<void>(
        "typeSecret",
        {
          text,
          locator: input.locator,
          clear: true,
          ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
        },
        input.timeoutMs,
        input.tabId,
      ).pipe(Effect.mapError(() => new SecretRequestError({ reason: "entry_failed" })));
      return null;
    }),

  preview_dialog: (input) => invokeTargeted<PreviewAutomationStatus>("dialog", input),
  preview_status: (input) => invokeTargeted<PreviewAutomationStatus>("status", input ?? {}),
  // Models often pass a dev server as both `url` and `target`; the target knows the environment.
  preview_open: ({ target, url, ...input }) =>
    Effect.gen(function* () {
      const opened = yield* invokeTargeted<PreviewAutomationStatus>(
        "open",
        normalizePreviewOpenInput(
          target === undefined && url !== undefined ? { ...input, url } : input,
        ),
      );
      if (target === undefined || opened.tabId === null) return opened;
      return yield* invokeTargeted<PreviewAutomationStatus>("navigate", {
        target,
        tabId: opened.tabId,
      });
    }),
  preview_navigate: (input) =>
    invokeTargeted<PreviewAutomationStatus>("navigate", input, input.timeoutMs),
  preview_resize: (input) =>
    invokeTargeted<PreviewAutomationResizeResult>("resize", input, input.timeoutMs),
  preview_set_appearance: (input) =>
    invokeTargeted<PreviewAutomationSetColorSchemeResult>("setColorScheme", input),
  preview_snapshot: (input) => {
    // Saving and response selection belong to MCP; the browser captures the snapshot.
    const { includeImage, save, ...target } = input ?? {};
    // The saved file is for people, so it keeps the resolution the agent's image is capped below.
    // A save without an image returns only the path, so the page state is not read at all.
    return invokeTargeted<PreviewAutomationSnapshot>("snapshot", {
      ...target,
      ...(save === true ? { fullScreenshot: true } : {}),
      ...(save === true && includeImage !== true ? { screenshotOnly: true } : {}),
    });
  },
  preview_act: ({ action, ...input }) =>
    decodeActInput[action](input).pipe(
      Effect.mapError(
        (cause) => new OrchestratorMcpFailure({ code: "invalid_request", message: cause.message }),
      ),
      Effect.flatMap((decoded) =>
        invokeTargeted<PreviewAutomationSelectResult | undefined>(
          action,
          decoded,
          "timeoutMs" in decoded ? decoded.timeoutMs : undefined,
        ),
      ),
      // Only select reports a result; other actions answer null.
      Effect.map((result) => result ?? null),
    ),
  preview_evaluate: (input) =>
    invokeTargeted<unknown>("evaluate", input).pipe(
      Effect.map((value) => ({ value: value ?? null })),
    ),
  preview_wait_for: (input) =>
    invokeTargeted<void>("waitFor", input, input.timeoutMs).pipe(Effect.as(null)),
  preview_recording_start: (input) =>
    invokeTargeted<PreviewAutomationRecordingStatus>("recordingStart", input ?? {}),
  preview_recording_stop: (input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.requireMcpCapability("preview");
      const { tabId, ...operationInput } = input ?? {};
      const response = yield* invoke<unknown>(
        "recordingStop",
        { ...operationInput, transferToEnvironment: true },
        PREVIEW_RECORDING_STOP_TIMEOUT_MS,
        tabId,
      );
      return yield* claimPreviewRecording(scope.threadId, response);
    }),
} satisfies Parameters<typeof PreviewToolkit.toLayer>[0];

const { preview_snapshot, ...standardHandlers } = handlers;

export const PreviewStandardToolkitHandlersLive = PreviewStandardToolkit.toLayer(standardHandlers);

export const PreviewSnapshotToolkitHandlersLive = PreviewSnapshotToolkit.toLayer({
  preview_snapshot,
});

export const PreviewToolkitHandlersLive = PreviewToolkit.toLayer(handlers);
