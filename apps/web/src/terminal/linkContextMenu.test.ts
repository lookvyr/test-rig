import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { ClipboardWriteError } from "~/hooks/useCopyToClipboard";

import { copyTerminalLinkFromContextMenu } from "./linkContextMenu";

describe("copyTerminalLinkFromContextMenu", () => {
  afterEach(() => vi.unstubAllGlobals());

  function clipboard() {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    return writeText;
  }

  it("copies the full detected target without requiring a DOM selection", async () => {
    const writeText = clipboard();
    const show = vi.fn().mockResolvedValue("copy-link");
    const target = "https://example.com/a%20b?one=1&two=2#section";

    await copyTerminalLinkFromContextMenu(target, { x: 140, y: 230 }, { show });

    expect(show).toHaveBeenCalledWith([{ id: "copy-link", label: "Copy Link" }], {
      x: 140,
      y: 230,
    });
    expect(writeText).toHaveBeenCalledExactlyOnceWith(target);
  });

  it("leaves the clipboard untouched when the menu is dismissed", async () => {
    const writeText = clipboard();
    await copyTerminalLinkFromContextMenu(
      "https://example.com",
      { x: 0, y: 0 },
      { show: vi.fn().mockResolvedValue(null) },
    );
    expect(writeText).not.toHaveBeenCalled();
  });

  it("surfaces a rejected clipboard write to the terminal error handler", async () => {
    const writeText = clipboard();
    writeText.mockRejectedValue(new Error("Document is not focused"));

    await expect(
      copyTerminalLinkFromContextMenu(
        "https://example.com",
        { x: 0, y: 0 },
        { show: vi.fn().mockResolvedValue("copy-link") },
      ),
    ).rejects.toBeInstanceOf(ClipboardWriteError);
  });
});
