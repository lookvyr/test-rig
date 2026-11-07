import { describe, expect, it } from "vite-plus/test";

import {
  contextCompactionLabel,
  workEntryHiddenByToolCallVisibility,
  type WorkLogPresentationEntry,
} from "./presentation.ts";

describe("contextCompactionLabel", () => {
  it.each(["pending", "running", "waiting"] as const)(
    "shows an ongoing %s compaction without claiming success",
    (status) => {
      expect(contextCompactionLabel({ status })).toBe("Compacting context");
    },
  );

  it.each(["cancelled", "interrupted"] as const)(
    "shows a %s compaction as stopped even with token counts",
    (status) => {
      expect(
        contextCompactionLabel({ status, beforeTokenCount: 12000, afterTokenCount: 2000 }),
      ).toBe("Context compaction stopped");
    },
  );

  it("distinguishes failure from successful completion", () => {
    expect(contextCompactionLabel({ status: "failed" })).toBe("Context compaction failed");
    expect(contextCompactionLabel({ status: "completed" })).toBe("Context compacted");
    expect(
      contextCompactionLabel({
        status: "completed",
        beforeTokenCount: 12000,
        afterTokenCount: 2000,
      }),
    ).toBe("Context compacted 12K → 2K tokens");
  });
});

describe("tool call visibility", () => {
  const command: WorkLogPresentationEntry = {
    id: "command",
    createdAt: "2026-11-07T00:00:00Z",
    label: "Run tests",
    tone: "tool",
    itemType: "command_execution",
    toolLifecycleStatus: "completed",
  };
  it("hides completed successful calls and preserves running calls until completion", () => {
    expect(workEntryHiddenByToolCallVisibility(command, "showAll")).toBe(false);
    expect(workEntryHiddenByToolCallVisibility(command, "hideSuccessful")).toBe(true);
    expect(
      workEntryHiddenByToolCallVisibility(
        { ...command, toolLifecycleStatus: "inProgress" },
        "hideSuccessful",
      ),
    ).toBe(false);
    expect(
      workEntryHiddenByToolCallVisibility(
        { ...command, toolLifecycleStatus: "inProgress" },
        "hideAll",
      ),
    ).toBe(true);
  });
  it.each(["hideSuccessful", "hideAll"] as const)(
    "keeps errors and interaction items in %s",
    (visibility) => {
      expect(
        workEntryHiddenByToolCallVisibility(
          { ...command, toolLifecycleStatus: "failed" },
          visibility,
        ),
      ).toBe(false);
      expect(workEntryHiddenByToolCallVisibility({ ...command, tone: "error" }, visibility)).toBe(
        false,
      );
      for (const itemType of [
        "approval_request",
        "user_input_request",
        "secret_request",
        "subagent",
      ] as const) {
        expect(workEntryHiddenByToolCallVisibility({ ...command, itemType }, visibility)).toBe(
          false,
        );
      }
    },
  );
});
