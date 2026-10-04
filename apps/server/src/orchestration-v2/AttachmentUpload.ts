import {
  type ThreadId,
  type UploadChatAttachment,
  OrchestrationDispatchCommandError,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { ServerConfig } from "../config.ts";
import { createAttachmentId, resolveAttachmentPath } from "../attachmentStore.ts";
import { parseBase64DataUrl } from "../imageMime.ts";

/** Preserve the existing thread-owned image format across the V2 dispatch boundary. */
export const persistChatAttachments = Effect.fn("persistChatAttachments")(function* (input: {
  readonly threadId: ThreadId;
  readonly attachments: ReadonlyArray<UploadChatAttachment>;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serverConfig = yield* ServerConfig;
  const normalizedAttachments = yield* Effect.forEach(
    input.attachments,
    (attachment) =>
      Effect.gen(function* () {
        const parsed = parseBase64DataUrl(attachment.dataUrl);
        if (!parsed || !parsed.mimeType.startsWith("image/")) {
          return yield* new OrchestrationDispatchCommandError({
            message: `Invalid image attachment payload for '${attachment.name}'.`,
          });
        }

        const bytes = Buffer.from(parsed.base64, "base64");
        if (bytes.byteLength === 0 || bytes.byteLength > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
          return yield* new OrchestrationDispatchCommandError({
            message: `Image attachment '${attachment.name}' is empty or too large.`,
          });
        }

        const attachmentId = createAttachmentId(input.threadId);
        if (!attachmentId) {
          return yield* new OrchestrationDispatchCommandError({
            message: "Failed to create a safe attachment id.",
          });
        }

        const persistedAttachment = {
          type: "image" as const,
          id: attachmentId,
          name: attachment.name,
          mimeType: parsed.mimeType.toLowerCase(),
          sizeBytes: bytes.byteLength,
        };

        const attachmentPath = resolveAttachmentPath({
          attachmentsDir: serverConfig.attachmentsDir,
          attachment: persistedAttachment,
        });
        if (!attachmentPath) {
          return yield* new OrchestrationDispatchCommandError({
            message: `Failed to resolve persisted path for '${attachment.name}'.`,
          });
        }

        yield* fileSystem.makeDirectory(path.dirname(attachmentPath), { recursive: true }).pipe(
          Effect.mapError(
            () =>
              new OrchestrationDispatchCommandError({
                message: `Failed to create attachment directory for '${attachment.name}'.`,
              }),
          ),
        );
        yield* fileSystem.writeFile(attachmentPath, bytes).pipe(
          Effect.mapError(
            () =>
              new OrchestrationDispatchCommandError({
                message: `Failed to persist attachment '${attachment.name}'.`,
              }),
          ),
        );

        return persistedAttachment;
      }),
    { concurrency: 1 },
  );

  return { attachments: normalizedAttachments };
});
