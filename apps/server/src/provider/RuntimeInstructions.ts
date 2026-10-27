const PULL_REQUEST_LINKING_INSTRUCTIONS = `<pull_request_linking>
When the test_rig MCP server exposes link_pull_request, register each PR you create or work on with the full PR URL immediately after creating a PR or starting work on it. For a stack, call it for every layer. CLI/API operations do not register PRs; linking twice is safe. Before finishing, call list_thread_pull_requests and link any PR missing from your work. Skip background references. Report linking failures. When asked to monitor or babysit, call watch_pull_request and end your turn: Test Rig wakes you for checks, comments, conflicts, approvals, and merge-readiness changes. Do not poll or run watchers. Before handback, call unwatch_pull_request so the thread returns to the inbox.
</pull_request_linking>`;

/**
 * Shared runtime context; omit model and effort when the harness manages them dynamically.
 * `modelName` is the display name users see in the model picker; `model` is the slug.
 */
export function buildRuntimeInstructions(runtime: {
  readonly harness: string;
  readonly model?: string | undefined;
  readonly modelName?: string | undefined;
  readonly reasoningEffort?: string | undefined;
}): string {
  const harness = toSingleLine(runtime.harness);
  const model = toSingleLine(runtime.model ?? "");
  const modelName = toSingleLine(runtime.modelName ?? "");
  const effort = toSingleLine(runtime.reasoningEffort ?? "");
  const modelLabel =
    modelName && modelName !== model ? `${modelName} (model slug: ${model})` : model;
  const modelInfo = model && model !== "auto" && model !== "default" ? `, as ${modelLabel}` : "";
  const effortInfo = effort ? ` with ${effort} reasoning effort` : "";
  return `<runtime_info>In case you're asked: you are running in Test Rig through the ${harness} harness${modelInfo}${effortInfo}. No need to mention this otherwise. You can embed images and videos in your response using Markdown with absolute file paths.</runtime_info>\n\n${PULL_REQUEST_LINKING_INSTRUCTIONS}`;
}

function toSingleLine(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}
