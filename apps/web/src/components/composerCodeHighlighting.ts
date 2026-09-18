import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { DiffsHighlighter } from "@pierre/diffs";

import { resolveDiffThemeName } from "~/lib/diffRendering";
import { getSyntaxHighlighterPromise } from "~/lib/syntaxHighlighting";

export const composerCodeHighlightingKey = new PluginKey<DecorationSet>(
  "composer-code-highlighting",
);
const MAX_HIGHLIGHT_LENGTH = 20_000;

/** Decorations color the editable text itself, preserving native selection and input. */
export function createComposerCodeHighlighting(getTheme: () => "light" | "dark") {
  return Extension.create({
    name: "composer-code-highlighting",
    addProseMirrorPlugins() {
      const loaded = new Map<string, DiffsHighlighter | null>();
      const pending = new Set<string>();
      const cache = new WeakMap<
        ProseMirrorNode,
        { theme: string; spans: { from: number; to: number; color: string }[] }
      >();
      const languageFor = (node: ProseMirrorNode) =>
        String(node.attrs.language ?? "text")
          .trim()
          .split(/\s+/)[0] || "text";
      const eligible = (node: ProseMirrorNode) =>
        node.type.name === "codeBlock" && node.textContent.length <= MAX_HIGHLIGHT_LENGTH;

      const decorations = (doc: ProseMirrorNode) => {
        const result: Decoration[] = [];
        const theme = resolveDiffThemeName(getTheme());
        doc.descendants((node, pos) => {
          if (!eligible(node)) return;
          const highlighter = loaded.get(languageFor(node));
          if (!highlighter) return;
          let highlighted = cache.get(node);
          if (highlighted?.theme !== theme) {
            const spans: { from: number; to: number; color: string }[] = [];
            try {
              const lines = highlighter.codeToTokens(node.textContent, {
                lang: languageFor(node),
                theme,
              }).tokens;
              let offset = 0;
              for (const line of lines) {
                for (const token of line) {
                  if (token.color && token.content.length)
                    spans.push({
                      from: offset,
                      to: offset + token.content.length,
                      color: token.color,
                    });
                  offset += token.content.length;
                }
                offset++;
              }
            } catch {
              /* Unsupported languages remain plain editable code. */
            }
            highlighted = { theme, spans };
            cache.set(node, highlighted);
          }
          for (const span of highlighted.spans)
            result.push(
              Decoration.inline(pos + 1 + span.from, pos + 1 + span.to, {
                style: `color: ${span.color}`,
              }),
            );
        });
        return DecorationSet.create(doc, result);
      };

      const requestLanguages = (view: EditorView) => {
        view.state.doc.descendants((node) => {
          if (!eligible(node)) return;
          const language = languageFor(node);
          if (loaded.has(language) || pending.has(language)) return;
          pending.add(language);
          void getSyntaxHighlighterPromise(language)
            .then((highlighter) => {
              loaded.set(language, highlighter);
            })
            .catch(() => {
              loaded.set(language, null);
            })
            .finally(() => {
              pending.delete(language);
              if (!view.isDestroyed)
                view.dispatch(view.state.tr.setMeta(composerCodeHighlightingKey, true));
            });
        });
      };

      return [
        new Plugin<DecorationSet>({
          key: composerCodeHighlightingKey,
          state: {
            init: (_, state) => decorations(state.doc),
            apply: (tr, previous) =>
              tr.docChanged || tr.getMeta(composerCodeHighlightingKey)
                ? decorations(tr.doc)
                : previous,
          },
          props: { decorations: (state) => composerCodeHighlightingKey.getState(state) },
          view: (view) => {
            requestLanguages(view);
            return {
              update: (current, previous) => {
                if (current.state.doc !== previous.doc) requestLanguages(current);
              },
            };
          },
        }),
      ];
    },
  });
}
