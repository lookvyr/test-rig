import type { CodeViewItem } from "@pierre/diffs";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const testState = vi.hoisted(() => ({
  codeViewOptions: null as Record<string, unknown> | null,
  renderHeaderMetadata: null as ((item: CodeViewItem) => ReactNode) | null,
}));

vi.mock("@pierre/diffs/react", () => ({
  CodeView: (props: {
    options: Record<string, unknown>;
    renderHeaderMetadata: (item: CodeViewItem) => ReactNode;
  }) => {
    testState.codeViewOptions = props.options;
    testState.renderHeaderMetadata = props.renderHeaderMetadata;
    return null;
  },
}));

vi.mock("~/composerDraftStore", () => ({
  useComposerDraftStore: (selector: (store: Record<string, unknown>) => unknown) =>
    selector({
      addReviewComment: vi.fn(),
      removeReviewComment: vi.fn(),
      getComposerDraft: () => undefined,
    }),
}));

vi.mock("../files/LocalCommentAnnotation", () => ({
  LocalCommentAnnotation: () => null,
}));

vi.mock("../files/fileCommentAnnotations", () => ({
  nextFileCommentId: () => "comment-test",
}));

import { AnnotatableCodeView } from "./AnnotatableCodeView";
import { getRenderablePatch } from "~/lib/diffRendering";

describe("AnnotatableCodeView", () => {
  beforeEach(() => {
    testState.codeViewOptions = null;
    testState.renderHeaderMetadata = null;
  });

  it("opens comments from Pierre's gutter action without ending line selection", () => {
    renderToStaticMarkup(
      <AnnotatableCodeView
        codeViewKey="test-view"
        files={[]}
        sectionId="working-tree"
        sectionTitle="Working tree"
        composerDraftTarget={"draft-test" as never}
        options={{}}
        renderHeaderPrefix={() => null}
      />,
    );

    expect(testState.codeViewOptions).toMatchObject({
      enableGutterUtility: true,
      enableLineSelection: true,
      onGutterUtilityClick: expect.any(Function),
    });
    expect(testState.codeViewOptions).not.toHaveProperty("onLineSelectionEnd");
  });

  it("renders file counts from refreshed diff metadata", () => {
    renderToStaticMarkup(
      <AnnotatableCodeView
        codeViewKey="test-view"
        files={[]}
        sectionId="working-tree"
        sectionTitle="Working tree"
        composerDraftTarget={"draft-test" as never}
        options={{}}
        renderHeaderPrefix={() => null}
      />,
    );
    for (const additions of [1, 2]) {
      const patch = getRenderablePatch(
        `diff --git a/example.ts b/example.ts\n--- a/example.ts\n+++ b/example.ts\n@@ -1 +1,${additions} @@\n-old\n+new\n${additions === 2 ? "+another\n" : ""}`,
      );
      if (patch?.kind !== "files" || !patch.files[0]) throw new Error("Expected parsed diff");
      const markup = renderToStaticMarkup(
        testState.renderHeaderMetadata!({
          id: "example.ts",
          type: "diff",
          fileDiff: patch.files[0],
        }),
      );
      expect(markup).toContain(`aria-label="${additions} additions, 1 deletions"`);
      expect(markup).toContain(`+${additions}</span>`);
    }
  });
});
