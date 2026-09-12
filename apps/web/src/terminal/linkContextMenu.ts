import type { LocalApi } from "@t3tools/contracts";

import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";

export async function copyTerminalLinkFromContextMenu(
  text: string,
  position: { x: number; y: number },
  contextMenu: LocalApi["contextMenu"],
): Promise<void> {
  const choice = await contextMenu.show([{ id: "copy-link", label: "Copy Link" }], position);
  if (choice === "copy-link") {
    await writeTextToClipboard(text, "terminal link");
  }
}
