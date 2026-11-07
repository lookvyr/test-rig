import { useCallback } from "react";

export function useOpenLink(_threadRef?: unknown) {
  return useCallback(async (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  }, []);
}
