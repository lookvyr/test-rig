import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { resolveStorage } from "./lib/storage";

/** Details visibility is independent of the tabbed panel and its selected diff. */
export const useThreadDetailsStore = create<{
  hiddenByThreadKey: Record<string, boolean>;
  popoverOpenByThreadKey: Record<string, boolean>;
  presentationByThreadKey: Record<string, "inline" | "popover">;
  setOpen: (thread: ScopedThreadRef, open: boolean) => void;
  setPresentation: (thread: ScopedThreadRef, presentation: "inline" | "popover") => void;
  setPopoverOpen: (thread: ScopedThreadRef, open: boolean) => void;
  toggle: (thread: ScopedThreadRef) => void;
}>()(
  persist(
    (set) => ({
      hiddenByThreadKey: {},
      popoverOpenByThreadKey: {},
      presentationByThreadKey: {},
      setOpen: (thread, open) =>
        set((state) => ({
          hiddenByThreadKey: { ...state.hiddenByThreadKey, [scopedThreadKey(thread)]: !open },
        })),
      setPresentation: (thread, presentation) =>
        set((state) => {
          const key = scopedThreadKey(thread);
          return state.presentationByThreadKey[key] === presentation
            ? state
            : {
                presentationByThreadKey: { ...state.presentationByThreadKey, [key]: presentation },
              };
        }),
      setPopoverOpen: (thread, open) =>
        set((state) => ({
          popoverOpenByThreadKey: {
            ...state.popoverOpenByThreadKey,
            [scopedThreadKey(thread)]: open,
          },
        })),
      toggle: (thread) =>
        set((state) => {
          const key = scopedThreadKey(thread);
          return state.presentationByThreadKey[key] === "popover"
            ? {
                popoverOpenByThreadKey: {
                  ...state.popoverOpenByThreadKey,
                  [key]: !state.popoverOpenByThreadKey[key],
                },
              }
            : {
                hiddenByThreadKey: {
                  ...state.hiddenByThreadKey,
                  [key]: !state.hiddenByThreadKey[key],
                },
              };
        }),
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
