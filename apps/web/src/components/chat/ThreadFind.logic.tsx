import { isValidElement, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { defaultUrlTransform } from "react-markdown";
import { resolveInlineCodeFileLinkMeta, rewriteMarkdownFileUriHref } from "../../markdown-links";
import {
  getChatMarkdownFileLinks,
  chatMarkdownFileLinkLabel,
  normalizeMarkdownLinkHrefKey,
  remarkTagInlineCode,
} from "../chatMarkdownFileLinks";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { CHAT_MARKDOWN_SANITIZE_SCHEMA } from "../chatMarkdownSchema";
import type { MessageId, OrchestrationThreadSearchMessage } from "@t3tools/contracts";
import { deriveDisplayedUserMessageState } from "../../lib/terminalContext";
import { extractTrailingElementContexts } from "../../lib/elementContext";
import { extractTrailingPreviewAnnotation } from "../../lib/previewAnnotation";

export interface ThreadFindMatch {
  readonly messageId: MessageId;
  readonly occurrence: number;
}

const BLOCK_TAGS = new Set([
  "p",
  "div",
  "pre",
  "li",
  "tr",
  "td",
  "th",
  "blockquote",
  "details",
  "summary",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "br",
  "hr",
]);

export function normalizeFindText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

function nodeText(
  node: ReactNode,
  fileLinks: ReturnType<typeof getChatMarkdownFileLinks>,
  cwd?: string,
): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map((child) => nodeText(child, fileLinks, cwd)).join("");
  if (!isValidElement<{ children?: ReactNode; href?: string; "data-inline-code"?: string }>(node))
    return "";
  const text = nodeText(node.props.children, fileLinks, cwd);
  const fileLink =
    node.type === "a" && node.props.href
      ? fileLinks.markdownFileLinkMetaByHref.get(normalizeMarkdownLinkHrefKey(node.props.href))
      : node.type === "code" && node.props["data-inline-code"] !== undefined
        ? (fileLinks.inlineCodeFileLinkMetaByText.get(text.trim()) ??
          resolveInlineCodeFileLinkMeta(text, cwd))
        : null;
  if (fileLink) return chatMarkdownFileLinkLabel(fileLink, fileLinks.fileLinkParentSuffixByPath);
  return typeof node.type === "string" && BLOCK_TAGS.has(node.type) ? ` ${text} ` : text;
}

/** Match what is readable, not Markdown delimiters, link destinations, or hidden prompt context. */
export function threadMessageFindText(
  message: Pick<OrchestrationThreadSearchMessage, "role" | "text">,
  cwd?: string,
): string {
  let text = message.text;
  if (message.role === "user") {
    text = deriveDisplayedUserMessageState(text).visibleText;
    while (true) {
      const result = extractTrailingPreviewAnnotation(text);
      if (!result.annotation) break;
      text = result.promptText;
    }
    text = extractTrailingElementContexts(text).promptText;
  }
  return normalizeFindText(
    nodeText(
      Markdown({
        children: text,
        remarkPlugins: [remarkGfm, remarkTagInlineCode],
        urlTransform: (href) => rewriteMarkdownFileUriHref(href) ?? defaultUrlTransform(href),
        rehypePlugins: [rehypeRaw, [rehypeSanitize, CHAT_MARKDOWN_SANITIZE_SCHEMA]],
      }),
      getChatMarkdownFileLinks(text, cwd),
      cwd,
    ),
  );
}

export function findTextOffsets(text: string, query: string): number[] {
  if (!query) return [];
  const offsets: number[] = [];
  let offset = text.indexOf(query);
  while (offset !== -1) {
    offsets.push(offset);
    offset = text.indexOf(query, offset + query.length);
  }
  return offsets;
}

/** Build DOM ranges without rewriting React's Markdown or syntax-highlighted code. */
export function findMessageRanges(element: Element, query: string): Range[] {
  const positions: { node: Text; offset: number }[] = [];
  let text = "";
  function append(value: string, node: Text, offset: number) {
    const character = /\s/.test(value)
      ? " "
      : value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
    if (character === " " && (text.length === 0 || text.endsWith(" "))) return;
    text += character;
    positions.push({ node, offset });
  }
  function visit(node: Node) {
    if (node instanceof Text) {
      for (let index = 0; index < node.length; index++) append(node.data[index]!, node, index);
      return;
    }
    if (
      !(node instanceof Element) ||
      node.matches(
        'button:not([data-thread-find-include]), svg, style, script, [aria-hidden="true"], [data-thread-find-ignore]',
      )
    )
      return;
    const block = BLOCK_TAGS.has(node.tagName.toLowerCase());
    if (block && positions.length) {
      const last = positions.at(-1)!;
      append(" ", last.node, last.offset);
    }
    node.childNodes.forEach(visit);
    if (block && positions.length) {
      const last = positions.at(-1)!;
      append(" ", last.node, last.offset);
    }
  }
  visit(element);
  return findTextOffsets(text, query).flatMap((offset) => {
    const start = positions[offset];
    const end = positions[offset + query.length - 1];
    if (!start || !end) return [];
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset + 1);
    return [range];
  });
}
