const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** Fold the same apostrophes and accents as the message index. */
export function foldMessageSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[’‘]/g, "'")
    .toLowerCase();
}

export function messageSearchTokens(query: string) {
  const tokens = [...new Set(foldMessageSearch(query).trim().split(/\s+/).filter(Boolean))];
  const long = tokens.filter(
    (token) => Array.from(token).length >= 3 || (Array.from(token).length === 2 && CJK.test(token)),
  );
  return { tokens, long };
}

/** Every word narrows the search; short words must start a word. */
export function matchMessage(text: string, tokens: readonly string[]) {
  const folded = foldMessageSearch(text);
  let quality = 1;
  const positions: number[][] = [];
  for (const token of tokens) {
    let best = -1;
    let offsets: number[] = [];
    for (
      let index = folded.indexOf(token);
      index !== -1;
      index = folded.indexOf(token, index + 1)
    ) {
      const startsWord =
        CJK.test(token) ||
        !/[\p{L}\p{N}]$/u.test(folded.slice(Math.max(0, index - 2), index)) ||
        !/^[\p{L}\p{N}]/u.test(token);
      if (!startsWord && Array.from(token).length < 4) continue;
      const endsWord =
        CJK.test(token) ||
        !/^[\p{L}\p{N}]/u.test(folded.slice(index + token.length, index + token.length + 2));
      const found = startsWord ? (endsWord ? 1 : 0.8) : 0.3;
      if (found > best) {
        best = found;
        offsets = [index];
      } else if (found === best) offsets.push(index);
    }
    if (best === -1) return null;
    quality = Math.min(quality, best);
    positions.push(offsets);
  }
  const hits = positions
    .flatMap((places, word) => places.map((index) => ({ index, word })))
    .sort((a, b) => a.index - b.index);
  const counts = positions.map(() => 0);
  let covered = 0;
  let left = 0;
  let offset = hits[0]?.index ?? 0;
  let span = Number.POSITIVE_INFINITY;
  for (const hit of hits) {
    counts[hit.word] = (counts[hit.word] ?? 0) + 1;
    if (counts[hit.word] === 1) covered++;
    while (covered === positions.length) {
      const first = hits[left]!;
      if (hit.index - first.index < span) {
        span = hit.index - first.index;
        offset = first.index;
      }
      counts[first.word] = (counts[first.word] ?? 1) - 1;
      if (counts[first.word] === 0) covered--;
      left++;
    }
  }
  const phrase =
    tokens.length > 1
      ? new RegExp(
          `(?<![\\p{L}\\p{N}])` +
            tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+") +
            `(?![\\p{L}\\p{N}])`,
          "u",
        ).exec(folded)
      : null;
  if (phrase) {
    quality += 0.25;
    offset = phrase.index;
  } else if (tokens.length > 1 && span <= 60) quality += 0.1;
  // Translate the folded offset back to the original Unicode text for snippets.
  let foldedOffset = 0;
  let originalOffset = 0;
  for (const character of text) {
    if (foldedOffset >= offset) break;
    foldedOffset += foldMessageSearch(character).length;
    originalOffset += character.length;
  }
  return { quality, offset: originalOffset };
}

export function buildSearchSnippet(text: string, offset: number): string {
  let start = Math.max(0, offset - 24);
  if (start > 0) {
    const space = text.slice(start, offset).search(/\s/);
    if (space !== -1) start += space + 1;
  }
  if (/[\uDC00-\uDFFF]/.test(text[start] ?? "")) start++;
  const shown = text
    .slice(start, start + 480)
    .replace(/\s+/g, " ")
    .trim();
  let end = Math.min(shown.length, 238);
  if (/[\uDC00-\uDFFF]/.test(shown[end] ?? "")) end--;
  return `${start > 0 ? "…" : ""}${shown.slice(0, end)}${end < shown.length || start + 480 < text.length ? "…" : ""}`;
}
