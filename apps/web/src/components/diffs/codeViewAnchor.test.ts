import { CodeView, type FileDiffMetadata } from "@pierre/diffs";
import { parsePatchFiles } from "@pierre/diffs/utils/parsePatchFiles";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const FILE_ID = "src/app.ts";
const LINES = Array.from({ length: 12 }, (_, index) => `const line${index + 1} = ${index + 1};`);

function parseFileDiff(patchLines: ReadonlyArray<string>): FileDiffMetadata {
  const [fileDiff] = parsePatchFiles(
    [
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      ...patchLines,
    ].join("\n"),
    "code-view-anchor-test",
  )[0]!.files;
  return fileDiff!;
}

// The working tree changed line 2. An agent then adds two lines at the top of the same file.
const previousDiff = parseFileDiff([
  "@@ -1,12 +1,12 @@",
  ` ${LINES[0]}`,
  `-${LINES[1]}`,
  "+const line2 = 'two';",
  ...LINES.slice(2).map((line) => ` ${line}`),
]);
const nextDiff = parseFileDiff([
  "@@ -1,12 +1,14 @@",
  "+// agent edit",
  "+// another agent edit",
  ` ${LINES[0]}`,
  `-${LINES[1]}`,
  "+const line2 = 'two';",
  ...LINES.slice(2).map((line) => ` ${line}`),
]);

interface ViewerInternals {
  root: object;
  items: unknown[];
  idToItem: Map<string, unknown>;
  renderState: Record<string, number>;
  pendingLayoutAnchor: unknown;
  reconcileItems(items: unknown[]): void;
  getScrollAnchor(scrollTop: number): { lineNumber?: number; viewportOffset: number } | undefined;
  clearPendingScroll(): void;
}

/** A viewer scrolled into the file, reading line 9 near the top of the viewport. */
function createScrolledViewer() {
  const viewer = new CodeView() as unknown as ViewerInternals;
  const record = {
    type: "diff",
    item: { id: FILE_ID, type: "diff", fileDiff: previousDiff, version: 1 },
    version: 1,
    index: 0,
    top: 0,
    height: 2000,
    instance: {
      getNumericScrollAnchor: () => ({ lineNumber: 9, side: "additions", top: 340 }),
    },
  };
  viewer.root = {};
  viewer.items = [record];
  viewer.idToItem = new Map([[FILE_ID, record]]);
  viewer.renderState = {
    scrollTop: 300,
    firstIndex: 0,
    lastIndex: 0,
    stickyTop: 0,
    stickyBottom: 32,
  };
  Object.defineProperty(viewer, "render", { value: () => undefined });
  Object.defineProperty(viewer, "getHeight", { value: () => 500 });
  Object.defineProperty(viewer, "getScrollTop", { value: () => 300 });
  return viewer;
}

describe("CodeView anchoring across a diff refresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("document", { createElement: () => ({ style: {} }) });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("follows the read line when lines are added above it in its own file", () => {
    const viewer = createScrolledViewer();

    viewer.reconcileItems([{ id: FILE_ID, type: "diff", fileDiff: nextDiff, version: 2 }]);

    expect(viewer.getScrollAnchor(300)).toMatchObject({ lineNumber: 11 });
  });

  it("holds the line while the refreshed file is measured, until the reader scrolls", () => {
    const viewer = createScrolledViewer();
    viewer.reconcileItems([{ id: FILE_ID, type: "diff", fileDiff: nextDiff, version: 2 }]);
    // The first frame consumes the pending anchor; later frames re-measure wrapped rows.
    viewer.pendingLayoutAnchor = undefined;

    expect(viewer.getScrollAnchor(300)).toMatchObject({ lineNumber: 11 });

    viewer.clearPendingScroll();
    expect(viewer.getScrollAnchor(300)).toMatchObject({ lineNumber: 9 });
  });

  it("lets go of the line once the refreshed file has settled", () => {
    const viewer = createScrolledViewer();
    viewer.reconcileItems([{ id: FILE_ID, type: "diff", fileDiff: nextDiff, version: 2 }]);
    viewer.pendingLayoutAnchor = undefined;

    vi.advanceTimersByTime(1500);

    expect(viewer.getScrollAnchor(300)).toMatchObject({ lineNumber: 9 });
  });

  it("keeps the anchor as is when the read file did not change", () => {
    const viewer = createScrolledViewer();

    viewer.reconcileItems([{ id: FILE_ID, type: "diff", fileDiff: previousDiff, version: 1 }]);

    expect(viewer.pendingLayoutAnchor).toBeUndefined();
  });
});
