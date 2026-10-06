import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { TextGenerationError, type ChatAttachment, type ModelSelection } from "@t3tools/contracts";
import { formatGeneratedBranchName, sanitizeFeatureBranchName } from "@t3tools/shared/git";
import { extractJsonObject } from "@t3tools/shared/schemaJson";

import * as ServerConfig from "../config.ts";
import { resolveAttachmentPath } from "../attachmentStore.ts";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildPrContentPrompt,
  buildThreadTitlePrompt,
} from "./TextGenerationPrompts.ts";
import * as TextGeneration from "./TextGeneration.ts";
import {
  sanitizeCommitSubject,
  sanitizePrTitle,
  sanitizeThreadTitle,
} from "./TextGenerationUtils.ts";
import * as NodeURL from "node:url";
import * as Deferred from "effect/Deferred";
import * as Stream from "effect/Stream";
import { openCode2Model } from "../provider/opencode2/OpenCode2Adapter.ts";
import { type OpenCode2Runtime, runOpenCode2 } from "../provider/opencode2/OpenCode2Runtime.ts";

type Operation =
  | "generateCommitMessage"
  | "generatePrContent"
  | "generateBranchName"
  | "generateThreadTitle";

const isTextGenerationError = Schema.is(TextGenerationError);

/** Temporary sessions support free models, which cannot use generate.text. */
export const makeOpenCodeTextGeneration = Effect.fn("makeOpenCodeTextGeneration")(function* (
  runtime: OpenCode2Runtime,
) {
  const { attachmentsDir } = yield* ServerConfig.ServerConfig;
  const runOpenCodeJson = <S extends Schema.Top>(input: {
    readonly operation: Operation;
    readonly cwd: string;
    readonly prompt: string;
    readonly outputSchemaJson: S;
    readonly modelSelection: ModelSelection;
    readonly attachments?: ReadonlyArray<ChatAttachment> | undefined;
  }) =>
    Effect.gen(function* () {
      const model = openCode2Model(input.modelSelection);
      if (!model)
        return yield* new TextGenerationError({
          operation: input.operation,
          detail: "OpenCode models use provider/model identifiers.",
        });
      const { client, subscribe } = yield* runtime.acquire;
      const stream = yield* subscribe;
      const session = yield* runOpenCode2("session.create", (signal) =>
        client.session.create(
          {
            title: `Test Rig ${input.operation}`,
            location: { directory: input.cwd },
            model,
            permissions: [{ action: "*", resource: "*", effect: "ask" }],
          },
          { signal },
        ),
      );
      // Both interruption and deletion apply only to this task's temporary session.
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          yield* runOpenCode2("session.interrupt", (signal) =>
            client.session.interrupt({ sessionID: session.id }, { signal }),
          ).pipe(Effect.timeout("5 seconds"), Effect.ignore);
          yield* runOpenCode2("session.remove", (signal) =>
            client.session.remove({ sessionID: session.id }, { signal }),
          ).pipe(Effect.timeout("5 seconds"), Effect.ignore);
        }),
      );
      const outcome = yield* Deferred.make<string, TextGenerationError>();
      const texts = new Map<string, string>();
      const fail = (detail: string, cause?: unknown) =>
        Deferred.fail(
          outcome,
          new TextGenerationError({
            operation: input.operation,
            detail,
            ...(cause === undefined ? {} : { cause }),
          }),
        );
      yield* stream.pipe(
        Stream.runForEach((event) => {
          if (
            !("data" in event) ||
            !("sessionID" in event.data) ||
            event.data.sessionID !== session.id
          )
            return Effect.void;
          switch (event.type) {
            case "session.text.ended":
              texts.set(`${event.data.assistantMessageID}:${event.data.ordinal}`, event.data.text);
              return Effect.void;
            case "permission.asked":
              return runOpenCode2("permission.reply", (signal) =>
                client.permission.reply(
                  {
                    sessionID: session.id,
                    requestID: event.data.id,
                    decision: "reject",
                    message:
                      "Tools are unavailable for text generation. Return the requested JSON directly.",
                  },
                  { signal },
                ),
              ).pipe(Effect.ignore);
            case "session.execution.succeeded":
              return Deferred.succeed(outcome, [...texts.values()].join("\n").trim());
            case "session.execution.failed":
              return fail("OpenCode could not generate the text.", event.data.error);
            case "session.execution.interrupted":
              return fail("OpenCode stopped the generation.");
            default:
              return Effect.void;
          }
        }),
        Effect.exit,
        Effect.flatMap((exit) => fail("The OpenCode event stream was lost.", exit)),
        Effect.forkScoped,
      );
      const files = (input.attachments ?? []).flatMap((attachment) => {
        const path = resolveAttachmentPath({ attachmentsDir, attachment });
        return path ? [{ uri: NodeURL.pathToFileURL(path).href, name: attachment.name }] : [];
      });
      yield* runOpenCode2("session.prompt", (signal) =>
        client.session.prompt({ sessionID: session.id, text: input.prompt, files }, { signal }),
      );
      const raw = yield* Deferred.await(outcome);
      if (!raw)
        return yield* new TextGenerationError({
          operation: input.operation,
          detail: "OpenCode returned empty output.",
        });
      // The output schema varies with the requested generation operation.
      // eslint-disable-next-line t3code/no-inline-schema-compile
      return yield* Schema.decodeEffect(Schema.fromJsonString(input.outputSchemaJson))(
        extractJsonObject(raw),
      );
    }).pipe(
      Effect.timeout("3 minutes"),
      Effect.scoped,
      Effect.mapError((cause) =>
        isTextGenerationError(cause)
          ? cause
          : new TextGenerationError({
              operation: input.operation,
              detail: "OpenCode text generation failed.",
              cause,
            }),
      ),
    );

  const generateCommitMessage: TextGeneration.TextGeneration["Service"]["generateCommitMessage"] =
    Effect.fn("OpenCodeTextGeneration.generateCommitMessage")(function* (input) {
      const { prompt, outputSchema } = buildCommitMessagePrompt({
        branch: input.branch,
        stagedSummary: input.stagedSummary,
        stagedPatch: input.stagedPatch,
        includeBranch: input.includeBranch === true,
        policy: input.policy,
      });
      const generated = yield* runOpenCodeJson({
        operation: "generateCommitMessage",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });

      return {
        subject: sanitizeCommitSubject(generated.subject),
        body: generated.body.trim(),
        ...("branch" in generated && typeof generated.branch === "string"
          ? { branch: sanitizeFeatureBranchName(generated.branch) }
          : {}),
      };
    });

  const generatePrContent: TextGeneration.TextGeneration["Service"]["generatePrContent"] =
    Effect.fn("OpenCodeTextGeneration.generatePrContent")(function* (input) {
      const { prompt, outputSchema } = buildPrContentPrompt({
        baseBranch: input.baseBranch,
        headBranch: input.headBranch,
        commitSummary: input.commitSummary,
        diffSummary: input.diffSummary,
        diffPatch: input.diffPatch,
        policy: input.policy,
        changeRequestTemplate: input.changeRequestTemplate,
      });
      const generated = yield* runOpenCodeJson({
        operation: "generatePrContent",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });

      return {
        title: sanitizePrTitle(generated.title),
        body: generated.body.trim(),
      };
    });

  const generateBranchName: TextGeneration.TextGeneration["Service"]["generateBranchName"] =
    Effect.fn("OpenCodeTextGeneration.generateBranchName")(function* (input) {
      const { prompt, outputSchema } = buildBranchNamePrompt({
        naming: input.naming,
        message: input.message,
        attachments: input.attachments,
      });
      const generated = yield* runOpenCodeJson({
        operation: "generateBranchName",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
        attachments: input.attachments,
      });

      return {
        branch: formatGeneratedBranchName(generated.branch, input.naming),
      };
    });

  const generateThreadTitle: TextGeneration.TextGeneration["Service"]["generateThreadTitle"] =
    Effect.fn("OpenCodeTextGeneration.generateThreadTitle")(function* (input) {
      const { prompt, outputSchema } = buildThreadTitlePrompt({
        message: input.message,
        previousTitle: input.previousTitle,
        attachments: input.attachments,
      });
      const generated = yield* runOpenCodeJson({
        operation: "generateThreadTitle",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
        attachments: input.attachments,
      });

      return {
        title: sanitizeThreadTitle(generated.title),
      };
    });

  return {
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
    generateThreadTitle,
  } satisfies TextGeneration.TextGeneration["Service"];
});
