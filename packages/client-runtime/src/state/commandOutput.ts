import type { OrchestrationV2CommandOutputFrame } from "@t3tools/contracts";

/** One command row's output as a client holds it. */
export interface CommandOutputView {
  readonly output: { readonly text: string; readonly truncated: boolean };
  /** False once the command settled and `output` is final. */
  readonly running: boolean;
}

export const EMPTY_COMMAND_OUTPUT: CommandOutputView = {
  output: { text: "", truncated: false },
  running: true,
};

/**
 * Each frame is the complete display tail. Retaining only the latest snapshot
 * bounds client memory and avoids reconstructing a terminal from trimmed text.
 */
export function applyCommandOutputFrame(
  _view: CommandOutputView,
  frame: OrchestrationV2CommandOutputFrame,
): CommandOutputView {
  return {
    output: { text: frame.text, truncated: frame.truncated },
    running: frame.running,
  };
}
