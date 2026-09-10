import { describe, expect, it } from "vite-plus/test";
import { getReviewFileStageActions } from "./reviewFileStageActions";

describe("review file staging actions", () => {
  const file = { path: "src/app.ts" };
  it("offers Stage only for an unstaged file", () => {
    expect(getReviewFileStageActions(file, "working-tree", [], [file])).toEqual([
      { label: "Stage", staged: true, files: [file] },
    ]);
  });
  it("offers Unstage after the file is fully staged", () => {
    expect(getReviewFileStageActions(file, "working-tree", [file], [])).toEqual([
      { label: "Unstage", staged: false, files: [file] },
    ]);
  });
  it("offers both actions for a partially staged file", () => {
    expect(
      getReviewFileStageActions(file, "working-tree", [file], [file]).map((action) => action.label),
    ).toEqual(["Stage", "Unstage"]);
  });
  it("uses each snapshot's paths when a rename is partially staged", () => {
    const combined = { oldPath: "original.ts", path: "final.ts" };
    const staged = { oldPath: "original.ts", path: "intermediate.ts" };
    const unstaged = { oldPath: "intermediate.ts", path: "final.ts" };
    expect(getReviewFileStageActions(combined, "working-tree", [staged], [unstaged])).toEqual([
      { label: "Stage", staged: true, files: [unstaged] },
      { label: "Unstage", staged: false, files: [staged] },
    ]);
  });
  it("does not invent an action while staging metadata is unavailable", () => {
    expect(getReviewFileStageActions(file, "working-tree", undefined, [])).toEqual([]);
    expect(getReviewFileStageActions(file, "working-tree", [], undefined)).toEqual([]);
  });
  it("does not include another copy of the same source file", () => {
    const copy = { path: "copy.ts", oldPath: "original.ts", status: "copied" };
    const sibling = { path: "other-copy.ts", oldPath: "original.ts", status: "copied" };
    expect(getReviewFileStageActions(copy, "working-tree", [copy, sibling], [])).toEqual([
      { label: "Unstage", staged: false, files: [{ path: copy.path }] },
    ]);
    expect(getReviewFileStageActions({ path: "original.ts" }, "working-tree", [copy], [])).toEqual(
      [],
    );
  });
  it("does not stage a copied file's original", () => {
    const copy = { path: "copy.ts", oldPath: "original.ts", status: "copied" };
    expect(getReviewFileStageActions(copy, "unstaged", undefined, undefined)).toEqual([
      { label: "Stage", staged: true, files: [{ path: copy.path }] },
    ]);
  });
  it("keeps dedicated scopes focused on their own changes", () => {
    expect(getReviewFileStageActions(file, "unstaged", [file], [file])).toEqual([
      { label: "Stage", staged: true, files: [file] },
    ]);
    expect(getReviewFileStageActions(file, "staged", [file], [file])).toEqual([
      { label: "Unstage", staged: false, files: [file] },
    ]);
  });
});
