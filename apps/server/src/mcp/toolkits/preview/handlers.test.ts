import { describe, expect, it } from "vite-plus/test";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as ServerConfig from "../../../config.ts";
import {
  createPendingAttachmentId,
  parseThreadSegmentFromAttachmentId,
  sweepStalePendingAttachments,
} from "../../../attachmentStore.ts";
import { it as effectIt } from "@effect/vitest";
import {
  EnvironmentId,
  PREVIEW_RECORDING_STOP_TIMEOUT_MS,
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

import {
  claimPreviewRecording,
  normalizePreviewOpenInput,
  PreviewToolkitHandlersLive,
} from "./handlers.ts";
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
        ServerConfig.layerTest(process.cwd(), { prefix: "test-rig-preview-private-" }).pipe(
          Layer.provideMerge(NodeServices.layer),
        ),
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

describe("claimPreviewRecording", () => {
  effectIt.effect("overlapping and repeated claims return the same retained recording", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const uploadedAttachmentId = createPendingAttachmentId(".webm");
      const pendingPath = path.join(config.attachmentsDir, `${uploadedAttachmentId}.webm`);
      yield* fileSystem.makeDirectory(config.attachmentsDir, { recursive: true });
      yield* fileSystem.writeFileString(pendingPath, "video!");
      const response = {
        id: "desktop-recording",
        tabId: "tab-1",
        path: "/desktop/recording.webm",
        mimeType: "video/webm",
        sizeBytes: 6,
        createdAt: "2026-09-07T00:00:00.000Z",
        uploadedAttachmentId,
      };
      const claim = claimPreviewRecording(ThreadId.make("thread-1"), response);
      const [first, second] = yield* Effect.all([claim, claim], { concurrency: "unbounded" });
      expect(first).toEqual(second);
      expect(yield* claim).toEqual(first);
      expect(yield* fileSystem.readFileString(first.path)).toBe("video!");
      expect(yield* fileSystem.exists(pendingPath)).toBe(false);
      expect(first.recordingMarkdown).toBe(`![Browser recording](<${first.path}>)`);
      const nowMs = 1_800_000_000_000;
      yield* fileSystem.utimes(
        first.path,
        (nowMs - 25 * 60 * 60 * 1000) / 1000,
        (nowMs - 25 * 60 * 60 * 1000) / 1000,
      );
      expect(
        sweepStalePendingAttachments({ attachmentsDir: config.attachmentsDir, nowMs }).deleted,
      ).toBe(0);
      expect(yield* fileSystem.exists(first.path)).toBe(true);
      expect(yield* claim).toEqual(first);
      const wrongThread = yield* claimPreviewRecording(ThreadId.make("thread-2"), response).pipe(
        Effect.result,
      );
      expect(wrongThread._tag).toBe("Failure");
      const wrongPath = yield* claimPreviewRecording(ThreadId.make("thread-1"), {
        ...response,
        uploadedAttachmentId: `../${uploadedAttachmentId}`,
      }).pipe(Effect.result);
      expect(wrongPath._tag).toBe("Failure");
    }).pipe(
      Effect.provide(
        ServerConfig.layerTest(process.cwd(), { prefix: "test rig preview recording-" }).pipe(
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
    ),
  );

  effectIt.effect.each([6, 5])(
    "claims only a complete uploaded recording (reported bytes: %s)",
    (sizeBytes) =>
      Effect.gen(function* () {
        const config = yield* ServerConfig.ServerConfig;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const uploadedAttachmentId = createPendingAttachmentId(".webm");
        const pendingPath = path.join(config.attachmentsDir, `${uploadedAttachmentId}.webm`);
        yield* fileSystem.makeDirectory(config.attachmentsDir, { recursive: true });
        yield* fileSystem.writeFileString(pendingPath, "video!");
        const response = {
          id: "desktop-recording",
          tabId: "tab-1",
          path: "/desktop/recording.webm",
          mimeType: "video/webm",
          sizeBytes,
          createdAt: "2026-09-07T00:00:00.000Z",
          uploadedAttachmentId,
        };
        const result = yield* claimPreviewRecording(ThreadId.make("thread-1"), response).pipe(
          Effect.result,
        );
        if (sizeBytes === 6) {
          expect(result._tag).toBe("Success");
          if (result._tag !== "Success") return;
          expect(result.success.path).not.toBe(response.path);
          expect(parseThreadSegmentFromAttachmentId(result.success.id)).toBe("thread-1");
          expect(yield* fileSystem.readFileString(result.success.path)).toBe("video!");
          expect(yield* fileSystem.exists(pendingPath)).toBe(false);
        } else {
          expect(result._tag).toBe("Failure");
          if (result._tag !== "Failure") return;
          expect(result.failure._tag).toBe("PreviewAutomationRecordingTransferError");
          expect(yield* fileSystem.exists(pendingPath)).toBe(true);
        }
      }).pipe(
        Effect.provide(
          ServerConfig.layerTest(process.cwd(), { prefix: "test rig preview recording-" }).pipe(
            Layer.provideMerge(NodeServices.layer),
          ),
        ),
      ),
  );

  effectIt.effect("reports an older desktop without returning its inaccessible path", () =>
    Effect.gen(function* () {
      const result = yield* claimPreviewRecording(ThreadId.make("thread-1"), {
        id: "desktop-recording",
        tabId: "tab-1",
        path: "/desktop/recording.webm",
        mimeType: "video/webm",
        sizeBytes: 6,
        createdAt: "2026-09-07T00:00:00.000Z",
      }).pipe(Effect.result);
      expect(result._tag).toBe("Failure");
      if (result._tag !== "Failure") return;
      expect(result.failure._tag).toBe("PreviewAutomationRecordingDesktopUpdateRequiredError");
      expect(result.failure.message).toContain("Update the desktop app");
    }).pipe(
      Effect.provide(
        ServerConfig.layerTest(process.cwd(), { prefix: "test rig preview recording-" }).pipe(
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
    ),
  );
});

effectIt.effect(
  "recording stop requests transfer, waits for saving, and returns retained embed Markdown",
  () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const threadId = ThreadId.make("recording-thread");
      const uploadedAttachmentId = createPendingAttachmentId(".webm");
      const pendingPath = path.join(config.attachmentsDir, `${uploadedAttachmentId}.webm`);
      yield* fileSystem.makeDirectory(config.attachmentsDir, { recursive: true });
      yield* fileSystem.writeFileString(pendingPath, "video!");
      const requests: PreviewAutomationBroker.PreviewAutomationInvokeInput[] = [];
      const dependencies = Layer.mergeAll(
        Layer.succeed(McpInvocationContext.McpInvocationContext, {
          environmentId: EnvironmentId.make("recording-environment"),
          threadId,
          providerSessionId: "session",
          providerInstanceId: ProviderInstanceId.make("codex"),
          capabilities: new Set(["preview" as const]),
          issuedAt: 0,
        }),
        Layer.mock(ThreadManagementService.ThreadManagementService)({}),
        Layer.mock(SecretRequests.SecretRequests)({}),
        Layer.mock(PreviewAutomationBroker.PreviewAutomationBroker)({
          invoke: <A>(request: PreviewAutomationBroker.PreviewAutomationInvokeInput) =>
            Effect.sync(() => {
              requests.push(request);
              return {
                id: "desktop-recording",
                tabId: "recording-tab",
                path: "/desktop/recording.webm",
                mimeType: "video/webm",
                sizeBytes: 6,
                createdAt: "2026-10-16T00:00:00.000Z",
                uploadedAttachmentId,
              } as A;
            }),
        }),
      );
      const output = yield* Effect.gen(function* () {
        const toolkit = yield* PreviewToolkit.pipe(Effect.provide(PreviewToolkitHandlersLive));
        return yield* toolkit
          .handle("preview_recording_stop", { tabId: PreviewTabId.make("recording-tab") })
          .pipe(Stream.unwrap, Stream.runCollect);
      }).pipe(Effect.provide(dependencies));
      expect(requests).toMatchObject([
        {
          operation: "recordingStop",
          input: { transferToEnvironment: true },
          tabId: "recording-tab",
          timeoutMs: PREVIEW_RECORDING_STOP_TIMEOUT_MS,
        },
      ]);
      const finalPath = path.join(
        config.attachmentsDir,
        `recording-thread-${uploadedAttachmentId.slice("pending-".length)}.webm`,
      );
      expect(output.at(-1)?.result).toMatchObject({
        path: finalPath,
        recordingMarkdown: `![Browser recording](<${finalPath}>)`,
      });
      expect(yield* fileSystem.exists(pendingPath)).toBe(false);
      expect(yield* fileSystem.readFileString(finalPath)).toBe("video!");
    }).pipe(
      Effect.provide(
        ServerConfig.layerTest(process.cwd(), { prefix: "test rig recording stop-" }).pipe(
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
    ),
);
