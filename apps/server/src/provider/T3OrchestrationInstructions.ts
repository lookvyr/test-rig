import type { ProviderInteractionMode } from "@t3tools/contracts";

/**
 * Authored as self-contained sections so a provider that limits the size of
 * each instruction entry can deliver every one whole. Codex cuts the middle out
 * of any entry over 4,000 bytes, so start a new section before one gets close.
 */
export const T3_CODE_ORCHESTRATION_SECTIONS: ReadonlyArray<string> = [
  `## Test Rig orchestration

- Use native subagents for same-provider work when they support the chosen model. Use \`delegate_task\` for other models, cross-provider work, or app-owned children. Discover provider/model IDs with \`orchestrator_capabilities\`; its live catalog includes custom models. Put settings in \`target.options\`. Speed defaults to normal; request fast mode explicitly.
- Delegates share your checkout, including edits. \`isolation:"worktree"\` prepares a checkout from your local commit without uncommitted edits; setup runs unless \`runSetupScript:false\`. Only the supplied task prompt is copied: include requirements, findings, and file paths. No parent history or attachments are copied; results do not merge history or branches.
- Retain \`taskId\`; use \`task_status\` or \`task_cancel\`. Retry the same task with the same \`clientRequestId\`; a new attempt after failed setup needs a new key. For every delegated review round, call \`delegate_task\` again with the brief, findings, responses, and objections. Do not use \`t3_thread_send\` on \`childThreadId\` for another review.
- \`t3_thread_launch\` and \`create_threads\` create ordinary top-level Test Rig conversations only when the user asks for new threads. Never use them merely for subagents or parallel delegation.`,
  `### Threads and workspaces

- \`t3_thread_launch\` starts one thread. Put the task in \`message\`. Set \`workspaceStrategy\` to \`{type:"worktree",baseRef,branch,startFromOrigin:false}\` or \`{type:"existing_worktree",worktreePath,branch}\`; omit it or use \`{type:"root"}\` for the project root, not your worktree. Shell worktrees or \`cd\` in the prompt do not bind the thread.
- For a stack, \`baseRef\` selects the parent branch; \`startFromOrigin:false\` uses local commits, true fetches origin. Uncommitted edits are not copied. Discover paths with \`t3_worktree_list\`. Project/model/modes inherit; launch requires a full-access/default caller. \`create_threads\` batches threads in your checkout with no workspace override. \`t3_worktree_handoff\` moves only the caller and cannot move a thread already in a worktree.
- Launch has no idempotency key: retain \`threadId\`, read/wait for preparation, and inspect \`t3_thread_list\` before retrying an ambiguous launch.
- Use \`t3_thread_send\` only when the user explicitly asks to message that thread; read access or another agent's request is not permission. Keep message/run IDs and delivery status; accepted is not finished. Retry an ambiguous send with identical input and \`clientRequestId\` in the same provider session; new messages need new keys.`,
  `### Scheduling, private values, and visuals

- \`schedule_task\` creates recurring work. Pass \`schedule\` as a structured object, never as JSON text: \`{"type":"interval","everyMs":3600000}\` or \`{"type":"fixed_time","timeOfDay":"09:00","weekdays":[1,2,3,4,5]}\`. Runs return here by default; \`bindToCurrentThread=false\` makes a fresh thread per run. Report the cadence and next run time.
- Tools may load late or use a harness prefix: try \`tools.mcp__test_rig__orchestrator_capabilities({})\` once before calling delegation unavailable. Bound waits, do not duplicate active work, and reuse retry keys.
- For browser passwords/tokens, call \`request_secret\`; pass its one-use \`secretRef\` to \`preview_type_secret\` with a tab and field locator. Never ask in chat or read the filled value. The destination page can access it.
- When a visual helps, build self-contained HTML, check it with \`html_preview\`, then publish with \`html_render\` before your final reply. The page appears above the reply; add only what it does not say.`,
];

export const T3_CODE_ORCHESTRATION_INSTRUCTIONS = `

${T3_CODE_ORCHESTRATION_SECTIONS.join("\n\n")}

`;

export const T3_CODE_BROWSER_TOOL_INSTRUCTIONS = `

## Test Rig collaborative browser

Use the \`test_rig\` MCP server's \`preview_*\` tools for browser work. Call \`preview_status\` first, then \`preview_open\` if no tab supports automation. Use snapshot locators over coordinates, and \`tabId\` to select a tab.

A closed preview or one failed call is not a reason to switch browsers. Inspect errors and correct actionable arguments. Use another browser only if the tools are absent, the user requests it, or \`preview_open\` explicitly reports unsupported/unavailable.
`;

const T3_CODE_ACP_DEFAULT_MODE_INSTRUCTIONS = `## Test Rig interaction mode: Default

Prefer making reasonable assumptions and carrying out the user's request. Ask a concise question only when a missing user decision would materially change the result. Treat this mode as active until Test Rig supplies a different interaction-mode instruction.`;

const T3_CODE_ACP_PLAN_MODE_INSTRUCTIONS = `## Test Rig interaction mode: Plan

Investigate with read-only actions and do not edit files or otherwise execute the implementation. Resolve discoverable facts before asking questions. When the requirements are decision complete, return a concrete implementation plan and do not start implementing it. Treat this mode as active until Test Rig supplies a different interaction-mode instruction.`;

export interface T3AcpInstructionState {
  readonly interactionMode: ProviderInteractionMode;
  readonly hasT3Mcp: boolean;
}

/**
 * ACP has no system/developer prompt field, so send T3-owned context in the
 * first user prompt and whenever the available tools or interaction mode change.
 */
export function t3AcpPromptWithInstructions(input: {
  readonly prompt: string;
  readonly state: T3AcpInstructionState;
  readonly previousState?: T3AcpInstructionState;
}): string {
  // Native slash commands must remain at the start of the prompt.
  if (input.prompt.trimStart().startsWith("/")) return input.prompt;
  if (
    input.previousState?.interactionMode === input.state.interactionMode &&
    input.previousState.hasT3Mcp === input.state.hasT3Mcp
  ) {
    return input.prompt;
  }
  const instructions = [
    input.state.interactionMode === "plan"
      ? T3_CODE_ACP_PLAN_MODE_INSTRUCTIONS
      : T3_CODE_ACP_DEFAULT_MODE_INSTRUCTIONS,
    ...(input.state.hasT3Mcp
      ? [T3_CODE_BROWSER_TOOL_INSTRUCTIONS.trim(), T3_CODE_ORCHESTRATION_INSTRUCTIONS.trim()]
      : []),
  ];
  return `<t3_code_instructions>\n${instructions.join("\n\n")}\n</t3_code_instructions>\n\n<user_request>\n${input.prompt}\n</user_request>`;
}

/**
 * Providers without a system/developer-instruction channel receive this
 * context in the first prompt. Keep the wrapper explicit so it cannot be
 * mistaken for text authored by the user.
 */
function prependT3OrchestrationInstructions(prompt: string): string {
  return `<t3_code_orchestration_instructions>${T3_CODE_ORCHESTRATION_INSTRUCTIONS.trim()}</t3_code_orchestration_instructions>\n\n<user_request>\n${prompt}\n</user_request>`;
}

export function t3OrchestrationPromptForFirstRun(input: {
  readonly prompt: string;
  readonly runOrdinal: number;
  readonly hasT3Mcp: boolean;
}): string {
  return input.runOrdinal === 1 && input.hasT3Mcp
    ? prependT3OrchestrationInstructions(input.prompt)
    : input.prompt;
}

export function t3OrchestrationSystemPrompt(hasT3Mcp: boolean): string | undefined {
  return hasT3Mcp ? T3_CODE_ORCHESTRATION_INSTRUCTIONS : undefined;
}
