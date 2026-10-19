/** Measure the collapsed layout, restoring wrapping and sideways scroll before paint. */
export function tableHasClippedCells(container: HTMLElement, table: HTMLTableElement): boolean {
  const viewport = table.closest<HTMLElement>('[data-slot="scroll-area-viewport"]');
  const scrollLeft = viewport?.scrollLeft ?? 0;
  const previous = container.dataset.expanded;
  if (previous !== "false") container.dataset.expanded = "false";
  try {
    for (const row of table.rows) {
      for (const cell of row.cells) {
        if (cell.scrollWidth > cell.clientWidth) return true;
      }
    }
    return false;
  } finally {
    if (previous === undefined) delete container.dataset.expanded;
    else if (previous !== "false") container.dataset.expanded = previous;
    // A narrower collapsed layout can temporarily clamp the scroll position.
    if (viewport && scrollLeft > 0) viewport.scrollLeft = scrollLeft;
  }
}
