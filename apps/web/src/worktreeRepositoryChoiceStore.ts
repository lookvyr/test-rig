import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

/** The last repositories and base branch picked for a project's new worktree threads. */
export interface WorktreeRepositoryChoice {
  /** Repository paths; null keeps the default (all, or none above eight). */
  readonly paths: ReadonlyArray<string> | null;
  /** For a plain project folder, which has no branch picker of its own. */
  readonly baseBranch: string;
}

export const DEFAULT_WORKTREE_REPOSITORY_CHOICE: WorktreeRepositoryChoice = {
  paths: null,
  baseBranch: "main",
};

interface WorktreeRepositoryChoiceState {
  readonly byProjectKey: Readonly<Record<string, WorktreeRepositoryChoice>>;
  readonly setChoice: (projectKey: string, choice: WorktreeRepositoryChoice) => void;
}

/** Remembered in this browser only: repository paths mean something on one machine. */
export const useWorktreeRepositoryChoiceStore = create<WorktreeRepositoryChoiceState>()(
  persist(
    (set) => ({
      byProjectKey: {},
      setChoice: (projectKey, choice) =>
        set((state) => ({ byProjectKey: { ...state.byProjectKey, [projectKey]: choice } })),
    }),
    {
      name: "t3code:worktree-repository-choice:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ byProjectKey: state.byProjectKey }),
    },
  ),
);
