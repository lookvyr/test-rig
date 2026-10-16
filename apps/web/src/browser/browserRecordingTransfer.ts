import {
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  PreviewAutomationRecordingDeadlineExpiredError,
  PreviewAutomationRecordingTooLargeError,
  PreviewAutomationRecordingTransferError,
  type AttachmentCreateUploadUrlInput,
  type AttachmentCreateUploadUrlResult,
  type DesktopPreviewRecordingArtifact,
  type ThreadId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

/** Upload capture bytes to the environment that owns the agent, keeping the desktop copy. */
export async function uploadBrowserRecording(input: {
  readonly threadId: ThreadId;
  readonly artifact: DesktopPreviewRecordingArtifact;
  readonly blob: Blob;
  readonly httpBaseUrl: string | null;
  readonly deadline: number;
  readonly prepare: (
    upload: AttachmentCreateUploadUrlInput,
  ) => Promise<AttachmentCreateUploadUrlResult>;
}): Promise<string> {
  const { threadId, artifact, blob } = input;
  if (blob.size > PROVIDER_SEND_TURN_MAX_FILE_BYTES) {
    throw new PreviewAutomationRecordingTooLargeError({ threadId });
  }
  if (blob.size === 0 || input.httpBaseUrl === null) {
    throw new PreviewAutomationRecordingTransferError({ threadId });
  }
  const remainingMs = input.deadline - Date.now();
  if (remainingMs <= 0) throw new PreviewAutomationRecordingDeadlineExpiredError({ threadId });
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new PreviewAutomationRecordingDeadlineExpiredError({ threadId }));
      controller.abort();
    }, remainingMs);
  });
  const transfer = async () => {
    const ticket = await input.prepare({
      type: "file",
      name: `browser-recording.${artifact.mimeType.startsWith("video/mp4") ? "mp4" : "webm"}`,
      mimeType: artifact.mimeType,
      sizeBytes: blob.size,
    });
    controller.signal.throwIfAborted();
    const response = await fetch(new URL(ticket.relativeUrl, input.httpBaseUrl!), {
      method: "POST",
      headers: { "Content-Type": artifact.mimeType },
      body: blob,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Recording upload failed with HTTP ${response.status}.`);
    return ticket.attachmentId;
  };
  try {
    return await Promise.race([transfer(), deadline]);
  } catch (cause) {
    if (Schema.is(PreviewAutomationRecordingDeadlineExpiredError)(cause)) throw cause;
    throw new PreviewAutomationRecordingTransferError({ threadId, cause });
  } finally {
    clearTimeout(timeout);
  }
}
