import { FileTree } from "@pierre/trees";
import { describe, expect, it, vi } from "vite-plus/test";

import { areAllDirectoriesExpanded, setAllDirectoriesExpanded } from "./fileTreeExpansion";

const directories = ["src/", "src/nested/", "test/"];
function makeModel() {
  return new FileTree({
    paths: [...directories, "src/nested/file.ts", "test/example.ts"],
    initialExpansion: "closed",
    flattenEmptyDirectories: false,
  });
}

describe("file tree expansion", () => {
  it("expands and collapses nested directories without changing the selected file", () => {
    const model = makeModel();
    model.getItem("src/nested/file.ts")?.select();
    expect(areAllDirectoriesExpanded(model, directories)).toBe(false);
    setAllDirectoriesExpanded(model, directories, true);
    expect(areAllDirectoriesExpanded(model, directories)).toBe(true);
    setAllDirectoriesExpanded(model, directories, false);
    expect(areAllDirectoriesExpanded(model, directories)).toBe(false);
    expect(model.getSelectedPaths()).toEqual(["src/nested/file.ts"]);
    setAllDirectoriesExpanded(model, directories, true);
    expect(areAllDirectoriesExpanded(model, directories)).toBe(true);
    model.cleanUp();
  });

  it("skips directories already at the requested state", () => {
    const model = makeModel();
    setAllDirectoriesExpanded(model, directories, true);
    const changed = vi.fn();
    const unsubscribe = model.subscribe(changed);
    setAllDirectoriesExpanded(model, directories, true);
    expect(changed).not.toHaveBeenCalled();
    unsubscribe();
    model.cleanUp();
  });

  it("handles empty, missing, and file paths", () => {
    const model = makeModel();
    expect(areAllDirectoriesExpanded(model, [])).toBe(false);
    expect(areAllDirectoriesExpanded(model, ["missing/"])).toBe(false);
    expect(areAllDirectoriesExpanded(model, ["test/example.ts"])).toBe(false);
    expect(() =>
      setAllDirectoriesExpanded(model, ["missing/", "test/example.ts"], true),
    ).not.toThrow();
    model.cleanUp();
  });
});
