import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { resolveStorage } from "../../lib/storage";

export type PullRequestTab = "summary" | "timeline" | "code";

interface ReviewState {
  selectedByThread: Record<string, string>;
  tabByPr: Record<string, PullRequestTab>;
  select: (threadKey: string, url: string) => void;
  setTab: (prKey: string, tab: PullRequestTab) => void;
}

/** Viewing a PR never changes the thread's checkout. */
export const usePullRequestReviewStore = create<ReviewState>()(
  persist(
    (set) => ({
      selectedByThread: {},
      tabByPr: {},
      select: (key, url) =>
        set((state) => ({ selectedByThread: { ...state.selectedByThread, [key]: url } })),
      setTab: (key, tab) => set((state) => ({ tabByPr: { ...state.tabByPr, [key]: tab } })),
    }),
    {
      name: "test-rig:pr-review",
      partialize: ({ selectedByThread, tabByPr }) => ({ selectedByThread, tabByPr }),
      storage: createJSONStorage(() =>
        resolveStorage(typeof window === "undefined" ? null : window.localStorage),
      ),
    },
  ),
);
