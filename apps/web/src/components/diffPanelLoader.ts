export const loadDiffPanel = () => import("./DiffPanel");

/** Warm only the code on intent; Git queries still start when the panel opens. */
export function preloadDiffPanel() {
  void loadDiffPanel().catch(() => {
    // Speculative loading must not interrupt chat. Opening uses the normal error boundary.
  });
}
