import type { ProviderDriverKind, ServerProvider } from "@t3tools/contracts";
import { applyClaudePromptEffortPrefix, resolvePromptInjectedEffort } from "@t3tools/shared/model";
import { getProviderModelCapabilities } from "../../providerModels";
import { appendTerminalContextsToPrompt } from "../../lib/terminalContext";
import { appendElementContextsToPrompt } from "../../lib/elementContext";
import { appendPreviewAnnotationPrompt } from "../../lib/previewAnnotation";
import { appendReviewCommentsToPrompt } from "../../reviewCommentContext";
import type { ChatComposerHandle } from "./ChatComposer";

export function serializeComposerPrompt(
  context: Pick<
    ReturnType<ChatComposerHandle["getSendContext"]>,
    "prompt" | "terminalContexts" | "elementContexts" | "previewAnnotations" | "reviewComments"
  >,
) {
  const text = appendElementContextsToPrompt(
    appendTerminalContextsToPrompt(context.prompt, context.terminalContexts),
    context.elementContexts,
  );
  return appendReviewCommentsToPrompt(
    context.previewAnnotations.reduce(
      (value, annotation) => appendPreviewAnnotationPrompt(value, annotation),
      text,
    ),
    context.reviewComments,
  );
}

export function formatOutgoingPrompt(params: {
  provider: ProviderDriverKind;
  model: string | null;
  models: ReadonlyArray<ServerProvider["models"][number]>;
  effort: string | null;
  text: string;
}): string {
  const caps = getProviderModelCapabilities(params.models, params.model, params.provider);
  const promptEffort = resolvePromptInjectedEffort(caps, params.effort);
  return applyClaudePromptEffortPrefix(params.text, promptEffort);
}
