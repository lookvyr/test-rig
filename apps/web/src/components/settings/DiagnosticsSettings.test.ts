import type { ServerProcessDiagnosticsEntry } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { formatProcessType } from "./DiagnosticsSettings";

describe("formatProcessType", () => {
  it("does not classify the retained Cursor editor as an agent harness", () => {
    const cursorEditor = {
      depth: 0,
      command: "/Applications/Cursor.app/Contents/MacOS/Cursor /tmp/project",
    } as ServerProcessDiagnosticsEntry;

    expect(formatProcessType(cursorEditor)).toBe("Process");
  });

  it.each(["codex", "claude", "opencode"])(
    "classifies retained %s harnesses as agents",
    (command) => {
      expect(formatProcessType({ depth: 0, command } as ServerProcessDiagnosticsEntry)).toBe(
        "Agent",
      );
    },
  );
});
