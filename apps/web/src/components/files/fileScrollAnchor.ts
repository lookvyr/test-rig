export interface FileScrollAnchor {
  line: string;
  offset: number;
}

/** Capture a visible line before Pierre replaces its measured file contents. */
export function captureFileScrollAnchor(root: HTMLElement): FileScrollAnchor | null {
  const scroller = root.querySelector<HTMLElement>(".file-preview-virtualizer");
  const file = scroller?.querySelector("diffs-container");
  if (!scroller || !file?.shadowRoot) return null;
  const top = scroller.getBoundingClientRect().top;
  for (const element of file.shadowRoot.querySelectorAll<HTMLElement>("[data-line]")) {
    const rect = element.getBoundingClientRect();
    if (rect.bottom > top && element.dataset.line) {
      return { line: element.dataset.line, offset: rect.top - top };
    }
  }
  return null;
}

export function restoreFileScrollAnchor(root: HTMLElement, anchor: FileScrollAnchor): void {
  const scroller = root.querySelector<HTMLElement>(".file-preview-virtualizer");
  const file = scroller?.querySelector("diffs-container");
  const line = file?.shadowRoot?.querySelector<HTMLElement>(`[data-line="${anchor.line}"]`);
  if (!scroller || !line) return;
  scroller.scrollTop +=
    line.getBoundingClientRect().top - scroller.getBoundingClientRect().top - anchor.offset;
}
