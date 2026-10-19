import { describe, expect, it } from "vite-plus/test";

import { tableHasClippedCells } from "./chatMarkdownTable";

function fixture(expanded: string | undefined) {
  const container = { dataset: { expanded } };
  const viewport = { scrollLeft: 150 };
  let contentWidth = 100;
  const cell = {
    clientWidth: 100,
    get scrollWidth() {
      expect(container.dataset.expanded).toBe("false");
      // Simulate the browser clamping a wide table's scroll in collapsed layout.
      viewport.scrollLeft = 0;
      return contentWidth;
    },
  };
  const table = {
    rows: [{ cells: [cell] }],
    closest: () => viewport,
  };
  return {
    container,
    viewport,
    cell,
    setContentWidth: (width: number) => {
      contentWidth = width;
    },
    measure: () =>
      tableHasClippedCells(
        container as unknown as HTMLElement,
        table as unknown as HTMLTableElement,
      ),
  };
}

describe("chat table clipping", () => {
  it("ignores cells that fit exactly, and detects growing and shrinking content", () => {
    const table = fixture("true");
    expect(table.measure()).toBe(false);
    table.setContentWidth(101);
    expect(table.measure()).toBe(true);
    table.setContentWidth(99);
    expect(table.measure()).toBe(false);
  });

  it.each(["true", "false", undefined])(
    "restores expansion %s and horizontal scroll",
    (expanded) => {
      const table = fixture(expanded);
      table.setContentWidth(200);
      expect(table.measure()).toBe(true);
      expect(table.container.dataset.expanded).toBe(expanded);
      expect(table.viewport.scrollLeft).toBe(150);
    },
  );

  it("restores layout and scroll even when measuring fails", () => {
    const table = fixture("true");
    Object.defineProperty(table.cell, "scrollWidth", {
      get() {
        table.viewport.scrollLeft = 0;
        throw new Error("measurement failed");
      },
    });
    expect(table.measure).toThrow("measurement failed");
    expect(table.container.dataset.expanded).toBe("true");
    expect(table.viewport.scrollLeft).toBe(150);
  });
});
