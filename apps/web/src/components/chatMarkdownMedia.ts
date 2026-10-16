type MarkdownMediaLayout = { mediaStandalone?: boolean; mediaInsideLink?: boolean };

/** Reads the internal HAST data written by the media layout pass. */
export function markdownMediaLayout(node: { data?: unknown } | undefined) {
  return node?.data as MarkdownMediaLayout | undefined;
}

type MediaAstNode = {
  type: string;
  tagName?: string;
  value?: string;
  data?: MarkdownMediaLayout;
  children?: MediaAstNode[];
};

const MEDIA_BLOCKS = new Set(["p", "li", "blockquote", "div", "section", "figure"]);

function lineBoundary(node: MediaAstNode | undefined, before: boolean): boolean {
  return (
    !node ||
    node.tagName === "br" ||
    (node.type === "text" && (before ? /\n\s*$/ : /^\s*\n/).test(node.value ?? ""))
  );
}

/** Uses rendered blocks so list markers and raw HTML links do not change media controls. */
export function rehypeTagMediaLayout() {
  return (tree: MediaAstNode) => {
    const visit = (node: MediaAstNode, insideLink: boolean) => {
      const linked = insideLink || node.tagName === "a";
      const contents = node.children?.filter(
        (child) => child.type !== "comment" && !(child.type === "text" && !child.value?.trim()),
      );
      for (const [index, child] of (node.children ?? []).entries()) {
        if (child.tagName === "img") {
          child.data = {
            ...child.data,
            mediaInsideLink: linked,
            mediaStandalone:
              !linked &&
              (contents?.length === 1 ||
                (lineBoundary(node.children?.[index - 1], true) &&
                  lineBoundary(node.children?.[index + 1], false))) &&
              (node.type === "root" || MEDIA_BLOCKS.has(node.tagName ?? "")),
          };
        }
        visit(child, linked);
      }
    };
    visit(tree, false);
  };
}
