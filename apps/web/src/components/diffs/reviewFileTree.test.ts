import { describe, expect, it } from "vite-plus/test";
import {
  buildReviewFileTree,
  flattenReviewFileTree,
  sortReviewFiles,
  resolveReviewFilePath,
  type ReviewFile,
} from "./reviewFileTree";

function file(path: string, oldPath?: string): ReviewFile {
  return { path, oldPath, status: "modified", additions: 2, deletions: 1 };
}

describe("review file navigation", () => {
  it("compacts nested directories and orders folders before files without losing entries", () => {
    const files = [
      file("z.txt"),
      file("src/components/Button.tsx"),
      file("src/components/App.tsx"),
      file("a.txt"),
    ];
    const tree = buildReviewFileTree(files);
    expect(tree.map((node) => node.name)).toEqual(["src/components", "a.txt", "z.txt"]);
    expect(tree[0]).toMatchObject({ kind: "directory", path: "src/components", fileCount: 2 });
    expect(
      flattenReviewFileTree(tree, new Set())
        .filter((row) => row.node.kind === "file")
        .map((row) => row.node.path),
    ).toEqual(["src/components/App.tsx", "src/components/Button.tsx", "a.txt", "z.txt"]);
    expect(files.map((entry) => entry.path)).toEqual([
      "z.txt",
      "src/components/Button.tsx",
      "src/components/App.tsx",
      "a.txt",
    ]);
    expect(sortReviewFiles(files).map((entry) => entry.path)).toEqual([
      "src/components/App.tsx",
      "src/components/Button.tsx",
      "a.txt",
      "z.txt",
    ]);
  });

  it("finds renamed files by either path, case insensitively", () => {
    const files = [file("src/NewName.ts", "lib/OldName.ts"), file("src/other.ts")];
    for (const query of [" oldname ", "NEWNAME"]) {
      const rows = flattenReviewFileTree(buildReviewFileTree(files, query), new Set());
      expect(rows.filter((row) => row.node.kind === "file").map((row) => row.node.path)).toEqual([
        "src/NewName.ts",
      ]);
    }
    expect(buildReviewFileTree(files, "missing")).toEqual([]);
  });

  it("hides only collapsed descendants and keeps parent metadata for keyboard navigation", () => {
    const tree = buildReviewFileTree([
      file("src/app.ts"),
      file("src/components/button.ts"),
      file("README.md"),
    ]);
    const rows = flattenReviewFileTree(tree, new Set(["src/components"]));
    expect(rows.map((row) => row.node.path)).toEqual([
      "src",
      "src/components",
      "src/app.ts",
      "README.md",
    ]);
    expect(rows[2]).toMatchObject({ depth: 1, parentPath: "src", position: 2, siblingCount: 2 });
    expect(flattenReviewFileTree(tree, new Set(["src"])).map((row) => row.node.path)).toEqual([
      "src",
      "README.md",
    ]);
  });

  it("keeps file and directory replacements independently addressable", () => {
    const rows = flattenReviewFileTree(
      buildReviewFileTree([file("src"), file("src/app.ts")]),
      new Set(),
    );
    expect(new Set(rows.map((row) => row.key)).size).toBe(3);
  });

  it("honors navigation until a new external turn reveal arrives", () => {
    const files = [file("a.ts"), file("b.ts"), file("c.ts")];
    const local = { scope: "turn:1", path: "b.ts", turnRevealRequestId: 1 };
    expect(resolveReviewFilePath(files, local, "turn:1", "a.ts", 1)).toBe("b.ts");
    expect(resolveReviewFilePath(files, local, "turn:1", "c.ts", 2)).toBe("c.ts");
    expect(resolveReviewFilePath(files, local, "turn:1", "a.ts", 2)).toBe("a.ts");
    expect(resolveReviewFilePath(files, local, "turn:2", "c.ts", 1)).toBe("c.ts");
  });

  it("falls back when selected files disappear or the next scope is empty", () => {
    const local = { scope: "unstaged", path: "gone.ts", turnRevealRequestId: 0 };
    const files = [file("a.ts"), file("b.ts")];
    expect(resolveReviewFilePath(files, local, "unstaged", "b.ts", 0)).toBe("b.ts");
    expect(resolveReviewFilePath(files, local, "unstaged", null, 0)).toBe("a.ts");
    expect(resolveReviewFilePath(files, local, "staged", null, 0)).toBe("a.ts");
    expect(resolveReviewFilePath([], local, "staged", null, 0)).toBeNull();
  });
});
