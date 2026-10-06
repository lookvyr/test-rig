import type {
  EnvironmentId,
  OrchestrationMessageContext,
  ProviderDriverKind,
  ServerProvider,
  ThreadContextRecord,
} from "@t3tools/contracts";
import { collectComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import { upgradeLegacyContextMessage } from "@t3tools/shared/composerContextLegacy";
import { applyClaudePromptEffortPrefix, resolvePromptInjectedEffort } from "@t3tools/shared/model";
import { getProviderModelCapabilities } from "../../providerModels";
import { appendTerminalContextsToPrompt } from "../../lib/terminalContext";
import { appendElementContextsToPrompt } from "../../lib/elementContext";
import { appendPreviewAnnotationPrompt } from "../../lib/previewAnnotation";
import { appendReviewCommentsToPrompt } from "../../reviewCommentContext";
import type { ChatComposerHandle } from "./ChatComposer";

/** Resolve only attached links; keep the retained composer's other context chips intact. */
export function prepareComposerMessage(
  text: string,
  threadContexts: ReadonlyArray<ThreadContextRecord>,
  environmentId: EnvironmentId,
): { text: string; context?: OrchestrationMessageContext; error?: string } {
  const ids = new Set(
    collectComposerContextReferences(text)
      .filter((ref) => ref.kind === "thread")
      .map((ref) => ref.contextId),
  );
  const records = threadContexts.filter((record) => ids.has(record.contextId));
  if (records.some((record) => record.environmentId !== environmentId)) {
    return { text, error: "Use thread references from this environment." };
  }
  if (records.length === 0) return { text };
  const legacy = upgradeLegacyContextMessage(text);
  return { text: legacy.text, context: { version: 1, records: [...legacy.records, ...records] } };
}

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
