import { describe, expect, it } from "vite-plus/test";

import { EDITORS } from "./editor.ts";

describe("editor definitions", () => {
  it("keeps Cursor as an editor integration independent of executable providers", () => {
    expect(EDITORS.find((editor) => editor.id === "cursor")).toEqual({
      id: "cursor",
      label: "Cursor",
      commands: ["cursor"],
      launchStyle: "goto",
    });
  });
});
