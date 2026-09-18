import { Extension, Node, type Editor } from "@tiptap/core";
import Code from "@tiptap/extension-code";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  EditorContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
  type NodeViewProps,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { ServerProviderSkill } from "@t3tools/contracts";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  clampCollapsedComposerCursor,
  collapseExpandedComposerCursor,
  expandCollapsedComposerCursor,
  isCollapsedCursorAdjacentToInlineToken,
} from "~/composer-logic";
import { collectComposerInlineTokens } from "@t3tools/shared/composerInlineTokens";
import {
  buildDocJson,
  collapsedToFlat,
  flatToCollapsed,
  flatToMarkdown,
  flatToPm,
  pmToFlat,
  serializeEditorDoc,
  type SkillMeta,
} from "~/composer-rich-text-doc";
import type { TerminalContextDraft } from "~/lib/terminalContext";
import { cn, isMacPlatform } from "~/lib/utils";
import { basenameOfPath } from "~/pierre-icons";
import { formatProviderSkillDisplayName } from "~/providerSkillPresentation";
import {
  COMPOSER_INLINE_CHIP_ICON_CLASS_NAME,
  COMPOSER_INLINE_SKILL_CHIP_CLASS_NAME,
  COMPOSER_INLINE_SKILL_CHIP_LABEL_CLASS_NAME,
  SKILL_CHIP_ICON_SVG,
} from "./composerInlineChip";
import { FILE_TAG_CHIP_CLASS_NAME, FileTagChipContent } from "./chat/FileTagChip";
import { ComposerPendingTerminalContextChip } from "./chat/ComposerPendingTerminalContexts";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { continueComposerBlock, serializeComposerSelection } from "./composerRichTextCommands";
import { useTheme } from "~/hooks/useTheme";
import {
  composerCodeHighlightingKey,
  createComposerCodeHighlighting,
} from "./composerCodeHighlighting";

export interface ComposerPromptEditorHandle {
  focus: () => void;
  focusAt: (cursor: number) => void;
  focusAtEnd: () => void;
  readSnapshot: () => {
    value: string;
    cursor: number;
    expandedCursor: number;
    terminalContextIds: string[];
  };
}

interface ComposerPromptEditorProps {
  value: string;
  cursor: number;
  terminalContexts: ReadonlyArray<TerminalContextDraft>;
  skills: ReadonlyArray<ServerProviderSkill>;
  disabled: boolean;
  placeholder: string;
  className?: string;
  onRemoveTerminalContext: (contextId: string) => void;
  onChange: (
    nextValue: string,
    nextCursor: number,
    expandedCursor: number,
    cursorAdjacentToMention: boolean,
    terminalContextIds: string[],
  ) => void;
  onCommandKeyDown?: (
    key: "ArrowDown" | "ArrowUp" | "Enter" | "Tab",
    event: KeyboardEvent,
  ) => boolean;
  onPaste: React.ClipboardEventHandler<HTMLElement>;
  editorRef: React.RefObject<ComposerPromptEditorHandle | null>;
}

const TerminalContextsContext = createContext<ReadonlyArray<TerminalContextDraft>>([]);
const chipWrapperClass = "composer-inline-chip relative inline-flex align-[-0.125em] leading-none";

function ComposerMentionView({ node }: NodeViewProps) {
  const path = String(node.attrs.path);
  const chip = (
    <span
      className={FILE_TAG_CHIP_CLASS_NAME}
      contentEditable={false}
      spellCheck={false}
      data-composer-mention-chip="true"
    >
      <FileTagChipContent
        path={path}
        label={basenameOfPath(path)}
        theme={document.documentElement.classList.contains("dark") ? "dark" : "light"}
      />
    </span>
  );
  return (
    <NodeViewWrapper as="span" className={chipWrapperClass}>
      <Tooltip>
        <TooltipTrigger render={chip} />
        <TooltipPopup
          side="top"
          className="max-w-120 whitespace-normal leading-tight wrap-anywhere"
        >
          {path}
        </TooltipPopup>
      </Tooltip>
    </NodeViewWrapper>
  );
}

function ComposerSkillView({ node }: NodeViewProps) {
  const chip = (
    <span
      className={COMPOSER_INLINE_SKILL_CHIP_CLASS_NAME}
      contentEditable={false}
      spellCheck={false}
      data-composer-skill-chip="true"
    >
      <span
        aria-hidden="true"
        className={COMPOSER_INLINE_CHIP_ICON_CLASS_NAME}
        dangerouslySetInnerHTML={{ __html: SKILL_CHIP_ICON_SVG }}
      />
      <span className={COMPOSER_INLINE_SKILL_CHIP_LABEL_CLASS_NAME}>
        {String(node.attrs.skillLabel || node.attrs.skillName)}
      </span>
    </span>
  );
  return (
    <NodeViewWrapper as="span" className={chipWrapperClass}>
      {node.attrs.skillDescription ? (
        <Tooltip>
          <TooltipTrigger render={chip} />
          <TooltipPopup side="top" className="max-w-120 whitespace-normal leading-tight">
            {String(node.attrs.skillDescription)}
          </TooltipPopup>
        </Tooltip>
      ) : (
        chip
      )}
    </NodeViewWrapper>
  );
}

function ComposerTerminalView({ node }: NodeViewProps) {
  const contexts = use(TerminalContextsContext);
  const context = contexts.find((candidate) => candidate.id === node.attrs.contextId);
  return (
    <NodeViewWrapper as="span" className={chipWrapperClass} contentEditable={false}>
      {context ? <ComposerPendingTerminalContextChip context={context} /> : "Terminal context"}
    </NodeViewWrapper>
  );
}

const ComposerMentionExtension = Node.create({
  name: "composer-mention",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes: () => ({ path: { default: "" }, source: { default: "" } }),
  parseHTML: () => [{ tag: "span[data-composer-mention]" }],
  renderHTML: ({ HTMLAttributes }) => ["span", { "data-composer-mention": "", ...HTMLAttributes }],
  addNodeView: () => ReactNodeViewRenderer(ComposerMentionView),
});
const ComposerSkillExtension = Node.create({
  name: "composer-skill",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes: () => ({
    skillName: { default: "" },
    skillLabel: { default: "" },
    skillDescription: { default: null },
  }),
  parseHTML: () => [{ tag: "span[data-composer-skill]" }],
  renderHTML: ({ HTMLAttributes }) => ["span", { "data-composer-skill": "", ...HTMLAttributes }],
  addNodeView: () => ReactNodeViewRenderer(ComposerSkillView),
});
const ComposerTerminalExtension = Node.create({
  name: "composer-terminal-context",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes: () => ({ contextId: { default: "" } }),
  parseHTML: () => [{ tag: "span[data-composer-terminal-context]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "span",
    { "data-composer-terminal-context": "", ...HTMLAttributes },
  ],
  addNodeView: () => ReactNodeViewRenderer(ComposerTerminalView),
});

// Atom views need their own highlight when a text selection crosses a chip.
const ComposerSelectionExtension = Extension.create({
  name: "composer-selection",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations(state) {
            const { from, to, empty } = state.selection;
            if (empty) return DecorationSet.empty;
            const decorations: Decoration[] = [];
            state.doc.nodesBetween(from, to, (node, pos) => {
              if (node.type.name.startsWith("composer-"))
                decorations.push(
                  Decoration.node(pos, pos + node.nodeSize, {
                    "data-composer-chip-selected": "true",
                  }),
                );
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});

function readEditorSnapshot(editor: Editor) {
  const map = serializeEditorDoc(editor.state.doc);
  const flat = pmToFlat(map, editor.state.selection.from);
  return {
    value: map.value,
    cursor: clampCollapsedComposerCursor(map.value, flatToCollapsed(map, flat)),
    expandedCursor: Math.max(0, Math.min(map.value.length, flatToMarkdown(map, flat))),
    terminalContextIds: map.contextIds,
  };
}

export function ComposerPromptEditor(props: ComposerPromptEditorProps) {
  const { value, cursor, terminalContexts, disabled, placeholder, className, editorRef } = props;
  const { resolvedTheme } = useTheme();
  const themeRef = useRef(resolvedTheme);
  themeRef.current = resolvedTheme;
  const latest = useRef(props);
  latest.current = props;
  const applyingControlled = useRef(false);
  const pendingControlled = useRef<{
    value: string;
    cursor: number;
    terminalContexts: ReadonlyArray<TerminalContextDraft>;
  } | null>(null);
  const appliedInitialSelection = useRef(false);
  const editorHolder = useRef<Editor | null>(null);
  const snapshot = useRef({
    value,
    cursor,
    expandedCursor: expandCollapsedComposerCursor(value, cursor),
    terminalContextIds: terminalContexts.map((context) => context.id),
  });
  const [isEmpty, setIsEmpty] = useState(value.length === 0);
  const skillLabelFor = useCallback((name: string): SkillMeta => {
    const normalized = name.replace(/^\$/, "");
    const skill = latest.current.skills.find((candidate) => candidate.name === normalized);
    return {
      label: formatProviderSkillDisplayName(skill ?? { name: normalized }),
      description: skill?.shortDescription?.trim() || skill?.description?.trim() || null,
    };
  }, []);

  const handleChange = useCallback((editor: Editor) => {
    if (applyingControlled.current || pendingControlled.current) return;
    const next = readEditorSnapshot(editor);
    const previous = snapshot.current;
    if (previous.value === next.value && next.value !== latest.current.value) return;
    if (
      previous.value === next.value &&
      previous.cursor === next.cursor &&
      previous.expandedCursor === next.expandedCursor &&
      previous.terminalContextIds.join("\0") === next.terminalContextIds.join("\0")
    )
      return;
    snapshot.current = next;
    setIsEmpty(next.value.length === 0);
    latest.current.onChange(
      next.value,
      next.cursor,
      next.expandedCursor,
      isCollapsedCursorAdjacentToInlineToken(next.value, next.cursor, "left") ||
        isCollapsedCursorAdjacentToInlineToken(next.value, next.cursor, "right"),
      next.terminalContextIds,
    );
  }, []);

  const editorAttributes = useMemo(
    () => ({
      class: cn(
        "composer-tiptap block max-h-50 min-h-17.5 w-full overflow-y-auto whitespace-pre-wrap wrap-break-word bg-transparent leading-relaxed text-foreground focus:outline-none",
        className,
      ),
      "data-testid": "composer-editor",
      "aria-placeholder": placeholder,
      role: "textbox",
      "aria-multiline": "true",
    }),
    [className, placeholder],
  );

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          horizontalRule: false,
          underline: false,
          trailingNode: false,
          link: false,
          code: false,
        }),
        Code.extend({ excludes: "" }),
        ComposerMentionExtension,
        ComposerSkillExtension,
        ComposerTerminalExtension,
        ComposerSelectionExtension,
        createComposerCodeHighlighting(() => themeRef.current),
      ],
      content: buildDocJson(value, skillLabelFor, { terminalContexts }),
      editable: !disabled,
      editorProps: {
        attributes: editorAttributes,
        handleKeyDown: (view, event) => {
          if (event.isComposing || event.keyCode === 229) {
            if (event.key === "Enter") event.stopPropagation();
            return event.key === "Enter";
          }
          const commandKey =
            event.key === "ArrowDown" ||
            event.key === "ArrowUp" ||
            event.key === "Enter" ||
            event.key === "Tab"
              ? event.key
              : null;
          if (commandKey && latest.current.onCommandKeyDown?.(commandKey, event)) {
            event.preventDefault();
            event.stopPropagation();
            return true;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            // Enter belongs to the composer. Shift-Enter performs the editor's
            // normal block continuation, including lists and literal code lines.
            if (!event.shiftKey) return true;
            const instance = editorHolder.current;
            if (!instance) return true;
            return continueComposerBlock(instance);
          }
          if (
            (event.key === "ArrowLeft" ||
              event.key === "ArrowRight" ||
              event.key === "Backspace" ||
              event.key === "Delete") &&
            !event.shiftKey &&
            !event.altKey &&
            !event.metaKey &&
            !event.ctrlKey &&
            view.state.selection.empty
          ) {
            const { $from } = view.state.selection;
            const backwards = event.key === "ArrowLeft" || event.key === "Backspace";
            const adjacent = backwards ? $from.nodeBefore : $from.nodeAfter;
            if (adjacent?.type.name.startsWith("composer-")) {
              const other = $from.pos + (backwards ? -adjacent.nodeSize : adjacent.nodeSize);
              const deleting = event.key === "Backspace" || event.key === "Delete";
              event.preventDefault();
              const tr = deleting
                ? view.state.tr.delete(Math.min(other, $from.pos), Math.max(other, $from.pos))
                : view.state.tr.setSelection(TextSelection.create(view.state.doc, other));
              view.dispatch(tr.scrollIntoView());
              return true;
            }
          }
          if (
            isMacPlatform(navigator.platform) &&
            (event.key === "Home" || event.key === "End") &&
            !event.altKey &&
            !event.metaKey &&
            !event.ctrlKey
          ) {
            const selection = window.getSelection();
            if (
              selection?.anchorNode &&
              view.dom.contains(selection.anchorNode) &&
              typeof selection.modify === "function"
            ) {
              event.preventDefault();
              selection.modify(
                event.shiftKey ? "extend" : "move",
                event.key === "Home" ? "backward" : "forward",
                "lineboundary",
              );
              if (selection.anchorNode && selection.focusNode)
                view.dispatch(
                  view.state.tr.setSelection(
                    TextSelection.create(
                      view.state.doc,
                      view.posAtDOM(selection.anchorNode, selection.anchorOffset),
                      view.posAtDOM(selection.focusNode, selection.focusOffset),
                    ),
                  ),
                );
              return true;
            }
          }
          return false;
        },
        handleTextInput: (view, from, to, text) => {
          const close = new Map([
            ["(", ")"],
            ["[", "]"],
            ["{", "}"],
            ["'", "'"],
            ['"', '"'],
            ["`", "`"],
            ["<", ">"],
            ["*", "*"],
            ["_", "_"],
          ]).get(text);
          if (!close || from === to) return false;
          let special = false;
          view.state.doc.nodesBetween(from, to, (node) => {
            if (
              (node.isBlock && node.type.name === "codeBlock") ||
              (node.isInline && (!node.isText || node.marks.length > 0))
            )
              special = true;
          });
          if (special) return false;
          const tr = view.state.tr.insertText(close, to).insertText(text, from);
          tr.setSelection(TextSelection.create(tr.doc, from + 1, to + 1));
          view.dispatch(tr);
          return true;
        },
        handlePaste: (view, event) => {
          if (
            event.defaultPrevented ||
            !event.clipboardData ||
            event.clipboardData.files.length > 0
          )
            return false;
          let text = event.clipboardData.getData("text/plain");
          if (!text) return false;
          event.preventDefault();
          const instance = editorHolder.current;
          if (!instance) return true;
          // Code paste stays literal, including $variables and Markdown markers.
          if (instance.isActive("codeBlock") || instance.isActive("code")) {
            view.dispatch(view.state.tr.insertText(text).scrollIntoView());
            return true;
          }
          const tokens = collectComposerInlineTokens(`${text}\n`);
          const lastToken = tokens.at(-1);
          if (
            (lastToken?.type === "mention" || lastToken?.type === "skill") &&
            lastToken.end === text.length
          )
            text += " ";
          if (
            (tokens[0]?.type === "mention" || tokens[0]?.type === "skill") &&
            tokens[0].start === 0
          ) {
            const current = readEditorSnapshot(instance);
            if (
              current.expandedCursor > 0 &&
              !/\s/.test(current.value[current.expandedCursor - 1]!)
            )
              text = ` ${text}`;
          }
          const blocks = buildDocJson(text, skillLabelFor, { terminalContexts: [] }).content ?? [];
          instance.commands.insertContent(
            blocks.length === 1 && blocks[0]?.type === "paragraph"
              ? (blocks[0].content ?? [])
              : blocks,
          );
          instance.view.dispatch(instance.state.tr.scrollIntoView());
          return true;
        },
      },
      onUpdate: ({ editor: updated }) => handleChange(updated),
      onSelectionUpdate: ({ editor: updated }) => handleChange(updated),
    },
    [],
  );
  editorHolder.current = editor;

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);
  useEffect(() => {
    editor?.setOptions({ editorProps: { attributes: editorAttributes } });
  }, [editor, editorAttributes]);
  useEffect(() => {
    if (editor) editor.view.dispatch(editor.state.tr.setMeta(composerCodeHighlightingKey, true));
  }, [editor, resolvedTheme]);
  const contextIds = terminalContexts.map((context) => context.id).join("\0");
  const previousContextIds = useRef(contextIds);
  useLayoutEffect(() => {
    if (!editor) return;
    const initial = !appliedInitialSelection.current;
    const normalized = clampCollapsedComposerCursor(value, cursor);
    const previous = snapshot.current;
    const contextsChanged = previousContextIds.current !== contextIds;
    if (!initial && previous.value === value && previous.cursor === normalized && !contextsChanged)
      return;
    if (!initial && previous.value === value && !contextsChanged && !editor.view.hasFocus()) return;

    const pending = { value, cursor: normalized, terminalContexts };
    pendingControlled.current = pending;
    let canceled = false;
    // React node views mount synchronously. Apply external draft/chip updates
    // after React's commit so Tiptap's flushSync never runs inside a lifecycle.
    queueMicrotask(() => {
      if (canceled || editor.isDestroyed || pendingControlled.current !== pending) return;
      applyingControlled.current = true;
      try {
        const focused = editor.view.hasFocus();
        if (snapshot.current.value !== pending.value || contextsChanged)
          editor.commands.setContent(
            buildDocJson(pending.value, skillLabelFor, {
              terminalContexts: pending.terminalContexts,
            }),
            { emitUpdate: false },
          );
        const map = serializeEditorDoc(editor.state.doc);
        editor.commands.setTextSelection(flatToPm(map, collapsedToFlat(map, pending.cursor)));
        snapshot.current = readEditorSnapshot(editor);
        previousContextIds.current = contextIds;
        appliedInitialSelection.current = true;
        setIsEmpty(snapshot.current.value.length === 0);
        if (focused) editor.view.dispatch(editor.state.tr.scrollIntoView());
      } finally {
        applyingControlled.current = false;
        if (pendingControlled.current === pending) pendingControlled.current = null;
      }
    });
    return () => {
      canceled = true;
      if (pendingControlled.current === pending) pendingControlled.current = null;
    };
  }, [contextIds, cursor, editor, skillLabelFor, terminalContexts, value]);

  const focusAt = useCallback(
    (nextCursor: number) => {
      if (!editor) return;
      editor.view.dom.focus({ preventScroll: true });
      const pending = pendingControlled.current;
      if (pending) {
        pending.cursor = clampCollapsedComposerCursor(pending.value, nextCursor);
        return;
      }
      if (snapshot.current.value !== latest.current.value) return;
      const map = serializeEditorDoc(editor.state.doc);
      editor.commands.setTextSelection(
        flatToPm(map, collapsedToFlat(map, clampCollapsedComposerCursor(map.value, nextCursor))),
      );
      editor.view.dispatch(editor.state.tr.scrollIntoView());
    },
    [editor],
  );
  useImperativeHandle(
    editorRef,
    () => ({
      focus: () => focusAt(pendingControlled.current?.cursor ?? snapshot.current.cursor),
      focusAt,
      focusAtEnd: () => {
        const nextValue = pendingControlled.current?.value ?? snapshot.current.value;
        focusAt(collapseExpandedComposerCursor(nextValue, nextValue.length));
      },
      readSnapshot: () => {
        const pending = pendingControlled.current;
        if (pending)
          return {
            value: pending.value,
            cursor: pending.cursor,
            expandedCursor: expandCollapsedComposerCursor(pending.value, pending.cursor),
            terminalContextIds: pending.terminalContexts.map((context) => context.id),
          };
        if (editor) snapshot.current = readEditorSnapshot(editor);
        return snapshot.current;
      },
    }),
    [editor, focusAt],
  );

  const copySelection = (event: React.ClipboardEvent, cut: boolean) => {
    if (!editor || (cut && !editor.isEditable)) return;
    const { from, to } = editor.state.selection;
    if (from === to) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", serializeComposerSelection(editor));
    if (cut) editor.chain().focus().deleteSelection().run();
  };

  return (
    <TerminalContextsContext value={terminalContexts}>
      <div className="composer-editor-surface relative">
        <EditorContent
          editor={editor}
          onPasteCapture={props.onPaste}
          onCopyCapture={(event) => copySelection(event, false)}
          onCutCapture={(event) => copySelection(event, true)}
        />
        {isEmpty && terminalContexts.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 leading-relaxed text-placeholder">
            {placeholder}
          </div>
        ) : null}
      </div>
    </TerminalContextsContext>
  );
}
