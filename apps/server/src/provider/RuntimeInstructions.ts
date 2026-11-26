import type { ProviderAdapterV2RuntimePolicy } from "../orchestration-v2/ProviderAdapter.ts";

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
  /** Adds the folder list of a multi-folder thread. */
  readonly runtimePolicy?: Pick<ProviderAdapterV2RuntimePolicy, "cwd" | "workspace"> | undefined;
}): string {
  const harness = toSingleLine(runtime.harness);
  const model = toSingleLine(runtime.model ?? "");
  const modelName = toSingleLine(runtime.modelName ?? "");
  const effort = toSingleLine(runtime.reasoningEffort ?? "");
  const modelLabel =
    modelName && modelName !== model ? `${modelName} (model slug: ${model})` : model;
  const modelInfo = model && model !== "auto" && model !== "default" ? `, as ${modelLabel}` : "";
  const effortInfo = effort ? ` with ${effort} reasoning effort` : "";
  const workspace =
    runtime.runtimePolicy === undefined ? "" : buildWorkspaceInstructions(runtime.runtimePolicy);
  return [
    `<runtime_info>In case you're asked: you are running in Test Rig through the ${harness} harness${modelInfo}${effortInfo}. No need to mention this otherwise. You can embed images and videos in your response using Markdown with absolute file paths.</runtime_info>`,
    PULL_REQUEST_LINKING_INSTRUCTIONS,
    ...(workspace === "" ? [] : [workspace]),
  ].join("\n\n");
}

// Codex truncates context entries over 4,000 bytes, and this block can be sent as its own entry.
const WORKSPACE_INSTRUCTIONS_MAX_BYTES = 3_600;
const FOLDER_NAME_MAX_LENGTH = 64;
// Control characters and Unicode line separators would let a name or path add lines.
const LINE_BREAKING = /[\p{Cc}\p{Zl}\p{Zp}]/gu;
const textEncoder = new TextEncoder();

const byteLength = (value: string) => textEncoder.encode(value).length;

/** Names come from users and disk; keep each one a short label that cannot close the block. */
function folderLabel(name: string): string {
  const label = Array.from(
    name.replaceAll(LINE_BREAKING, " ").replaceAll(/[<>`]/g, " ").replaceAll(/\s+/g, " ").trim(),
  );
  if (label.length === 0) return "folder";
  return label.length > FOLDER_NAME_MAX_LENGTH
    ? `${label.slice(0, FOLDER_NAME_MAX_LENGTH - 1).join("")}…`
    : label.join("");
}

const folderPath = (value: string) =>
  value.replaceAll(LINE_BREAKING, "?").replaceAll("<", "‹").replaceAll(">", "›");

/** Lists a multi-folder thread's folders. Empty for single-folder threads, so their text is unchanged. */
export function buildWorkspaceInstructions(
  runtimePolicy: Pick<ProviderAdapterV2RuntimePolicy, "cwd" | "workspace">,
): string {
  const workspace = runtimePolicy.workspace;
  if (workspace === undefined || workspace.folders.length === 0) return "";
  const head = [
    "<workspace_folders>",
    "This project spans several folders. Each Git repository has its own history and branches: run Git commands inside the repository you change, and commit each one separately.",
    ...(runtimePolicy.cwd === null
      ? []
      : [`- Your working directory: ${folderPath(runtimePolicy.cwd)}`]),
  ];
  const tail = ["</workspace_folders>"];
  const entries = workspace.folders.map(
    (folder) =>
      `- ${folderLabel(folder.name)} (${folder.isGitRepository ? "Git repository" : "folder"}): ${folderPath(folder.path)}`,
  );
  // Reserve room for the line that counts folders left out.
  let budget = WORKSPACE_INSTRUCTIONS_MAX_BYTES - byteLength([...head, ...tail].join("\n")) - 32;
  const shown: Array<string> = [];
  for (const entry of entries) {
    budget -= byteLength(entry) + 1;
    if (budget < 0) break;
    shown.push(entry);
  }
  const hidden = entries.length - shown.length;
  return [...head, ...shown, ...(hidden > 0 ? [`- Not listed: ${hidden} more`] : []), ...tail].join(
    "\n",
  );
}

function toSingleLine(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}
