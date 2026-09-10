export interface ReviewFile {
  path: string;
  oldPath?: string | null | undefined;
  status: string;
  additions: number | null;
  deletions: number | null;
}

interface ReviewDirectory {
  kind: "directory";
  path: string;
  name: string;
  children: ReviewTreeNode[];
  fileCount: number;
}

export type ReviewTreeNode =
  | ReviewDirectory
  | { kind: "file"; path: string; name: string; file: ReviewFile };

export function buildReviewFileTree(files: readonly ReviewFile[], query = ""): ReviewTreeNode[] {
  const root: ReviewTreeNode[] = [];
  const directories = new Map<string, ReviewDirectory>();
  const filter = query.trim().toLowerCase();
  for (const file of files) {
    if (
      filter &&
      !file.path.toLowerCase().includes(filter) &&
      !file.oldPath?.toLowerCase().includes(filter)
    )
      continue;
    const parts = file.path.split("/");
    let children = root;
    let path = "";
    for (const name of parts.slice(0, -1)) {
      path = path ? `${path}/${name}` : name;
      let directory = directories.get(path);
      if (!directory) {
        directory = { kind: "directory", path, name, children: [], fileCount: 0 };
        directories.set(path, directory);
        children.push(directory);
      }
      directory.fileCount += 1;
      children = directory.children;
    }
    children.push({ kind: "file", name: parts.at(-1) ?? file.path, path: file.path, file });
  }
  function compactAndSort(nodes: ReviewTreeNode[]) {
    nodes.sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1,
    );
    for (const node of nodes) {
      if (node.kind !== "directory") continue;
      compactAndSort(node.children);
      const child = node.children.length === 1 ? node.children[0] : undefined;
      if (child?.kind === "directory") {
        node.name = `${node.name}/${child.name}`;
        node.path = child.path;
        node.children = child.children;
      }
    }
  }
  compactAndSort(root);
  return root;
}

export interface ReviewTreeRow {
  key: string;
  node: ReviewTreeNode;
  depth: number;
  parentPath: string | null;
  position: number;
  siblingCount: number;
}

export function flattenReviewFileTree(
  nodes: readonly ReviewTreeNode[],
  collapsed: ReadonlySet<string>,
): ReviewTreeRow[] {
  const rows: ReviewTreeRow[] = [];
  function visit(children: readonly ReviewTreeNode[], depth: number, parentPath: string | null) {
    children.forEach((node, index) => {
      rows.push({
        key: `${node.kind}:${node.path}`,
        node,
        depth,
        parentPath,
        position: index + 1,
        siblingCount: children.length,
      });
      if (node.kind === "directory" && !collapsed.has(node.path)) {
        visit(node.children, depth + 1, node.path);
      }
    });
  }
  visit(nodes, 0, null);
  return rows;
}

export function sortReviewFiles(files: readonly ReviewFile[]): ReviewFile[] {
  return flattenReviewFileTree(buildReviewFileTree(files), new Set()).flatMap((row) =>
    row.node.kind === "file" ? [row.node.file] : [],
  );
}

export interface ReviewFileSelection {
  scope: string;
  path: string;
  turnRevealRequestId: number;
}

export function resolveReviewFilePath(
  files: readonly Pick<ReviewFile, "path">[],
  localSelection: ReviewFileSelection | null,
  scope: string,
  requestedTurnPath: string | null,
  turnRevealRequestId: number,
): string | null {
  const localPath =
    localSelection?.scope === scope && localSelection.turnRevealRequestId === turnRevealRequestId
      ? localSelection.path
      : null;
  return (
    files.find((file) => file.path === localPath)?.path ??
    files.find((file) => file.path === requestedTurnPath)?.path ??
    files[0]?.path ??
    null
  );
}
