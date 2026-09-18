import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { JSONContent } from "@tiptap/core";
import { collectComposerMarkdownCodeRanges } from "@t3tools/shared/composerInlineTokens";

import { splitPromptIntoComposerSegments } from "~/composer-editor-mentions";
import { parseInlineMarkdown, RICH_TEXT_DELIMITERS, type RichTextMark } from "~/composer-rich-text";
import {
  INLINE_TERMINAL_CONTEXT_PLACEHOLDER,
  type TerminalContextDraft,
} from "~/lib/terminalContext";

/**
 * Pure document model for the rich text (Tiptap) composer.
 *
 * The stored prompt stays markdown (`**bold**`, `@file` chips as canonical
 * links). The Tiptap document holds styled text plus inline atom chips, so
 * this module translates both ways and maps cursor offsets between the three
 * coordinate spaces the composer speaks:
 *
 * - flat document offsets (styled markers excluded, chips count 1),
 * - collapsed cursor offsets (markers literal, chips count 1 — the coordinate
 *   the draft store and mention detection use),
 * - markdown offsets (markers literal, chips expand to their source).
 *
 * DOM-free on purpose: unit tests build a real ProseMirror document from the
 * JSON this produces and assert the round trip without a browser.
 */

export type SkillMeta = { label: string; description: string | null };

/** Outermost mark first, so closers mirror openers when nested. */
const MARK_NESTING_ORDER: RichTextMark[] = ["strike", "bold", "italic", "code"];

const MARK_TO_TIPTAP: Record<RichTextMark, string> = {
  bold: "bold",
  italic: "italic",
  strike: "strike",
  code: "code",
};

const TIPTAP_TO_MARK: Record<string, RichTextMark> = {
  bold: "bold",
  italic: "italic",
  strike: "strike",
  code: "code",
};

export interface BuildDocOptions {
  terminalContexts?: ReadonlyArray<TerminalContextDraft>;
  styling?: boolean;
}

function textJsonForSpan(text: string, marks: RichTextMark[]): JSONContent {
  return {
    type: "text",
    text,
    ...(marks.length
      ? {
          marks: [...marks]
            .sort((a, b) => MARK_NESTING_ORDER.indexOf(a) - MARK_NESTING_ORDER.indexOf(b))
            .map((mark) => ({ type: MARK_TO_TIPTAP[mark] })),
        }
      : {}),
  };
}

/** Parse only complete supported blocks; incomplete and unknown syntax stays editable text. */
export function buildTiptapContent(
  value: string,
  skillLabelFor: (name: string) => SkillMeta,
  options: BuildDocOptions = {},
): JSONContent[] {
  let contextIndex = 0;
  const inline = (source: string): JSONContent[] => {
    // Shield atoms before parsing marks so filenames containing underscores stay intact.
    // Code spans are shielded first: @paths and $variables inside them are literal.
    let sentinel = "\uE000";
    while (source.includes(sentinel)) sentinel += "\uE000";
    const atoms: JSONContent[] = [];
    const protect = (node: JSONContent) => {
      atoms.push(node);
      return sentinel;
    };
    const parts: { text: string; code: boolean }[] = [];
    let sourceCursor = 0;
    for (const range of collectComposerMarkdownCodeRanges(source).sort(
      (a, b) => a.start - b.start,
    )) {
      if (range.start > sourceCursor)
        parts.push({ text: source.slice(sourceCursor, range.start), code: false });
      parts.push({ text: source.slice(range.start, range.end), code: true });
      sourceCursor = range.end;
    }
    if (sourceCursor < source.length) parts.push({ text: source.slice(sourceCursor), code: false });
    const shielded = parts
      .map(({ text: part, code }) => {
        const delimiter = part.match(/^`+/)?.[0];
        if (
          options.styling !== false &&
          code &&
          delimiter &&
          part.endsWith(delimiter) &&
          part.length > delimiter.length * 2
        ) {
          return protect(
            textJsonForSpan(part.slice(delimiter.length, -delimiter.length), ["code"]),
          );
        }
        return splitPromptIntoComposerSegments(part)
          .map((segment) => {
            if (segment.type === "text") return segment.text;
            if (segment.type === "mention")
              return protect({
                type: "composer-mention",
                attrs: { path: segment.path, source: segment.source },
              });
            if (segment.type === "skill") {
              const meta = skillLabelFor(segment.name);
              return protect({
                type: "composer-skill",
                attrs: {
                  skillName: segment.name,
                  skillLabel: meta.label,
                  skillDescription: meta.description,
                },
              });
            }
            const context = options.terminalContexts?.[contextIndex++];
            return protect({
              type: "composer-terminal-context",
              attrs: { contextId: context?.id ?? "" },
            });
          })
          .join("");
      })
      .join("");
    let atomIndex = 0;
    const content: JSONContent[] = [];
    const spans =
      options.styling === false ? [{ text: shielded, marks: [] }] : parseInlineMarkdown(shielded);
    for (const span of spans) {
      span.text.split(sentinel).forEach((piece, index) => {
        if (index) {
          const atom = atoms[atomIndex++]!;
          content.push(
            atom.type === "text"
              ? {
                  ...atom,
                  marks: [...(textJsonForSpan("", span.marks).marks ?? []), ...(atom.marks ?? [])],
                }
              : atom,
          );
        }
        if (piece) content.push(textJsonForSpan(piece, span.marks));
      });
    }
    return content;
  };
  const paragraph = (text: string): JSONContent => ({ type: "paragraph", content: inline(text) });
  const listPrefix = (line: string) => /^( *)([-+*]|\d+[.)]) +(.*)$/.exec(line);
  const parseBlocks = (lines: string[]): JSONContent[] => {
    const blocks: JSONContent[] = [];
    for (let index = 0; index < lines.length; ) {
      const line = lines[index]!;
      if (options.styling === false) {
        blocks.push(paragraph(line));
        index++;
        continue;
      }
      const fence = /^(`{3,}|~{3,})([^`]*)$/.exec(line);
      if (fence) {
        const marker = fence[1]!;
        let close = index + 1;
        while (
          close < lines.length &&
          !new RegExp(`^${marker[0]}{${marker.length},} *$`).test(lines[close]!)
        )
          close++;
        if (close < lines.length) {
          const text = lines.slice(index + 1, close).join("\n");
          blocks.push({
            type: "codeBlock",
            attrs: { language: fence[2]!.trim() || null },
            content: text ? [{ type: "text", text }] : [],
          });
          index = close + 1;
          continue;
        }
        // An unfinished fence is still literal Markdown, including its code.
        // Do not turn shell variables or paths in the remaining lines into chips.
        for (const source of lines.slice(index)) {
          blocks.push({
            type: "paragraph",
            content: source ? [{ type: "text", text: source }] : [],
          });
        }
        break;
      }
      const heading = /^(#{1,6}) (.*)$/.exec(line);
      if (heading) {
        blocks.push({
          type: "heading",
          attrs: { level: heading[1]!.length },
          content: inline(heading[2]!),
        });
        index++;
        continue;
      }
      if (line.startsWith("> ") || line === ">") {
        const quoted: string[] = [];
        while (index < lines.length && /^>( |$)/.test(lines[index]!))
          quoted.push(lines[index++]!.replace(/^> ?/, ""));
        blocks.push({ type: "blockquote", content: parseBlocks(quoted) });
        continue;
      }
      const first = listPrefix(line);
      if (first) {
        const parseList = (indent: number): JSONContent => {
          const initial = listPrefix(lines[index]!)!;
          const ordered = /^\d/.test(initial[2]!);
          const items: JSONContent[] = [];
          while (index < lines.length) {
            const match = listPrefix(lines[index]!);
            if (!match || match[1]!.length !== indent || /^\d/.test(match[2]!) !== ordered) break;
            const item: JSONContent = { type: "listItem", content: [paragraph(match[3]!)] };
            index++;
            // Child blocks use the same two-space indent as serialization.
            // Parse their stripped lines together so fences own all their code,
            // including lines that happen to look like nested list markers.
            const childLines: string[] = [];
            const childIndent = " ".repeat(indent + 2);
            while (index < lines.length && lines[index]!.startsWith(childIndent)) {
              childLines.push(lines[index++]!.slice(childIndent.length));
            }
            if (childLines.length) item.content!.push(...parseBlocks(childLines));
            items.push(item);
          }
          return {
            type: ordered ? "orderedList" : "bulletList",
            ...(ordered ? { attrs: { start: Number.parseInt(initial[2]!, 10) } } : {}),
            content: items,
          };
        };
        blocks.push(parseList(first[1]!.length));
        continue;
      }
      blocks.push(paragraph(line));
      index++;
    }
    return blocks;
  };
  return parseBlocks(value.split("\n"));
}

export function buildDocJson(
  value: string,
  skillLabelFor: (name: string) => SkillMeta,
  options?: BuildDocOptions,
): JSONContent {
  return { type: "doc", content: buildTiptapContent(value, skillLabelFor, options) };
}

export interface RichRun {
  kind: "text" | "token" | "break" | "prefix";
  /** Flat document offset (atoms count 1, markers excluded). */
  flatStart: number;
  docLen: number;
  /** Collapsed cursor length (markers literal, tokens count 1). */
  collapsedLen: number;
  /** Markdown length (tokens expand to their source). */
  mdLen: number;
  /** Marker layout inside text runs. */
  openLen: number;
  closeLen: number;
  /** ProseMirror position of the run start. */
  pmPos: number;
  mdStart: number;
  collapsedStart: number;
  nodeName?: string;
}

export interface RichDocMap {
  value: string;
  runs: RichRun[];
  docLength: number;
  contextIds: string[];
}

function readAtomSource(node: ProseMirrorNode): string {
  const attrs = node.attrs as Record<string, unknown>;
  switch (node.type.name) {
    case "composer-mention":
      return typeof attrs.source === "string" ? attrs.source : "";
    case "composer-terminal-context":
      return INLINE_TERMINAL_CONTEXT_PLACEHOLDER;
    case "composer-skill": {
      const name = typeof attrs.skillName === "string" ? attrs.skillName : "";
      return name ? `$${name}` : "";
    }
    default:
      return "";
  }
}

interface RichAccumulator {
  runs: RichRun[];
  value: string;
  flat: number;
  collapsed: number;
  md: number;
}

function pushBreakRun(acc: RichAccumulator, position?: number): void {
  const previous = acc.runs[acc.runs.length - 1];
  const pmPos = position ?? (previous ? previous.pmPos + previous.docLen : 1);
  // Block boundary: one newline in every coordinate space.
  acc.runs.push({
    kind: "break",
    flatStart: acc.flat,
    docLen: 1,
    collapsedLen: 1,
    mdLen: 1,
    openLen: 0,
    closeLen: 0,
    pmPos,
    mdStart: acc.md,
    collapsedStart: acc.collapsed,
  });
  acc.value += "\n";
  acc.flat += 1;
  acc.collapsed += 1;
  acc.md += 1;
}

function appendInlineRuns(
  container: ProseMirrorNode,
  contentStart: number,
  acc: RichAccumulator,
): void {
  const children: ProseMirrorNode[] = [];
  container.forEach((child) => {
    if (!child.isText || child.marks.some((mark) => mark.type.name === "code")) {
      children.push(child.isText ? child : child.mark([]));
      return;
    }
    // Separate boundary whitespace so delimiters can move past it without
    // changing the document offsets or marks on the visible text.
    const text = child.text!;
    const start = text.length - text.trimStart().length;
    const end = Math.max(start, text.trimEnd().length);
    let offset = 0;
    for (const boundary of [start, end, text.length]) {
      if (boundary > offset) children.push(child.cut(offset, boundary));
      offset = boundary;
    }
  });
  // Emphasis cannot open or close next to whitespace. Retain a whitespace
  // mark only when its range has visible content on both sides.
  for (const mark of MARK_NESTING_ORDER) {
    if (mark === "code") continue;
    for (const direction of [1, -1]) {
      let hasContent = false;
      for (
        let index = direction === 1 ? 0 : children.length - 1;
        index >= 0 && index < children.length;
        index += direction
      ) {
        const child = children[index]!;
        if (
          child.type.name === "hardBreak" ||
          !child.marks.some((item) => item.type.name === mark)
        ) {
          hasContent = false;
        } else if (
          child.isText &&
          !child.marks.some((item) => item.type.name === "code") &&
          /^\s+$/.test(child.text!)
        ) {
          if (!hasContent)
            children[index] = child.mark(child.marks.filter((item) => item.type.name !== mark));
        } else {
          hasContent = true;
        }
      }
    }
  }
  // Longer shared marks surround shorter ones. This keeps both nested
  // formatting and formatting across chips inside a single delimiter pair.
  const markEnds = new Map<RichTextMark, number>();
  const orderedMarks: RichTextMark[][] = [];
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index]!;
    const marks = !child.isText
      ? []
      : child.marks
          .map((mark) => TIPTAP_TO_MARK[mark.type.name])
          .filter((mark): mark is RichTextMark => Boolean(mark));
    for (const mark of MARK_NESTING_ORDER) {
      if (!marks.includes(mark)) markEnds.delete(mark);
      else if (!markEnds.has(mark)) markEnds.set(mark, index);
    }
    orderedMarks[index] = marks.sort(
      (a, b) =>
        markEnds.get(b)! - markEnds.get(a)! ||
        MARK_NESTING_ORDER.indexOf(a) - MARK_NESTING_ORDER.indexOf(b),
    );
  }
  for (let index = 1; index < orderedMarks.length; index += 1) {
    const marks = orderedMarks[index]!;
    const retained: RichTextMark[] = [];
    for (const mark of orderedMarks[index - 1]!) {
      if (!marks.includes(mark)) break;
      retained.push(mark);
    }
    orderedMarks[index] = [...retained, ...marks.filter((mark) => !retained.includes(mark))];
  }
  const commonLength = (left: RichTextMark[], right: RichTextMark[]) => {
    let index = 0;
    while (index < left.length && left[index] === right[index]) index += 1;
    return index;
  };
  // A code span may contain literal backticks. Select a delimiter long enough
  // for the entire adjacent code range so it remains code after draft restore.
  const codeDelimiters: string[] = [];
  for (let index = 0; index < children.length; ) {
    if (!orderedMarks[index]!.includes("code")) {
      index++;
      continue;
    }
    const start = index;
    let text = "";
    while (index < children.length && orderedMarks[index]!.includes("code"))
      text += children[index++]!.textContent;
    const length = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length)) + 1;
    for (let cursor = start; cursor < index; cursor++) codeDelimiters[cursor] = "`".repeat(length);
  }
  let inlineOffset = 0;
  children.forEach((child, index) => {
    const pmPos = contentStart + inlineOffset;
    inlineOffset += child.nodeSize;
    if (child.type.name === "hardBreak") {
      pushBreakRun(acc, pmPos);
      return;
    }
    const marks = orderedMarks[index]!;
    const open = marks
      .slice(commonLength(marks, orderedMarks[index - 1] ?? []))
      .map((mark) => (mark === "code" ? codeDelimiters[index]! : RICH_TEXT_DELIMITERS[mark]))
      .join("");
    const close = marks
      .slice(commonLength(marks, orderedMarks[index + 1] ?? []))
      .toReversed()
      .map((mark) => (mark === "code" ? codeDelimiters[index]! : RICH_TEXT_DELIMITERS[mark]))
      .join("");
    const source = child.isText ? child.text! : readAtomSource(child);
    const docLen = child.isText ? source.length : 1;
    const mdText = open + source + close;
    const collapsedLen = open.length + docLen + close.length;
    acc.runs.push({
      kind: child.isText ? "text" : "token",
      flatStart: acc.flat,
      docLen,
      collapsedLen,
      mdLen: mdText.length,
      openLen: open.length,
      closeLen: close.length,
      pmPos,
      mdStart: acc.md,
      collapsedStart: acc.collapsed,
      ...(child.isText ? {} : { nodeName: child.type.name }),
    });
    acc.value += mdText;
    acc.flat += docLen;
    acc.collapsed += collapsedLen;
    acc.md += mdText.length;
  });
  // Empty paragraphs have an editable position even though they emit no text.
  if (children.length === 0) {
    acc.runs.push({
      kind: "text",
      flatStart: acc.flat,
      docLen: 0,
      collapsedLen: 0,
      mdLen: 0,
      openLen: 0,
      closeLen: 0,
      pmPos: contentStart,
      mdStart: acc.md,
      collapsedStart: acc.collapsed,
    });
  }
}

function pushPrefix(acc: RichAccumulator, prefix: string, pmPos: number): void {
  acc.runs.push({
    kind: "prefix",
    flatStart: acc.flat,
    docLen: 0,
    collapsedLen: prefix.length,
    mdLen: prefix.length,
    openLen: 0,
    closeLen: 0,
    pmPos,
    mdStart: acc.md,
    collapsedStart: acc.collapsed,
  });
  acc.value += prefix;
  acc.collapsed += prefix.length;
  acc.md += prefix.length;
}

export function serializeEditorDoc(doc: ProseMirrorNode): RichDocMap {
  const acc: RichAccumulator = { runs: [], value: "", flat: 0, collapsed: 0, md: 0 };
  const contextIds: string[] = [];
  doc.descendants((node) => {
    if (node.type.name === "composer-terminal-context" && typeof node.attrs.contextId === "string")
      contextIds.push(node.attrs.contextId);
  });
  const walk = (node: ProseMirrorNode, position: number, prefix = "") => {
    const name = node.type.name;
    if (name === "bulletList" || name === "orderedList") {
      let itemPos = position + 1;
      node.forEach((item, _offset, index) => {
        if (index) pushBreakRun(acc);
        const marker = name === "orderedList" ? `${Number(node.attrs.start ?? 1) + index}. ` : "- ";
        pushPrefix(acc, prefix + marker, itemPos + 2);
        let childPos = itemPos + 1;
        item.forEach((child, _childOffset, childIndex) => {
          if (childIndex) pushBreakRun(acc);
          if (childIndex === 0 && child.isTextblock) appendInlineRuns(child, childPos + 1, acc);
          else walk(child, childPos, prefix + "  ");
          childPos += child.nodeSize;
        });
        itemPos += item.nodeSize;
      });
      return;
    }
    if (name === "blockquote") {
      let childPos = position + 1;
      node.forEach((child, _offset, index) => {
        if (index) pushBreakRun(acc);
        walk(child, childPos, prefix + "> ");
        childPos += child.nodeSize;
      });
      return;
    }
    if (name === "codeBlock") {
      const longestFence = Math.max(
        2,
        ...(node.textContent.match(/`+/g) ?? []).map((run) => run.length),
      );
      const fence = "`".repeat(longestFence + 1);
      pushPrefix(
        acc,
        prefix + fence + String(node.attrs.language ?? "") + "\n" + prefix,
        position + 1,
      );
      const lines = node.textContent.split("\n");
      let contentPos = position + 1;
      lines.forEach((line, index) => {
        if (index) {
          pushBreakRun(acc, contentPos - 1);
          pushPrefix(acc, prefix, contentPos);
        }
        acc.runs.push({
          kind: "text",
          flatStart: acc.flat,
          docLen: line.length,
          collapsedLen: line.length,
          mdLen: line.length,
          openLen: 0,
          closeLen: 0,
          pmPos: contentPos,
          mdStart: acc.md,
          collapsedStart: acc.collapsed,
        });
        acc.value += line;
        acc.flat += line.length;
        acc.collapsed += line.length;
        acc.md += line.length;
        contentPos += line.length + 1;
      });
      pushPrefix(acc, "\n" + prefix + fence, position + 1 + node.content.size);
      return;
    }
    if (node.isTextblock) {
      pushPrefix(
        acc,
        prefix + (name === "heading" ? "#".repeat(Number(node.attrs.level)) + " " : ""),
        position + 1,
      );
      appendInlineRuns(node, position + 1, acc);
      return;
    }
    // Preserve visible content if a future extension introduces another container.
    let childPos = position + 1;
    node.forEach((child, _offset, index) => {
      if (index) pushBreakRun(acc);
      walk(child, childPos, prefix);
      childPos += child.nodeSize;
    });
  };
  doc.forEach((block, position, index) => {
    if (index) pushBreakRun(acc);
    walk(block, position);
  });
  return { value: acc.value, runs: acc.runs, docLength: acc.flat, contextIds };
}

function lastRunEnd(map: RichDocMap, space: "collapsed" | "md"): number {
  const last = map.runs[map.runs.length - 1];
  if (!last) return 0;
  return space === "collapsed"
    ? last.collapsedStart + last.collapsedLen
    : last.mdStart + last.mdLen;
}

export function flatToCollapsed(map: RichDocMap, flatOffset: number): number {
  const bounded = Math.max(0, Math.min(flatOffset, map.docLength));
  for (const run of map.runs) {
    if (bounded < run.flatStart + run.docLen) {
      if (run.kind === "text" || run.kind === "token") {
        return run.collapsedStart + run.openLen + (bounded - run.flatStart);
      }
      return run.collapsedStart + (bounded - run.flatStart);
    }
  }
  const last = map.runs.findLast((run) => run.kind !== "prefix");
  return last
    ? last.collapsedStart + last.collapsedLen - last.closeLen
    : lastRunEnd(map, "collapsed");
}

export function flatToMarkdown(map: RichDocMap, flatOffset: number): number {
  const bounded = Math.max(0, Math.min(flatOffset, map.docLength));
  for (const run of map.runs) {
    if (bounded < run.flatStart + run.docLen) {
      if (run.kind === "text" || run.kind === "token") {
        return run.mdStart + run.openLen + (bounded - run.flatStart);
      }
      return run.mdStart + (bounded - run.flatStart);
    }
  }
  const last = map.runs.findLast((run) => run.kind !== "prefix");
  return last ? last.mdStart + last.mdLen - last.closeLen : lastRunEnd(map, "md");
}

export function collapsedToFlat(map: RichDocMap, collapsedOffset: number): number {
  for (const run of map.runs) {
    if (collapsedOffset < run.collapsedStart + run.collapsedLen) {
      // Block prefixes and style markers are hidden: every
      // offset inside them clamps to the adjacent document position.
      if (run.kind === "prefix") return run.flatStart;
      if (run.kind === "text" || run.kind === "token") {
        const within = collapsedOffset - run.collapsedStart;
        // Marker characters clamp to the styled edge: they are hidden, never edited.
        if (within <= run.openLen) return run.flatStart;
        if (within >= run.openLen + run.docLen) return run.flatStart + run.docLen;
        return run.flatStart + (within - run.openLen);
      }
      return run.flatStart + (collapsedOffset - run.collapsedStart);
    }
  }
  return map.docLength;
}

export function flatToPm(map: RichDocMap, flatOffset: number): number {
  const bounded = Math.max(0, Math.min(flatOffset, map.docLength));
  for (const run of map.runs) {
    if (bounded < run.flatStart + run.docLen) {
      return run.pmPos + (bounded - run.flatStart);
    }
  }
  const last = map.runs[map.runs.length - 1];
  if (!last) return 1;
  return last.pmPos + last.docLen;
}

export function pmToFlat(map: RichDocMap, pmPos: number): number {
  for (const run of map.runs) {
    if (pmPos >= run.pmPos && pmPos <= run.pmPos + run.docLen) {
      // A position on a chip's trailing edge belongs after the chip.
      if (run.kind === "token" && pmPos === run.pmPos + run.docLen) {
        return run.flatStart + run.docLen;
      }
      return run.flatStart + Math.min(pmPos - run.pmPos, run.docLen);
    }
  }
  // A paragraph boundary position belongs to the newline between paragraphs.
  let best = 0;
  for (const run of map.runs) {
    if (run.pmPos <= pmPos) best = run.flatStart + run.docLen;
  }
  return Math.max(0, Math.min(best, map.docLength));
}
