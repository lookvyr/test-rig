import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { resolveStorage } from "../../lib/storage";

export interface PullRequestSelection {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  projectName: string;
  cwd: string;
  reference: string;
}

export interface PullRequestQueueFilters {
  projectKey: string;
  state: "open" | "closed" | "merged" | "all";
  involvement: "all" | "authored" | "review-requested";
  search: string;
}

export const DEFAULT_QUEUE_FILTERS: PullRequestQueueFilters = {
  projectKey: "all",
  state: "open",
  involvement: "all",
  search: "",
};

interface QueueState {
  filters: PullRequestQueueFilters;
  selection: PullRequestSelection | null;
  panelOpen: boolean;
  panelExpanded: boolean;
  setFilters: (filters: Partial<PullRequestQueueFilters>) => void;
  select: (selection: PullRequestSelection) => void;
  clearSelection: () => void;
  setPanelOpen: (open: boolean) => void;
  toggleExpanded: () => void;
}

export const usePullRequestQueueStore = create<QueueState>()(
  persist(
    (set) => ({
      filters: DEFAULT_QUEUE_FILTERS,
      selection: null,
      panelOpen: false,
      panelExpanded: false,
      setFilters: (patch) =>
        set((state) => ({
          filters: { ...state.filters, ...patch },
          ...(patch.projectKey &&
          patch.projectKey !== "all" &&
          state.selection &&
          patch.projectKey !==
            pullRequestProjectKey(state.selection.environmentId, state.selection.projectId)
            ? { selection: null, panelOpen: false, panelExpanded: false }
            : {}),
        })),
      select: (selection) => set({ selection, panelOpen: true, panelExpanded: false }),
      clearSelection: () => set({ selection: null, panelOpen: false, panelExpanded: false }),
      setPanelOpen: (panelOpen) => set({ panelOpen, panelExpanded: false }),
      toggleExpanded: () => set((state) => ({ panelExpanded: !state.panelExpanded })),
    }),
    {
      name: "test-rig:pull-request-queue",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window === "undefined" ? null : window.localStorage),
      ),
    },
  ),
);

export function pullRequestProjectKey(environmentId: EnvironmentId, projectId: ProjectId) {
  return JSON.stringify([environmentId, projectId]);
}
