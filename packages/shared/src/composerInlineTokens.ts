export interface MarkdownCodeRange {
  start: number;
  end: number;
  kind: "inline" | "fenced";
  closed: boolean;
}

// Keep shell variables and file-like text literal in prompt code. Unclosed
// fences also count, because autocomplete runs while the prompt is being typed.
export function collectComposerMarkdownCodeRanges(text: string): MarkdownCodeRange[] {
  const ranges: MarkdownCodeRange[] = [];
  let fence: { start: number; marker: string } | null = null;
  for (const line of text.matchAll(/^.*(?:\n|$)/gm)) {
    const source = line[0];
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)/.exec(source);
    if (!marker) continue;
    const run = marker[1]!;
    if (fence) {
      if (run[0] === fence.marker[0] && run.length >= fence.marker.length && !marker[2]!.trim()) {
        ranges.push({
          start: fence.start,
          end: line.index + source.trimEnd().length,
          kind: "fenced",
          closed: true,
        });
        fence = null;
      }
    } else if (run[0] !== "`" || !marker[2]!.includes("`")) {
      fence = { start: line.index, marker: run };
    }
  }
  if (fence) ranges.push({ start: fence.start, end: text.length, kind: "fenced", closed: false });

  const runs = [...text.matchAll(/`+/g)];
  const nextMatchingRun = new Map<number, number>();
  const nextByLength = new Map<number, number>();
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index]!;
    const next = nextByLength.get(run[0].length);
    if (next !== undefined) nextMatchingRun.set(index, next);
    nextByLength.set(run[0].length, index);
  }
  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index]!;
    if (ranges.some((range) => range.start <= run.index && run.index < range.end)) continue;
    let backslashes = 0;
    for (let before = run.index - 1; before >= 0 && text[before] === "\\"; before -= 1)
      backslashes += 1;
    if (backslashes % 2 !== 0) continue;
    const closingIndex = nextMatchingRun.get(index);
    if (closingIndex === undefined) continue;
    const closing = runs[closingIndex]!;
    if (ranges.some((range) => run.index < range.start && closing.index >= range.start)) continue;
    ranges.push({
      start: run.index,
      end: closing.index + closing[0].length,
      kind: "inline",
      closed: true,
    });
    index = closingIndex;
  }
  return ranges;
}

export function isComposerMarkdownCode(text: string, offset: number): boolean {
  return collectComposerMarkdownCodeRanges(text).some(
    (range) => range.start <= offset && offset < range.end,
  );
}

export type ComposerInlineToken =
  | {
      readonly type: "mention";
      readonly value: string;
      readonly source: string;
      readonly start: number;
      readonly end: number;
    }
  | {
      readonly type: "skill";
      readonly value: string;
      readonly source: string;
      readonly start: number;
      readonly end: number;
    };

export interface CollectComposerInlineTokensOptions {
  readonly preserveTrailingFrom?: ReadonlyArray<ComposerInlineToken>;
}

const SKILL_TOKEN_REGEX = /(^|\s)\$([a-zA-Z][a-zA-Z0-9:_-]*)(?=\s)/g;
const MENTION_TOKEN_REGEX = /(^|\s)@(?:"((?:\\.|[^"\\])*)"|([^\s@"]+))(?=\s)/g;
const FILE_LINK_TOKEN_REGEX = /(^|\s)\[((?:\\.|[^\]\\])*)\]\(([^)\s]+)\)(?=\s|$)/g;
const URI_SCHEME_REGEX = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const WINDOWS_DRIVE_PATH_REGEX = /^[A-Za-z]:[\\/]/;
// Autocomplete emits canonical file links, so ambiguous bare @scope/package text stays a package.
const SCOPED_PACKAGE_REFERENCE_REGEX =
  /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*(?:\/[^\s@"]+)*$/;

function collectMentionTokens(text: string): ComposerInlineToken[] {
  const matches: ComposerInlineToken[] = [];

  for (const match of text.matchAll(FILE_LINK_TOKEN_REGEX)) {
    const fullMatch = match[0];
    const prefix = match[1] ?? "";
    const label = (match[2] ?? "").replace(/\\(.)/g, "$1");
    const encodedPath = match[3] ?? "";
    let path = encodedPath;
    try {
      path = decodeURIComponent(encodedPath);
    } catch {
      // Preserve malformed source rather than dropping a user-authored token.
    }
    const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    const basename = separatorIndex >= 0 ? path.slice(separatorIndex + 1) : path;
    const hasExternalScheme = URI_SCHEME_REGEX.test(path) && !WINDOWS_DRIVE_PATH_REGEX.test(path);
    if (!path || hasExternalScheme || label !== basename) {
      continue;
    }
    const start = (match.index ?? 0) + prefix.length;
    const end = start + fullMatch.length - prefix.length;
    matches.push({
      type: "mention",
      value: path,
      source: text.slice(start, end),
      start,
      end,
    });
  }

  for (const match of text.matchAll(MENTION_TOKEN_REGEX)) {
    const fullMatch = match[0];
    const prefix = match[1] ?? "";
    const quotedPath = match[2];
    const path = quotedPath !== undefined ? quotedPath.replace(/\\(.)/g, "$1") : (match[3] ?? "");
    if (!path || (quotedPath === undefined && SCOPED_PACKAGE_REFERENCE_REGEX.test(path))) {
      continue;
    }
    const start = (match.index ?? 0) + prefix.length;
    const end = start + fullMatch.length - prefix.length;
    matches.push({
      type: "mention",
      value: path,
      source: text.slice(start, end),
      start,
      end,
    });
  }

  return matches;
}

export function collectComposerInlineTokens(
  text: string,
  options: CollectComposerInlineTokensOptions = {},
): ReadonlyArray<ComposerInlineToken> {
  const matches = collectMentionTokens(text);

  for (const match of text.matchAll(SKILL_TOKEN_REGEX)) {
    const fullMatch = match[0];
    const prefix = match[1] ?? "";
    const value = match[2] ?? "";
    if (!value) {
      continue;
    }
    const start = (match.index ?? 0) + prefix.length;
    const end = start + fullMatch.length - prefix.length;
    matches.push({
      type: "skill",
      value,
      source: text.slice(start, end),
      start,
      end,
    });
  }

  for (const token of options.preserveTrailingFrom ?? []) {
    if (
      token.end === text.length &&
      text.slice(token.start, token.end) === token.source &&
      !matches.some(
        (match) =>
          match.type === token.type && match.start === token.start && match.end === token.end,
      )
    ) {
      matches.push(token);
    }
  }

  const codeRanges = collectComposerMarkdownCodeRanges(text);
  return matches
    .filter(
      (token) => !codeRanges.some((range) => token.start < range.end && token.end > range.start),
    )
    .sort((left, right) => left.start - right.start);
}
