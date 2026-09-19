import { describe, expect, it } from "vite-plus/test";
import { findTextOffsets, normalizeFindText, threadMessageFindText } from "./ThreadFind.logic";

describe("thread Find text", () => {
  it("finds a phrase across Markdown formatting and soft line breaks", () => {
    const text = threadMessageFindText({
      role: "assistant",
      text: "The **connection**\nretry is bounded.\n\nConnection retry again.",
    });
    expect(findTextOffsets(text, normalizeFindText("CONNECTION retry"))).toHaveLength(2);
  });

  it("includes code without matching link destinations or Markdown syntax", () => {
    const text = threadMessageFindText({
      role: "assistant",
      text: "[visible label](https://hidden.example)\n\n```ts\nconst retries = 3;\n```",
    });
    expect(text).toContain("visible label");
    expect(text).toContain("const retries = 3;");
    expect(text).not.toContain("hidden.example");
    expect(text).not.toContain("```");
  });

  it("matches rendered file-chip names and line positions instead of replaced link labels", () => {
    const text = threadMessageFindText(
      {
        role: "assistant",
        text: "See [implementation](file:///workspace/src/auth.ts#L12C3) and `src/other.ts:8`.",
      },
      "/workspace",
    );
    expect(text).toBe("see auth.ts · l12:c3 and other.ts · l8.");
    expect(text).not.toContain("implementation");
    expect(text).not.toContain("/workspace");
  });

  it("uses the same parent suffixes for duplicate file basenames", () => {
    expect(
      threadMessageFindText(
        {
          role: "assistant",
          text: "[server](src/server/index.ts) and `src/client/index.ts`",
        },
        "/workspace",
      ),
    ).toBe("index.ts · src/server and index.ts · src/client");
  });

  it("leaves paths in fenced code and code inside external links unchanged", () => {
    expect(
      threadMessageFindText(
        {
          role: "assistant",
          text: "```ts\nsrc/auth.ts\n```\n\n[`src/auth.ts`](https://example.com)",
        },
        "/workspace",
      ),
    ).toBe("src/auth.ts src/auth.ts");
  });

  it("separates a details summary from its bare text body", () => {
    expect(
      threadMessageFindText({
        role: "assistant",
        text: "<details><summary>Connection</summary>retry</details>",
      }),
    ).toBe("connection retry");
  });

  it("treats punctuation literally and counts non-overlapping occurrences", () => {
    expect(findTextOffsets("100% / a_b / a_b / a.b / aaa", "a_b")).toEqual([7, 13]);
    expect(findTextOffsets("aaaa", "aa")).toEqual([0, 2]);
    expect(findTextOffsets("anything", "")).toEqual([]);
  });

  it("separates adjacent paragraphs and table cells", () => {
    expect(threadMessageFindText({ role: "user", text: "First\n\nSecond" })).toBe("first second");
    expect(
      threadMessageFindText({
        role: "assistant",
        text: "| Left | Right |\n| --- | --- |\n| red | blue |",
      }),
    ).toBe("left right red blue");
  });
});
