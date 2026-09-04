import type { FileTree } from "@pierre/trees";

type FileTreeExpansionModel = Pick<FileTree, "getItem">;

function directoryHandle(model: FileTreeExpansionModel, path: string) {
  const item = model.getItem(path);
  return item && "expand" in item ? item : null;
}

export function areAllDirectoriesExpanded(
  model: FileTreeExpansionModel,
  directoryPaths: readonly string[],
): boolean {
  return (
    directoryPaths.length > 0 &&
    directoryPaths.every((path) => directoryHandle(model, path)?.isExpanded() === true)
  );
}

export function setAllDirectoriesExpanded(
  model: FileTreeExpansionModel,
  directoryPaths: readonly string[],
  expanded: boolean,
): void {
  for (const path of directoryPaths) {
    const item = directoryHandle(model, path);
    if (!item || item.isExpanded() === expanded) continue;
    if (expanded) item.expand();
    else item.collapse();
  }
}
