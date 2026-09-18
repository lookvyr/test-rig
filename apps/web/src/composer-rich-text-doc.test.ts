import { getSchema, Node } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vite-plus/test";

import {
  buildDocJson,
  collapsedToFlat,
  flatToCollapsed,
  flatToMarkdown,
  flatToPm,
  pmToFlat,
  serializeEditorDoc,
} from "./composer-rich-text-doc";
import {
  INLINE_TERMINAL_CONTEXT_PLACEHOLDER,
  type TerminalContextDraft,
} from "./lib/terminalContext";

const schema = getSchema([
  StarterKit.configure({ link: false, horizontalRule: false }),
  ...["composer-mention", "composer-skill", "composer-terminal-context"].map((name) =>
    Node.create({
      name,
      group: "inline",
      inline: true,
      atom: true,
      addAttributes: () => ({
        path: { default: "" },
        source: { default: "" },
        skillName: { default: "" },
        skillLabel: { default: "" },
        skillDescription: { default: null },
        contextId: { default: "" },
      }),
    }),
  ),
]);
const skill = (name: string) => ({ label: name, description: null });
const doc = (value: string, terminalContexts?: TerminalContextDraft[]) =>
  schema.nodeFromJSON(
    buildDocJson(value, skill, terminalContexts ? { terminalContexts } : undefined),
  );
const roundTrip = (value: string) => serializeEditorDoc(doc(value)).value;

describe("rich composer Markdown boundary", () => {
  it.each([
    "",
    "plain text\n\nnext line",
    "# Heading\n## Smaller heading\nA **bold** and *italic* and ~~removed~~ word.",
    "- First\n- Second\n  - Nested\n- Third",
    "3. Third\n4. Fourth\n  - Nested bullet\n5. Fifth",
    "> Quote\n> More **quoted** text",
    "```ts\n  const value = `$HOME`;\n\n  console.log(value);  \n```",
    "```\n\n```",
    "Before\n```sh\n$HOME @literal [file.ts](src/file.ts)\n```\nAfter",
    "Unfinished **bold and `code\n#not-a-heading\n| a | b |\n| --- | --- |",
    "A **bold `inline code`** span",
    "``use `tick` here``",
    String.raw`Escaped \`literal\` and \*stars\*`,
    "> ```sh\n> echo hello\n> echo world\n> ```",
    "> - One\n> - Two",
    "Mention [file_name.ts](src/file_name.ts) and $skill next",
  ])("retains Markdown content: %s", (value) => {
    expect(roundTrip(value)).toBe(value);
  });

  it("uses actual block nodes for supported Markdown", () => {
    const document = doc("# Header\n- One\n  2. Two\n```js\n  let n = 1;\n```");
    expect(document.child(0).type.name).toBe("heading");
    expect(document.child(1).type.name).toBe("bulletList");
    expect(document.child(1).firstChild?.child(1).type.name).toBe("orderedList");
    expect(document.child(2).type.name).toBe("codeBlock");
    expect(document.child(2).attrs.language).toBe("js");
  });

  it("restores code, paragraphs, and quotes nested inside list items", () => {
    const document = schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "Inspect" }] },
                {
                  type: "codeBlock",
                  attrs: { language: "sh" },
                  content: [
                    { type: "text", text: "  echo $HOME\n\n- literal code\n  echo done  " },
                  ],
                },
                { type: "paragraph", content: [{ type: "text", text: "Then explain" }] },
                {
                  type: "blockquote",
                  content: [
                    { type: "paragraph", content: [{ type: "text", text: "Quoted note" }] },
                  ],
                },
                {
                  type: "orderedList",
                  attrs: { start: 3 },
                  content: [
                    {
                      type: "listItem",
                      content: [
                        { type: "paragraph", content: [{ type: "text", text: "Nested" }] },
                        {
                          type: "codeBlock",
                          attrs: { language: "js" },
                          content: [{ type: "text", text: "  const n = 1;" }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Next" }] }],
            },
          ],
        },
      ],
    });
    const markdown = serializeEditorDoc(document).value;
    expect(markdown).toBe(
      "- Inspect\n  ```sh\n    echo $HOME\n  \n  - literal code\n    echo done  \n  ```\n  Then explain\n  > Quoted note\n  3. Nested\n    ```js\n      const n = 1;\n    ```\n- Next",
    );
    const restored = doc(markdown);
    expect(restored.toJSON()).toEqual(document.toJSON());
    expect(serializeEditorDoc(restored).value).toBe(markdown);
    const map = serializeEditorDoc(restored);
    for (let position = 0; position <= map.docLength; position++) {
      expect(pmToFlat(map, flatToPm(map, position)), `PM at ${position}`).toBe(position);
      expect(collapsedToFlat(map, flatToCollapsed(map, position)), `collapsed at ${position}`).toBe(
        position,
      );
    }
  });

  it("never converts file or skill syntax inside code into chips", () => {
    const document = doc("`$skill @file.ts `\n```sh\n$skill @file.ts \n```");
    const atoms: string[] = [];
    document.descendants((node) => {
      if (node.isAtom && !node.isText) atoms.push(node.type.name);
    });
    expect(atoms).toEqual([]);
    expect(serializeEditorDoc(document).value).toBe(
      "`$skill @file.ts `\n```sh\n$skill @file.ts \n```",
    );
  });

  it("preserves incomplete fenced code without chips or formatting", () => {
    const value = "```sh\n$HOME @README.md **literal** ";
    const document = doc(value);
    const names: string[] = [];
    document.descendants((node) => {
      names.push(node.type.name);
    });
    expect(names).not.toContain("composer-skill");
    expect(names).not.toContain("composer-mention");
    expect(serializeEditorDoc(document).value).toBe(value);
  });

  it("retains terminal metadata across multiple blocks and emits ordered context ids", () => {
    const context = { id: "terminal-context-1" } as TerminalContextDraft;
    const value = `# Inspect\n- Look at ${INLINE_TERMINAL_CONTEXT_PLACEHOLDER} and [file.ts](src/file.ts) `;
    const map = serializeEditorDoc(doc(value, [context]));
    expect(map.value).toBe(value);
    expect(map.contextIds).toEqual([context.id]);
    expect(map.runs.filter((run) => run.kind === "token")).toHaveLength(2);
  });

  it("maps visible caret positions back and forth across block prefixes and chips", () => {
    const map = serializeEditorDoc(
      doc(
        "# Header\n- **Bold** [file.ts](src/file.ts) then\n  - Nested\n```ts\nlet n = 1;\n```\nEnd",
      ),
    );
    for (let position = 0; position <= map.docLength; position++) {
      expect(pmToFlat(map, flatToPm(map, position)), `PM at ${position}`).toBe(position);
      expect(collapsedToFlat(map, flatToCollapsed(map, position)), `collapsed at ${position}`).toBe(
        position,
      );
    }
    const token = map.runs.find((run) => run.kind === "token")!;
    expect(flatToMarkdown(map, token.flatStart)).toBe(map.value.indexOf("[file.ts]"));
    expect(flatToMarkdown(map, token.flatStart + 1)).toBe(map.value.indexOf(" then"));
  });

  it("keeps the end-of-code caret before the closing fence", () => {
    const map = serializeEditorDoc(doc("```ts\nvalue\n```"));
    expect(flatToMarkdown(map, map.docLength)).toBe("```ts\nvalue".length);
    expect(flatToPm(map, map.docLength)).toBe(6);
  });

  it("maps the editable empty code block position after its opening fence", () => {
    const map = serializeEditorDoc(doc("```ts\n```"));
    expect(map.docLength).toBe(0);
    expect(flatToMarkdown(map, 0)).toBe(6);
    expect(flatToCollapsed(map, 0)).toBe(6);
    expect(flatToPm(map, 0)).toBe(1);
    expect(pmToFlat(map, 1)).toBe(0);
    expect(collapsedToFlat(map, 6)).toBe(0);
  });

  it("keeps chip source independent of surrounding formatting", () => {
    const document = schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Inspect ", marks: [{ type: "bold" }] },
            {
              type: "composer-mention",
              attrs: { path: "src/file.ts", source: "[file.ts](src/file.ts)" },
              marks: [{ type: "bold" }],
            },
            { type: "text", text: " please", marks: [{ type: "bold" }] },
          ],
        },
      ],
    });
    const map = serializeEditorDoc(document);
    expect(map.value).toBe("**Inspect** [file.ts](src/file.ts) **please**");
    expect(
      serializeEditorDoc(doc(map.value)).runs.filter((run) => run.kind === "token"),
    ).toHaveLength(1);
  });

  it("normalizes supported alternatives to a stable Markdown representation", () => {
    const value = "+ One\n+ Two\n  * Nested\n~~~js\nconst x = 1;\n~~~\n__bold__";
    const normalized = roundTrip(value);
    expect(normalized).toBe("- One\n- Two\n  - Nested\n```js\nconst x = 1;\n```\n**bold**");
    expect(roundTrip(normalized)).toBe(normalized);
  });
});
