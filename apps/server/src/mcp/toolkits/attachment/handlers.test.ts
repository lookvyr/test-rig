import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  ChatAttachmentId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as Upload from "../../../assets/AttachmentUpload.ts";
import * as ServerSecretStore from "../../../auth/ServerSecretStore.ts";
import * as ServerConfig from "../../../config.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ThreadLaunch from "../../../orchestration-v2/ThreadLaunchService.ts";
import * as Project from "../../../project/ProjectService.ts";
import * as ManagedProjectFolders from "../../../project/ManagedProjectFolders.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { ProjectHandlersLive } from "../project/handlers.ts";
import { ProjectToolkit } from "../project/tools.ts";
import { AttachmentHandlersLive } from "./handlers.ts";
import { AttachmentToolkit } from "./tools.ts";

it.effect(
  "checks the source owner on MCP discard, send and launch while allowing intentional transfers",
  () =>
    Effect.gen(function* () {
      const owner = ThreadId.make("owner-thread");
      const other = ThreadId.make("other-thread");
      const target = ThreadId.make("target-thread");
      const projectId = ProjectId.make("project");
      const providerInstanceId = ProviderInstanceId.make("codex");
      const shell = (id: ThreadId) =>
        ({
          id,
          projectId,
          providerInstanceId,
          modelSelection: { instanceId: providerInstanceId, model: "gpt-5" },
          runtimeMode: "full-access",
          interactionMode: "default",
          activeRunId: "active-run",
          archivedAt: null,
          deletedAt: null,
        }) as OrchestrationV2ThreadShell;
      const sent: ThreadManagement.ThreadManagementSendInput[] = [];
      const launched: ThreadLaunch.ThreadLaunchInput[] = [];
      const dependencies = Layer.mergeAll(
        NodeServices.layer,
        NodeCrypto.layer,
        Layer.mock(ServerSecretStore.ServerSecretStore)({
          getOrCreateRandom: () => Effect.succeed(new TextEncoder().encode("signing-key")),
        }),
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getThreadShell: (id) => Effect.succeed(shell(id)),
          getProjectThreadRecords: ((input: { threadId: ThreadId }) =>
            Effect.succeed({
              thread: shell(input.threadId),
              messages: [],
              runs: [],
              turnItems: [],
              nodes: [],
              providerTurns: [],
              runtimeRequests: [],
              sessions: [],
            })) as ThreadManagement.ThreadManagementServiceShape["getProjectThreadRecords"],
          sendToThread: (input) => {
            sent.push(input);
            return Effect.succeed({
              message: { attachments: input.attachments },
              run: { id: "sent-run", status: "queued" },
            } as unknown as ThreadManagement.ThreadManagementSendResult);
          },
        }),
        Layer.mock(ThreadLaunch.ThreadLaunchService)({
          launch: (input) => {
            launched.push(input);
            return Effect.succeed({
              projection: {
                thread: shell(input.threadId!),
                runs: [],
                messages: [{ attachments: input.initialMessage?.attachments ?? [] }],
              },
            } as unknown as ThreadLaunch.ThreadLaunchResult);
          },
        }),
        Layer.mock(Project.ProjectService)({}),
        Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({ namedProjectsRoot: "/unused" }),
      ).pipe(
        Layer.provideMerge(
          ServerConfig.layerTest(process.cwd(), { prefix: "t3-mcp-upload-ownership-" }),
        ),
        Layer.provideMerge(NodeServices.layer),
      );
      yield* Effect.gen(function* () {
        const scoped = (threadId: ThreadId) =>
          Layer.succeed(McpInvocationContext.McpInvocationContext, {
            environmentId: EnvironmentId.make("environment"),
            threadId,
            providerSessionId: "session",
            providerInstanceId,
            issuedAt: 0,
            capabilities: new Set(["orchestration" as const]),
          });
        const attachments = yield* AttachmentToolkit.pipe(Effect.provide(AttachmentHandlersLive));
        const projects = yield* ProjectToolkit.pipe(Effect.provide(ProjectHandlersLive));
        const upload = {
          type: "file" as const,
          name: "test.txt",
          mimeType: "text/plain",
          sizeBytes: 4,
        };
        const prepared = yield* attachments
          .handle("t3_attachment_prepare_upload", { upload })
          .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(scoped(owner)));
        const issued = prepared.at(-1)!.result;
        if (!("attachmentId" in issued)) throw new Error("Upload preparation failed");
        const claims = yield* Upload.validateAttachmentUploadToken(
          issued.relativeUrl.split("/").at(-1)!,
        );
        if (!claims) throw new Error("Upload token invalid");
        expect(
          yield* Upload.storeAttachmentUpload(claims, new TextEncoder().encode("test")),
        ).toEqual({ ok: true });
        const attachment = {
          ...upload,
          id: ChatAttachmentId.make(issued.attachmentId),
        };
        const discard = (threadId: ThreadId) =>
          attachments
            .handle("t3_attachment_discard", { attachmentId: issued.attachmentId })
            .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(scoped(threadId)));
        const send = (threadId: ThreadId) =>
          attachments
            .handle("t3_thread_send_attachments", { threadId: target, attachments: [attachment] })
            .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(scoped(threadId)));
        const launch = (threadId: ThreadId) =>
          projects
            .handle("t3_thread_launch", { title: "Owned upload", attachments: [attachment] })
            .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(scoped(threadId)));
        expect((yield* discard(other)).at(-1)?.result).toMatchObject({ code: "invalid_request" });
        expect((yield* send(other)).at(-1)?.result).toMatchObject({ code: "invalid_request" });
        expect((yield* launch(other)).at(-1)?.result).toMatchObject({ code: "invalid_request" });
        expect(sent).toHaveLength(0);
        expect(launched).toHaveLength(0);
        expect((yield* send(owner)).at(-1)?.result).toMatchObject({
          threadId: target,
          runId: "sent-run",
        });
        expect(sent).toHaveLength(1);
        expect(sent[0]?.senderThreadId).toBe(owner);
        expect(sent[0]?.attachments[0]?.id).toMatch(/^target-thread-/);
        expect((yield* launch(owner)).at(-1)?.result).toMatchObject({ projectId });
        expect(launched).toHaveLength(1);
        expect(launched[0]?.initialMessage?.senderThreadId).toBe(owner);
        expect((yield* discard(owner)).at(-1)?.result).toEqual({});
      }).pipe(Effect.provide(dependencies));
    }),
);
