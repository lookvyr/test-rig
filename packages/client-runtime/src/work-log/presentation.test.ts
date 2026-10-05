import { describe, expect, it } from "vite-plus/test";

import { contextCompactionLabel } from "./presentation.ts";

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
