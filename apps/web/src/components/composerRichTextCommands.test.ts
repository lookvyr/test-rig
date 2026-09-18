import { Editor, Node } from "@tiptap/core";
import { closeHistory, history } from "@tiptap/pm/history";
import { TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { buildDocJson, flatToPm, serializeEditorDoc } from "~/composer-rich-text-doc";
import { continueComposerBlock, serializeComposerSelection } from "./composerRichTextCommands";

const editors: Editor[] = [];
function createEditor(source: string) {
  const editor = new Editor({
    element: null,
    extensions: [
      StarterKit.configure({ link: false, horizontalRule: false, trailingNode: false }),
      Node.create({
        name: "composer-mention",
        group: "inline",
        inline: true,
        atom: true,
        addAttributes: () => ({ path: { default: "" }, source: { default: "" } }),
      }),
    ],
    content: buildDocJson(source, (name) => ({ label: name, description: null })),
  });
  // Headless editors skip view-mounted plugins; use the same history implementation.
  editor.registerPlugin(history());
  editors.push(editor);
  const map = serializeEditorDoc(editor.state.doc);
  editor.commands.setTextSelection(flatToPm(map, map.docLength));
  return editor;
}
const markdown = (editor: Editor) => serializeEditorDoc(editor.state.doc).value;
const type = (editor: Editor, text: string) =>
  editor.view.dispatch(editor.state.tr.insertText(text));

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("rich composer editing commands", () => {
  it("continues a list, then exits an empty bullet without sending", () => {
    const editor = createEditor("- First");
    expect(continueComposerBlock(editor)).toBe(true);
    type(editor, "Second");
    expect(markdown(editor)).toBe("- First\n- Second");
    continueComposerBlock(editor);
    continueComposerBlock(editor);
    type(editor, "After the list");
    expect(markdown(editor)).toBe("- First\n- Second\nAfter the list");
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
  });

  it("opens a typed code fence, preserves code whitespace, and exits after blank lines", () => {
    const editor = createEditor("```ts");
    expect(continueComposerBlock(editor)).toBe(true);
    expect(editor.state.selection.$from.parent.type.name).toBe("codeBlock");
    type(editor, "  const value = 1;");
    continueComposerBlock(editor);
    type(editor, "  console.log(value);");
    expect(markdown(editor)).toBe("```ts\n  const value = 1;\n  console.log(value);\n```");
    continueComposerBlock(editor);
    continueComposerBlock(editor);
    continueComposerBlock(editor);
    type(editor, "After code");
    expect(markdown(editor)).toBe(
      "```ts\n  const value = 1;\n  console.log(value);\n```\nAfter code",
    );
  });

  it("keeps code inside a list literal when continuing the line", () => {
    const editor = createEditor("- First");
    editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "Example" }] },
                { type: "codeBlock", content: [{ type: "text", text: "one" }] },
              ],
            },
          ],
        },
      ],
    });
    editor.commands.setTextSelection(15);
    expect(editor.state.selection.$from.parent.type.name).toBe("codeBlock");
    continueComposerBlock(editor);
    type(editor, "two");
    expect(editor.state.selection.$from.parent.type.name).toBe("codeBlock");
    expect(editor.state.selection.$from.parent.textContent).toBe("one\ntwo");
  });

  it("keeps list continuation undoable and redoable", () => {
    const editor = createEditor("- First");
    editor.view.dispatch(closeHistory(editor.state.tr));
    continueComposerBlock(editor);
    type(editor, "Second");
    expect(editor.commands.undo()).toBe(true);
    expect(markdown(editor)).toBe("- First");
    expect(editor.commands.redo()).toBe(true);
    expect(markdown(editor)).toBe("- First\n- Second");
  });

  it("copies partial formatted text and chips as Markdown", () => {
    const editor = createEditor("Before **bold** [file.ts](src/file.ts) after");
    const map = serializeEditorDoc(editor.state.doc);
    const from = flatToPm(map, "Before ".length);
    const to = flatToPm(map, "Before bold ".length + 1);
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)),
    );
    expect(serializeComposerSelection(editor)).toBe("**bold** [file.ts](src/file.ts)");
    editor.commands.deleteSelection();
    expect(markdown(editor)).toBe("Before  after");
    editor.commands.undo();
    expect(markdown(editor)).toBe("Before **bold** [file.ts](src/file.ts) after");
  });

  it.each([
    ["- First\n- Second", 2, 9, "- rst\n- Sec"],
    ["3. First\n4. Second\n5. Third", 8, 18, "4. cond\n5. Third"],
    ["- Outer\n  7. First\n  8. Second", 8, 15, "7. rst\n8. Sec"],
  ] as const)(
    "copies partial list selections with their original markers: %s",
    (source, from, to, expected) => {
      const editor = createEditor(source);
      const map = serializeEditorDoc(editor.state.doc);
      editor.commands.setTextSelection({ from: flatToPm(map, from), to: flatToPm(map, to) });
      expect(serializeComposerSelection(editor)).toBe(expected);
    },
  );

  it("pastes an explicit scoped folder as a chip and leaves npm package names literal", () => {
    const editor = createEditor("Inspect ");
    const source = "[sub](@scope/pkg/sub) and npm install @jane/foo.js";
    const content = buildDocJson(source, (name) => ({ label: name, description: null }))
      .content![0]!.content!;
    editor.commands.insertContent(content);
    expect(markdown(editor)).toBe("Inspect " + source);
    const chips: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "composer-mention") chips.push(node.attrs.path);
    });
    expect(chips).toEqual(["@scope/pkg/sub"]);
  });

  it("restores the final file chip after a stash trims trailing whitespace", () => {
    const editor = createEditor("Inspect [README.md](README.md) ");
    const stashed = markdown(editor).trim();
    editor.commands.setContent(buildDocJson("", (name) => ({ label: name, description: null })));
    editor.commands.setContent(
      buildDocJson(stashed, (name) => ({ label: name, description: null })),
    );
    expect(markdown(editor)).toBe("Inspect [README.md](README.md)");
    expect(editor.state.doc.firstChild?.lastChild?.type.name).toBe("composer-mention");
    const map = serializeEditorDoc(editor.state.doc);
    expect(map.runs.filter((run) => run.kind === "token")).toHaveLength(1);
  });

  it("restores a stashed Markdown document with its block types intact", () => {
    const editor = createEditor("# Draft\n- First\n```sh\necho $HOME\n```");
    const stashed = markdown(editor);
    editor.commands.setContent(buildDocJson("", (name) => ({ label: name, description: null })));
    editor.commands.setContent(
      buildDocJson(stashed, (name) => ({ label: name, description: null })),
    );
    expect(markdown(editor)).toBe(stashed);
    expect(editor.state.doc.content.content.map((node) => node.type.name)).toEqual([
      "heading",
      "bulletList",
      "codeBlock",
    ]);
  });
});
