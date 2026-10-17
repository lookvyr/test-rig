import { describe, expect, it } from "vite-plus/test";
import { appendTerminalOutput, EMPTY_TERMINAL_OUTPUT } from "@t3tools/shared/terminalOutput";

import { applyCommandOutputFrame, EMPTY_COMMAND_OUTPUT } from "./commandOutput.ts";

describe("applyCommandOutputFrame", () => {
  it.each([
    `\x1b[31m${"x".repeat(70_000)}`,
    Array.from({ length: 64 }, () => "x".repeat(2_000)).join("\n") + "\x1b[63A\rX",
  ])("displays truncated redraw snapshots exactly as the server produced them", (input) => {
    let source = appendTerminalOutput(EMPTY_TERMINAL_OUTPUT, input);
    let view = EMPTY_COMMAND_OUTPUT;
    for (const chunk of ["", "\rLAST", "\x1b[1A\rUP", "\x1b[1D!"]) {
      source = appendTerminalOutput(source, chunk);
      view = applyCommandOutputFrame(view, {
        kind: "replace",
        text: source.text,
        truncated: source.truncated,
        running: true,
      });
      expect(view.output).toEqual({ text: source.text, truncated: source.truncated });
      expect(view.output.text.length).toBeLessThanOrEqual(64 * 1024);
    }
  });

  it("starts over from the tail a reconnect sends, keeping only that", () => {
    const stale = applyCommandOutputFrame(EMPTY_COMMAND_OUTPUT, {
      kind: "replace",
      text: "line 1\n",
      truncated: false,
      running: true,
    });
    const resumed = applyCommandOutputFrame(stale, {
      kind: "replace",
      text: "line 7\nline 8\n",
      truncated: true,
      running: true,
    });
    expect(resumed.output.text).toBe("line 7\nline 8\n");
    expect(resumed.output.truncated).toBe(true);
  });

  it("marks the output final when the command settles", () => {
    const view = applyCommandOutputFrame(EMPTY_COMMAND_OUTPUT, {
      kind: "replace",
      text: "done\n",
      truncated: false,
      running: false,
    });
    expect(view.output.text).toBe("done\n");
    expect(view.output.truncated).toBe(false);
    expect(view.running).toBe(false);
  });
});
