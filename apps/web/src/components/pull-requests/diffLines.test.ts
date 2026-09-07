import { describe, expect, it } from "vite-plus/test";
import { parsePullRequestPatch } from "./diffLines";

describe("pull request diff coordinates", () => {
  it("keeps additions, deletions, and context anchored across separate hunks", () => {
    const lines = parsePullRequestPatch(
      "@@ -3,2 +3,2 @@\n-old\n+new\n same\n@@ -20 +40 @@\n+later",
    );
    expect(lines.map(({ oldLine, newLine }) => [oldLine, newLine])).toEqual([
      [null, null],
      [3, null],
      [null, 3],
      [4, 4],
      [null, null],
      [null, 40],
    ]);
  });
  it("does not offer annotations for headers or missing-newline markers", () => {
    const lines = parsePullRequestPatch(
      "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new",
    );
    expect(lines.filter((line) => line.oldLine !== null || line.newLine !== null)).toHaveLength(2);
  });
});
