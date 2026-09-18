import type { Editor } from "@tiptap/core";
import {
  createParagraphNear,
  exitCode,
  liftEmptyBlock,
  newlineInCode,
  splitBlockKeepMarks,
} from "@tiptap/pm/commands";

import { serializeEditorDoc } from "~/composer-rich-text-doc";

/** Shift-Enter continues the current block; plain Enter belongs to message submission. */
export function continueComposerBlock(editor: Editor): boolean {
  const { view } = editor;
  const { $from } = view.state.selection;
  const fence =
    $from.parent.type.name === "paragraph" && $from.parent.textContent.match(/^```([\w+-]*)$/);
  if (fence)
    return editor
      .chain()
      .deleteRange({ from: $from.start(), to: $from.end() })
      .setCodeBlock({ language: fence[1] || "" })
      .run();
  if (
    editor.isActive("codeBlock") &&
    $from.parentOffset === $from.parent.content.size &&
    $from.parent.textContent.endsWith("\n\n")
  ) {
    view.dispatch(view.state.tr.delete($from.pos - 2, $from.pos));
    return exitCode(view.state, (tr) => view.dispatch(tr.scrollIntoView()));
  }
  if (newlineInCode(view.state, (tr) => view.dispatch(tr.scrollIntoView()))) return true;
  if (editor.isActive("listItem"))
    return editor.commands.splitListItem("listItem") || editor.commands.liftListItem("listItem");
  return (
    createParagraphNear(view.state, (tr) => view.dispatch(tr.scrollIntoView())) ||
    liftEmptyBlock(view.state, (tr) => view.dispatch(tr.scrollIntoView())) ||
    splitBlockKeepMarks(view.state, (tr) => view.dispatch(tr.scrollIntoView()))
  );
}

export function serializeComposerSelection(editor: Editor): string {
  const { from, to } = editor.state.selection;
  const { doc, schema } = editor.state;
  const slice = doc.slice(from, to);
  const content = slice.content;
  if (content.firstChild?.isInline) {
    return serializeEditorDoc(doc.type.create(null, schema.nodes.paragraph!.create(null, content)))
      .value;
  }
  if (content.firstChild?.type.name === "listItem") {
    // A partial multi-item slice omits its shared list wrapper. Retain that
    // wrapper so the clipboard keeps bullets and the selected starting number.
    const { $from } = editor.state.selection;
    const depth = $from.sharedDepth(to);
    const list = $from.node(depth);
    if (list.type.name === "bulletList" || list.type.name === "orderedList") {
      const attrs =
        list.type.name === "orderedList"
          ? { ...list.attrs, start: Number(list.attrs.start ?? 1) + $from.index(depth) }
          : list.attrs;
      return serializeEditorDoc(doc.type.create(null, list.type.create(attrs, content))).value;
    }
  }
  return serializeEditorDoc(doc.type.create(null, content)).value;
}
