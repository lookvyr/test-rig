import { useEffect, useState } from "react";

/** Keep live queries near the scroll viewport while offscreen rows stay mounted. */
export function useRowQueryLease() {
  const [row, rowRef] = useState<HTMLElement | null>(null);
  const [visible, setVisible] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (row === null) return;
    if (typeof IntersectionObserver === "undefined") return;
    let observing = true;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (observing) setVisible(entry?.isIntersecting === true ? row : null);
      },
      {
        root: row.closest<HTMLElement>('[data-slot="scroll-area-viewport"]'),
        rootMargin: "160px 0px",
      },
    );
    observer.observe(row);
    return () => {
      observing = false;
      observer.disconnect();
    };
  }, [row]);

  return {
    rowRef,
    enabled: row !== null && (typeof IntersectionObserver === "undefined" || visible === row),
  };
}
