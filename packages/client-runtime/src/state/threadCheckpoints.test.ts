import { describe, expect, it } from "vite-plus/test";
import { checkpointFileTotals } from "./threadCheckpoints.ts";

describe("checkpointFileTotals", () => {
  it("uses aggregate totals for capped records", () => {
    expect(
      checkpointFileTotals({
        files: [],
        filesTotal: { count: 250, additions: 500, deletions: 250 },
      }),
    ).toEqual({ count: 250, additions: 500, deletions: 250 });
  });
  it("derives totals for historical records", () => {
    expect(
      checkpointFileTotals({
        files: [{ path: "a", kind: "modified", additions: 2, deletions: 3 }],
      }),
    ).toEqual({ count: 1, additions: 2, deletions: 3 });
  });
});
