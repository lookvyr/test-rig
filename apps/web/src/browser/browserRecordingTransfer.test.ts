import {
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  ThreadId,
  type DesktopPreviewRecordingArtifact,
} from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { uploadBrowserRecording } from "./browserRecordingTransfer";

const artifact: DesktopPreviewRecordingArtifact = {
  id: "desktop-recording",
  tabId: "tab-1",
  path: "/desktop/recording.webm",
  mimeType: "video/webm",
  sizeBytes: 6,
  createdAt: "2026-10-16T00:00:00.000Z",
};
const ticket = {
  attachmentId: "pending-recording",
  relativeUrl: "/api/attachments/upload/token",
  expiresAt: 0,
};
const input = () => ({
  threadId: ThreadId.make("thread-1"),
  artifact,
  blob: new Blob(["video!"], { type: "video/webm" }),
  httpBaseUrl: "https://remote.example.test/base/",
  deadline: Date.now() + 120_000,
  prepare: vi.fn(async () => ticket),
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("uploadBrowserRecording", () => {
  it("posts the original blob to the owning environment's signed upload URL", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const request = input();
    expect(await uploadBrowserRecording(request)).toBe(ticket.attachmentId);
    expect(request.prepare).toHaveBeenCalledWith({
      type: "file",
      name: "browser-recording.webm",
      mimeType: "video/webm",
      sizeBytes: 6,
    });
    expect(fetch).toHaveBeenCalledWith(
      new URL("https://remote.example.test/api/attachments/upload/token"),
      {
        method: "POST",
        headers: { "Content-Type": "video/webm" },
        body: request.blob,
        signal: expect.any(AbortSignal),
      },
    );
  });

  it.each(["prepare", "post"])(
    "reports %s failures instead of returning the desktop path",
    async (stage) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(null, { status: 503 })),
      );
      const request = input();
      if (stage === "prepare") request.prepare.mockRejectedValueOnce(new Error("Disconnected"));
      await expect(uploadBrowserRecording(request)).rejects.toMatchObject({
        _tag: "PreviewAutomationRecordingTransferError",
      });
    },
  );

  it("rejects oversized clips before preparing an upload", async () => {
    const request = input();
    Object.defineProperty(request.blob, "size", { value: PROVIDER_SEND_TURN_MAX_FILE_BYTES + 1 });
    await expect(uploadBrowserRecording(request)).rejects.toMatchObject({
      _tag: "PreviewAutomationRecordingTooLargeError",
    });
    expect(request.prepare).not.toHaveBeenCalled();
  });

  it("expires and aborts a stalled transfer", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, options: RequestInit) => {
        signal = options.signal as AbortSignal;
        return new Promise<Response>(() => {});
      }),
    );
    const request = { ...input(), deadline: Date.now() + 100 };
    const transfer = uploadBrowserRecording(request);
    const rejection = expect(transfer).rejects.toMatchObject({
      _tag: "PreviewAutomationRecordingDeadlineExpiredError",
    });
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
    expect(signal?.aborted).toBe(true);
  });

  it("does not post an upload prepared after its deadline", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    let resolve: ((value: typeof ticket) => void) | undefined;
    const request = {
      ...input(),
      deadline: Date.now() + 100,
      prepare: () =>
        new Promise<typeof ticket>((done) => {
          resolve = done;
        }),
    };
    const transfer = uploadBrowserRecording(request);
    const rejection = expect(transfer).rejects.toMatchObject({
      _tag: "PreviewAutomationRecordingDeadlineExpiredError",
    });
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
    resolve?.(ticket);
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
  });
});
