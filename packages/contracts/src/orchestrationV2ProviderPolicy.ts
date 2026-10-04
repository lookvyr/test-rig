import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import {
  ChatAttachment,
  ProviderApprovalDecision,
  ProviderUserInputAnswers,
} from "./orchestration.ts";
export {
  ProviderApprovalDecision,
  ProviderInteractionMode,
  ProviderRequestKind,
  ProviderUserInputAnswers,
  RuntimeMode,
} from "./orchestration.ts";
export const ProviderApprovalOption = Schema.Struct({
  decision: ProviderApprovalDecision,
  label: TrimmedNonEmptyString,
  warning: Schema.optional(TrimmedNonEmptyString),
});
export const UserInputAttachments = Schema.Record(Schema.String, Schema.Array(ChatAttachment));
export const UserInputAttachmentAnswerPayload = Schema.Struct({
  requestId: TrimmedNonEmptyString,
  questionTextById: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  answers: ProviderUserInputAnswers,
  attachmentsByQuestionId: UserInputAttachments,
});

export type ProviderApprovalOption = typeof ProviderApprovalOption.Type;
export type UserInputAttachments = typeof UserInputAttachments.Type;
