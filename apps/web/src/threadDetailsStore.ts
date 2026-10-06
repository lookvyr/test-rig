import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { resolveStorage } from "./lib/storage";

/** Details visibility is independent of the tabbed panel and its selected diff. */
export const useThreadDetailsStore = create<{
  hiddenByThreadKey: Record<string, boolean>;
  setOpen: (thread: ScopedThreadRef, open: boolean) => void;
}>()(
  persist(
    (set) => ({
      hiddenByThreadKey: {},
      setOpen: (thread, open) =>
        set((state) => ({
          hiddenByThreadKey: { ...state.hiddenByThreadKey, [scopedThreadKey(thread)]: !open },
        })),
    }),
    {
      name: "test-rig:thread-details",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ hiddenByThreadKey: state.hiddenByThreadKey }),
    },
  ),
);
