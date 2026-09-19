import {
  normalizeMarkdownLinkDestination,
  resolveInlineCodeFileLinkMeta,
  resolveMarkdownFileLinkMeta,
  rewriteMarkdownFileUriHref,
  type MarkdownFileLinkMeta,
} from "../markdown-links";

type MarkdownAstNode = {
  type?: string;
  data?: { hProperties?: Record<string, unknown> };
  children?: MarkdownAstNode[];
};

/**
 * Fenced code also lands on the `code` component, and inline vs block is no
 * longer distinguishable there once both render `<code>` — so inline spans are
 * tagged on the mdast, where the distinction still exists. Code inside a link
 * label stays untagged: linkifying it would nest an anchor inside the link's
 * anchor and steal its clicks.
 */
export function remarkTagInlineCode() {
  return (tree: MarkdownAstNode) => {
    const visit = (node: MarkdownAstNode, insideLink: boolean) => {
      if (node.type === "inlineCode" && !insideLink) {
        node.data = {
          ...node.data,
          hProperties: {
            ...node.data?.hProperties,
            dataInlineCode: "",
          },
        };
      }
      const childInsideLink = insideLink || node.type === "link" || node.type === "linkReference";
      node.children?.forEach((child) => visit(child, childInsideLink));
    };

    visit(tree, false);
  };
}

const MARKDOWN_LINK_HREF_PATTERN = /\[[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;

function pathParentSegments(path: string): string[] {
  const normalized = path.replaceAll("\\", "/");
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  return segments.slice(0, -1);
}

function buildFileLinkParentSuffixByPath(filePaths: ReadonlyArray<string>): Map<string, string> {
  const groups = new Map<string, Set<string>>();
  for (const filePath of filePaths) {
    const pathSegments = filePath
      .replaceAll("\\", "/")
      .split("/")
      .filter((segment) => segment.length > 0);
    const basename = pathSegments[pathSegments.length - 1];
    if (!basename) continue;
    const group = groups.get(basename) ?? new Set<string>();
    group.add(filePath);
    groups.set(basename, group);
  }

  const suffixByPath = new Map<string, string>();
  for (const group of groups.values()) {
    const uniquePaths = [...group];
    if (uniquePaths.length < 2) continue;

    const parentSegmentsByPath = new Map(
      uniquePaths.map((filePath) => [filePath, pathParentSegments(filePath)]),
    );
    const minUniqueDepthByPath = new Map<string, number>();

    for (const filePath of uniquePaths) {
      const segments = parentSegmentsByPath.get(filePath) ?? [];
      let resolvedDepth = segments.length;
      for (let depth = 1; depth <= segments.length; depth += 1) {
        const candidate = segments.slice(-depth).join("/");
        const collision = uniquePaths.some((otherPath) => {
          if (otherPath === filePath) return false;
          const otherSegments = parentSegmentsByPath.get(otherPath) ?? [];
          return otherSegments.slice(-depth).join("/") === candidate;
        });
        if (!collision) {
          resolvedDepth = depth;
          break;
        }
      }
      minUniqueDepthByPath.set(filePath, resolvedDepth);
    }

    for (const filePath of uniquePaths) {
      const segments = parentSegmentsByPath.get(filePath) ?? [];
      if (segments.length === 0) continue;
      const minUniqueDepth = minUniqueDepthByPath.get(filePath) ?? 1;
      const suffixDepth = Math.min(segments.length, Math.max(minUniqueDepth, 2));
      suffixByPath.set(filePath, segments.slice(-suffixDepth).join("/"));
    }
  }

  return suffixByPath;
}

const FENCED_CODE_SEGMENT_PATTERN = /(```[\s\S]*?(?:```|$))/;
const INLINE_CODE_SPAN_PATTERN = /`([^`\n]+)`/g;

function extractInlineCodeSpans(text: string): string[] {
  const spans: string[] = [];
  const segments = text.split(FENCED_CODE_SEGMENT_PATTERN);
  for (let index = 0; index < segments.length; index += 2) {
    for (const match of (segments[index] ?? "").matchAll(INLINE_CODE_SPAN_PATTERN)) {
      const span = match[1]?.trim();
      if (span) spans.push(span);
    }
  }
  return spans;
}

function extractMarkdownLinkHrefs(text: string): string[] {
  const hrefs: string[] = [];
  for (const match of text.matchAll(MARKDOWN_LINK_HREF_PATTERN)) {
    const href = match[1]?.trim();
    if (!href) continue;
    hrefs.push(href);
  }
  return hrefs;
}

export function normalizeMarkdownLinkHrefKey(href: string): string {
  const normalizedHref = normalizeMarkdownLinkDestination(href);
  return rewriteMarkdownFileUriHref(normalizedHref) ?? normalizedHref;
}

/** File-chip metadata shared by the renderer and Find's readable-text extraction. */
export function getChatMarkdownFileLinks(text: string, cwd?: string) {
  const markdownFileLinkMetaByHref = new Map<string, MarkdownFileLinkMeta>();
  for (const href of extractMarkdownLinkHrefs(text)) {
    const normalizedHref = normalizeMarkdownLinkHrefKey(href);
    if (markdownFileLinkMetaByHref.has(normalizedHref)) continue;
    const meta = resolveMarkdownFileLinkMeta(normalizedHref, cwd);
    if (meta) markdownFileLinkMetaByHref.set(normalizedHref, meta);
  }
  const inlineCodeFileLinkMetaByText = new Map<string, MarkdownFileLinkMeta>();
  for (const span of extractInlineCodeSpans(text)) {
    if (inlineCodeFileLinkMetaByText.has(span)) continue;
    const meta = resolveInlineCodeFileLinkMeta(span, cwd);
    if (meta) inlineCodeFileLinkMetaByText.set(span, meta);
  }
  const fileLinkParentSuffixByPath = buildFileLinkParentSuffixByPath([
    ...[...markdownFileLinkMetaByHref.values()].map((meta) => meta.filePath),
    ...[...inlineCodeFileLinkMetaByText.values()].map((meta) => meta.filePath),
  ]);
  return { markdownFileLinkMetaByHref, inlineCodeFileLinkMetaByText, fileLinkParentSuffixByPath };
}

export function chatMarkdownFileLinkLabel(
  meta: MarkdownFileLinkMeta,
  suffixByPath: ReadonlyMap<string, string>,
): string {
  const parts = [meta.basename];
  const suffix = suffixByPath.get(meta.filePath);
  if (suffix) parts.push(suffix);
  if (meta.line) parts.push(`L${meta.line}${meta.column ? `:C${meta.column}` : ""}`);
  return parts.join(" · ");
}
