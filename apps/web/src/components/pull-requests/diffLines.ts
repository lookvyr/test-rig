export interface PullRequestDiffLine {
  id: string;
  text: string;
  kind: "hunk" | "context" | "addition" | "deletion" | "meta";
  oldLine: number | null;
  newLine: number | null;
}

/** Preserve the old/new coordinates supplied by GitHub, including separate hunks. */
export function parsePullRequestPatch(patch: string): PullRequestDiffLine[] {
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  let offset = 0;
  return patch.split("\n").map((text) => {
    const id = String(offset);
    offset += text.length + 1;
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      return { id, text, kind: "hunk", oldLine: null, newLine: null };
    }
    if (!inHunk || text.startsWith("\\") || text === "") {
      return { id, text, kind: "meta", oldLine: null, newLine: null };
    }
    if (text.startsWith("+"))
      return { id, text, kind: "addition", oldLine: null, newLine: newLine++ };
    if (text.startsWith("-"))
      return { id, text, kind: "deletion", oldLine: oldLine++, newLine: null };
    if (text.startsWith(" "))
      return { id, text, kind: "context", oldLine: oldLine++, newLine: newLine++ };
    return { id, text, kind: "meta", oldLine: null, newLine: null };
  });
}
