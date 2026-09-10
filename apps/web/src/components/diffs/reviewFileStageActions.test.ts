import { describe, expect, it } from "vite-plus/test";
import { getReviewBulkStageActions, getReviewFileStageActions } from "./reviewFileStageActions";

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

describe("review bulk staging actions", () => {
  const staged = { path: "staged.ts" };
  const unstaged = { path: "unstaged.ts" };
  it("shows Stage all with no dropdown when nothing is staged", () => {
    expect(getReviewBulkStageActions("working-tree", [], [], [unstaged])).toEqual([
      { label: "Stage all", staged: true, files: [unstaged] },
    ]);
  });
  it("shows Unstage all with no dropdown when everything is staged", () => {
    expect(getReviewBulkStageActions("working-tree", [], [staged], [])).toEqual([
      { label: "Unstage all", staged: false, files: [staged] },
    ]);
  });
  it("offers Stage remaining and Unstage all for mixed changes using their own manifests", () => {
    expect(getReviewBulkStageActions("working-tree", [staged], [staged], [unstaged])).toEqual([
      { label: "Stage remaining", staged: true, files: [unstaged] },
      { label: "Unstage all", staged: false, files: [staged] },
    ]);
  });
  it("treats one partially staged file as a mixed state", () => {
    expect(
      getReviewBulkStageActions("working-tree", [staged], [staged], [staged]).map(
        (action) => action.label,
      ),
    ).toEqual(["Stage remaining", "Unstage all"]);
  });
  it("does not offer actions for an empty or unknown state", () => {
    expect(getReviewBulkStageActions("working-tree", [], [], [])).toEqual([]);
    expect(getReviewBulkStageActions("working-tree", [staged], [staged], undefined)).toEqual([]);
    expect(getReviewBulkStageActions("working-tree", [unstaged], undefined, [unstaged])).toEqual(
      [],
    );
  });
  it("keeps the dedicated tabs focused on their scope", () => {
    expect(getReviewBulkStageActions("unstaged", [unstaged], [staged], undefined)).toEqual([
      { label: "Stage all", staged: true, files: [unstaged] },
    ]);
    expect(getReviewBulkStageActions("staged", [staged], [staged], undefined)).toEqual([
      { label: "Unstage all", staged: false, files: [staged] },
    ]);
  });
});
