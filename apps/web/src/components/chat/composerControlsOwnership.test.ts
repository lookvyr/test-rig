import { describe, expect, it } from "vite-plus/test";

import { resolveComposerControlsOwnership } from "./composerControlsOwnership";

describe("resolveComposerControlsOwnership", () => {
  it("hides the chip at the default, leaving Permissions to the model picker", () => {
    expect(resolveComposerControlsOwnership({ matchesDefault: true, collapsed: false })).toEqual({
      accessDisplay: "hidden",
      showModeBlock: false,
    });
    expect(resolveComposerControlsOwnership({ matchesDefault: true, collapsed: true })).toEqual({
      accessDisplay: "hidden",
      showModeBlock: false,
    });
  });

  it("shows a labelled chip when the mode differs", () => {
    expect(resolveComposerControlsOwnership({ matchesDefault: false, collapsed: false })).toEqual({
      accessDisplay: "label",
      showModeBlock: true,
    });
  });

  it("shows the non-default chip as an icon in the narrow footer", () => {
    expect(resolveComposerControlsOwnership({ matchesDefault: false, collapsed: true })).toEqual({
      accessDisplay: "icon",
      showModeBlock: true,
    });
  });
});
