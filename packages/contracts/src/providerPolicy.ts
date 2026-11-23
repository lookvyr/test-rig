import {
  ChatImageAttachment,
  ChatFileAttachment,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
} from "./chatAttachment.ts";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const ProviderApprovalPolicy = Schema.Literals([
  "untrusted",
  "on-failure",
  "on-request",
  "never",
]);
export type ProviderApprovalPolicy = typeof ProviderApprovalPolicy.Type;

export const ProviderSandboxMode = Schema.Literals([
  "read-only",
  "workspace-write",
  "danger-full-access",
]);
export type ProviderSandboxMode = typeof ProviderSandboxMode.Type;

export const RuntimeMode = Schema.Literals([
  "approval-required",
  "auto-accept-edits",
  "auto",
  "full-access",
]);
export type RuntimeMode = typeof RuntimeMode.Type;
/** New threads, settings and scheduled tasks start in Auto. */
export const DEFAULT_RUNTIME_MODE: RuntimeMode = "auto";

/**
 * The modes new work may start in. The manual modes ("approval-required",
 * "auto-accept-edits") remain valid for threads already running in them.
 */
export const OFFERED_RUNTIME_MODES = [
  "auto",
  "full-access",
] as const satisfies ReadonlyArray<RuntimeMode>;
export const OfferedRuntimeMode = Schema.Literals(OFFERED_RUNTIME_MODES);
export type OfferedRuntimeMode = typeof OfferedRuntimeMode.Type;
export const isOfferedRuntimeMode = (mode: RuntimeMode): mode is OfferedRuntimeMode =>
  mode === "auto" || mode === "full-access";

/** A runtime-mode default: a saved manual mode is read as Auto. */
export const DefaultRuntimeModeSetting = RuntimeMode.pipe(
  Schema.decodeTo(
    RuntimeMode,
    SchemaTransformation.transform<RuntimeMode, RuntimeMode>({
      decode: (mode) => (isOfferedRuntimeMode(mode) ? mode : "auto"),
      encode: (mode) => mode,
    }),
  ),
);

export const ProviderInteractionMode = Schema.Literals(["default", "plan"]);
export type ProviderInteractionMode = typeof ProviderInteractionMode.Type;
export const DEFAULT_PROVIDER_INTERACTION_MODE: ProviderInteractionMode = "default";

export const ProviderRequestKind = Schema.Literals([
  "command",
  "file-read",
  "file-change",
  "mcp-elicitation",
  "permission",
]);
export type ProviderRequestKind = typeof ProviderRequestKind.Type;

export const AssistantDeliveryMode = Schema.Literals(["buffered", "streaming"]);
export type AssistantDeliveryMode = typeof AssistantDeliveryMode.Type;

export const ProviderApprovalDecision = Schema.Literals([
  "accept",
  "acceptForSession",
  "acceptAlways",
  "decline",
  "cancel",
]);
export type ProviderApprovalDecision = typeof ProviderApprovalDecision.Type;

export const ProviderApprovalOption = Schema.Struct({
  decision: ProviderApprovalDecision,
  label: TrimmedNonEmptyString,
  /** Provider-supplied caution shown next to the option, such as a prompt injection warning. */
  warning: Schema.optional(TrimmedNonEmptyString),
});
export type ProviderApprovalOption = typeof ProviderApprovalOption.Type;

export const ProviderUserInputAnswers = Schema.Record(Schema.String, Schema.Unknown);
export type ProviderUserInputAnswers = typeof ProviderUserInputAnswers.Type;

export const UserInputAttachments = Schema.Record(
  Schema.String,
  Schema.Array(Schema.Union([ChatImageAttachment, ChatFileAttachment])).pipe(
    Schema.check(Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_ATTACHMENTS)),
  ),
);
export type UserInputAttachments = typeof UserInputAttachments.Type;

export const UserInputAttachmentAnswerPayload = Schema.Struct({
  requestId: TrimmedNonEmptyString,
  questionTextById: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  answers: ProviderUserInputAnswers,
  attachmentsByQuestionId: UserInputAttachments,
});
export type UserInputAttachmentAnswerPayload = typeof UserInputAttachmentAnswerPayload.Type;
