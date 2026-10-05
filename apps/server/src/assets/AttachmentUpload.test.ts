import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ChatAttachmentId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { HttpRouter, HttpServerRequest } from "effect/unstable/http";
import { attachmentUploadRouteLayer } from "../http.ts";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import {
  claimPendingAttachments,
  releaseClaimedAttachments,
} from "../orchestration-v2/AttachmentClaims.ts";
import { createPendingAttachmentId, sweepStalePendingAttachments } from "../attachmentStore.ts";
import * as Upload from "./AttachmentUpload.ts";

const testLayer = Layer.mergeAll(
  NodeServices.layer,
  Layer.mock(ServerSecretStore.ServerSecretStore)({
    getOrCreateRandom: () => Effect.succeed(new TextEncoder().encode("test-signing-key")),
  }),
).pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-owned-uploads-" })),
  Layer.provideMerge(NodeServices.layer),
);

const owner = ThreadId.make("thread.owner");
const other = ThreadId.make("thread-owner");
const input = { type: "file" as const, name: "sample.owner", mimeType: "text/plain", sizeBytes: 4 };

it.effect("serves signed uploads and rejects invalid tokens or mismatched body sizes", () =>
  Effect.gen(function* () {
    const app = yield* HttpRouter.toHttpEffect(attachmentUploadRouteLayer);
    const post = (relativeUrl: string, body: string) =>
      app.pipe(
        Effect.provideService(
          HttpServerRequest.HttpServerRequest,
          HttpServerRequest.fromWeb(
            new Request(`http://localhost${relativeUrl}`, { method: "POST", body }),
          ),
        ),
      );
    const issued = yield* Upload.issueAttachmentUploadUrl(input, owner);
    expect((yield* post(`${issued.relativeUrl}invalid`, "test")).status).toBe(404);
    expect((yield* post(issued.relativeUrl, "too large")).status).toBe(400);
    expect((yield* post(issued.relativeUrl, "bad")).status).toBe(400);
    const fs = yield* FileSystem.FileSystem;
    const config = yield* ServerConfig.ServerConfig;
    const path = yield* Path.Path;
    expect(yield* fs.exists(path.join(config.attachmentsDir, `${issued.attachmentId}.owner`))).toBe(
      false,
    );
    expect((yield* post(issued.relativeUrl, "test")).status).toBe(204);
    expect(
      yield* fs.readFileString(path.join(config.attachmentsDir, `${issued.attachmentId}.owner`)),
    ).toBe("test");
    yield* Upload.assertPendingAttachmentOwner(issued.attachmentId, owner);
    expect(
      (yield* fs.readDirectory(config.attachmentsDir)).filter((file) => file.endsWith(".part")),
    ).toEqual([]);
  }).pipe(Effect.scoped, Effect.provide(testLayer)),
);

it.effect("restricts pending discard to the issuing thread and preserves delivered copies", () =>
  Effect.gen(function* () {
    const issued = yield* Upload.issueAttachmentUploadUrl(input, owner);
    const claims = yield* Upload.validateAttachmentUploadToken(
      issued.relativeUrl.split("/").at(-1)!,
    );
    expect(claims).not.toBeNull();
    if (!claims) return;
    expect(yield* Upload.storeAttachmentUpload(claims, new TextEncoder().encode("test"))).toEqual({
      ok: true,
    });
    const config = yield* ServerConfig.ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const pendingPath = path.join(config.attachmentsDir, `${issued.attachmentId}.owner`);
    expect(
      (yield* Upload.deletePendingAttachment(issued.attachmentId, other).pipe(Effect.flip))._tag,
    ).toBe("PendingAttachmentOwnershipError");
    expect(yield* fs.readFileString(pendingPath)).toBe("test");
    yield* Upload.assertPendingAttachmentOwner(issued.attachmentId, owner);
    const claimed = yield* claimPendingAttachments({
      threadId: "intentional-target",
      attachments: [{ ...input, id: ChatAttachmentId.make(issued.attachmentId) }],
    });
    expect(claimed.attachments[0]?.id).toMatch(/^intentional-target-/);
    yield* releaseClaimedAttachments(claimed.claimedPaths);
    expect(yield* fs.readFileString(pendingPath)).toBe("test");
    yield* Upload.assertPendingAttachmentOwner(issued.attachmentId, owner);
    const retry = yield* claimPendingAttachments({
      threadId: "intentional-target",
      attachments: [{ ...input, id: ChatAttachmentId.make(issued.attachmentId) }],
    });
    yield* Upload.deletePendingAttachment(issued.attachmentId, owner);
    yield* Upload.deletePendingAttachment(issued.attachmentId, owner);
    expect(yield* fs.exists(pendingPath)).toBe(false);
    yield* Upload.deletePendingAttachment(retry.attachments[0]!.id, owner);
    expect(yield* fs.readFileString(retry.claimedPaths[0]!)).toBe("test");
  }).pipe(Effect.provide(testLayer)),
);

it.effect("rejects missing or malformed ownership and unsafe IDs", () =>
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const legacy = createPendingAttachmentId();
    yield* fs.makeDirectory(config.attachmentsDir, { recursive: true });
    yield* fs.writeFileString(path.join(config.attachmentsDir, `${legacy}.png`), "legacy");
    for (const id of [legacy, `../${legacy}`, `${legacy}.png`, "pending-invalid"]) {
      expect((yield* Upload.assertPendingAttachmentOwner(id, owner).pipe(Effect.flip))._tag).toBe(
        "PendingAttachmentOwnershipError",
      );
    }
    yield* fs.writeFileString(
      path.join(config.attachmentsDir, `${legacy}.owner.json`),
      "malformed",
    );
    expect((yield* Upload.deletePendingAttachment(legacy, owner).pipe(Effect.flip))._tag).toBe(
      "PendingAttachmentOwnershipError",
    );
    expect(yield* fs.readFileString(path.join(config.attachmentsDir, `${legacy}.png`))).toBe(
      "legacy",
    );
  }).pipe(Effect.provide(testLayer)),
);

it.effect("records ownership before upload and sweeps abandoned owner records", () =>
  Effect.gen(function* () {
    const issued = yield* Upload.issueAttachmentUploadUrl(input, owner);
    yield* Upload.assertPendingAttachmentOwner(issued.attachmentId, owner);
    yield* Upload.deletePendingAttachment(issued.attachmentId, owner);
    const config = yield* ServerConfig.ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const ownerPath = path.join(config.attachmentsDir, `${issued.attachmentId}.owner.json`);
    const info = yield* fs.stat(ownerPath);
    const nowMs =
      Number(info.mtime._tag === "Some" ? info.mtime.value.getTime() : 0) + 25 * 60 * 60 * 1000;
    expect(
      sweepStalePendingAttachments({ attachmentsDir: config.attachmentsDir, nowMs }).deleted,
    ).toBe(1);
    expect(yield* fs.exists(ownerPath)).toBe(false);
  }).pipe(Effect.provide(testLayer)),
);
