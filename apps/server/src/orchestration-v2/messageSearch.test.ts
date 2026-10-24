import { describe, expect, it } from "vite-plus/test";
import { buildSearchSnippet, matchMessage, messageSearchTokens } from "./messageSearch.ts";

const match = (text: string, query: string) =>
  matchMessage(text, messageSearchTokens(query).tokens);

describe("message search", () => {
  it("requires every word, folds accents/apostrophes, and rejects short mid-word noise", () => {
    expect(match("Database connection timeout", "timeout database")).not.toBeNull();
    expect(match("Database healthy", "database timeout")).toBeNull();
    expect(match("Café can’t reconnect", "cafe can't")).not.toBeNull();
    expect(match("drafts", "fts")).toBeNull();
    expect(match("FTS index", "fts")).not.toBeNull();
    expect(match("𠀀fts", "fts")).toBeNull();
    expect(messageSearchTokens("on").long).toEqual([]);
    expect(messageSearchTokens("搜索").long).toEqual(["搜索"]);
    expect(match("搜索完成", "完成")).not.toBeNull();
  });

  it("ranks whole words, phrases, and close words above distant or mid-word matches", () => {
    const phrase = match("Database timeout", "database timeout")!;
    const near = match("Database connection timeout", "database timeout")!;
    const distant = match(`Database ${"details ".repeat(30)}timeout`, "database timeout")!;
    expect(phrase.quality).toBeGreaterThan(near.quality);
    expect(near.quality).toBeGreaterThan(distant.quality);
    expect(match("timeouts", "timeout")!.quality).toBeLessThan(
      match("timeout", "timeout")!.quality,
    );
  });

  it("centres a bounded snippet on the closest words, retaining original Unicode", () => {
    const text = `Database ${"old details ".repeat(40)}Café database connection timeout 🦊`;
    const found = match(text, "database timeout")!;
    const snippet = buildSearchSnippet(text, found.offset);
    expect(snippet).toContain("Café database connection timeout");
    expect(snippet.length).toBeLessThanOrEqual(240);
    expect(snippet.startsWith("…")).toBe(true);
  });
});
