import type { PullRequestDiffResult } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { mergeDiffPage, pullRequestDiffPageModel } from "./usePullRequestDiffPages";

const patch = (name: string, value = "new") =>
  `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ -1 +1 @@\n-old\n+${value}\n`;
const page = (name: string, nextCursor: string | null = null): PullRequestDiffResult => ({
  patch: patch(name),
  nextCursor,
  truncated: false,
});

describe("pull request diff pages", () => {
  it("retains cached parses across Code tab mounts without rehashing or parsing", () => {
    const data = {
      ...page("first.ts"),
      patch: Array.from({ length: 100 }, (_, index) => patch(`file-${index}.ts`)).join(""),
    };
    const first = pullRequestDiffPageModel(data);
    expect(first.files).toHaveLength(100);
    expect(pullRequestDiffPageModel(data)).toBe(first);
    expect(first.files[0]?.file).toMatchObject({ path: "file-0.ts", additions: 1, deletions: 1 });
  });
  it("preserves all loaded pages and models for an equal first-page refresh", () => {
    const first = { cursor: null, data: page("first.ts", "next") };
    const second = { cursor: "next", data: page("second.ts") };
    const pages = [first, second];
    expect(mergeDiffPage(pages, { ...first, data: { ...first.data } })).toBe(pages);
  });
  it("discards subsequent pages when the earlier revision or cursor changes", () => {
    const first = { cursor: null, data: page("first.ts", "next") };
    const pages = [first, { cursor: "next", data: page("second.ts") }];
    const changed = {
      cursor: null,
      data: { ...first.data, patch: patch("first.ts", "changed"), nextCursor: "new-next" },
    };
    expect(mergeDiffPage(pages, changed)).toEqual([changed]);
    expect(mergeDiffPage([changed], { cursor: "new-next", data: page("third.ts") })).toHaveLength(
      2,
    );
  });
  it("keeps host counts for files without hunks", () => {
    const data = {
      patch: "",
      nextCursor: null,
      truncated: true,
      omittedFileStats: [{ path: "binary.png", additions: 12, deletions: 2 }],
    };
    expect(pullRequestDiffPageModel(data).files[0]?.file).toMatchObject({
      path: "binary.png",
      additions: 12,
      deletions: 2,
    });
  });
});
