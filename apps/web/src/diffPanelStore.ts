import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef, TurnId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

export type DiffPanelSelection =
  | { kind: "branch"; baseRef: string | null }
  | { kind: "commit"; commitRef: string | null }
  | { kind: "working-tree" | "unstaged" | "staged" }
  | { kind: "latest-turn" }
  | { kind: "turn"; turnId: TurnId; filePath: string | null; revealRequestId: number };

export type GitReviewScope = "working-tree" | "unstaged" | "staged" | "branch" | "commit";
export type DiffRenderMode = "stacked" | "split";

export interface DiffPanelFileSelection {
  scope: string;
  path: string;
  turnRevealRequestId: number;
  revealRequestId: number;
}

const DEFAULT_SELECTION: DiffPanelSelection = { kind: "branch", baseRef: null };
const DEFAULT_WORKING_TREE_SELECTION: DiffPanelSelection = { kind: "working-tree" };

interface DiffPanelStoreState {
  byThreadKey: Record<string, DiffPanelSelection>;
  branchBaseRefByThreadKey: Record<string, string | null>;
  fileSelectionByThreadKey: Record<string, DiffPanelFileSelection>;
  diffRenderMode: DiffRenderMode;
  setDiffRenderMode: (mode: DiffRenderMode) => void;
  selectGitScope: (ref: ScopedThreadRef, scope: GitReviewScope) => void;
  selectBranchBaseRef: (ref: ScopedThreadRef, baseRef: string | null) => void;
  selectCommit: (ref: ScopedThreadRef, commitRef: string | null) => void;
  selectLatestTurn: (ref: ScopedThreadRef) => void;
  selectTurn: (ref: ScopedThreadRef, turnId: TurnId, filePath?: string) => void;
  selectFile: (
    ref: ScopedThreadRef,
    selection: Omit<DiffPanelFileSelection, "revealRequestId">,
  ) => void;
  reconcileTurnSelection: (ref: ScopedThreadRef, availableTurnIds: ReadonlyArray<TurnId>) => void;
  removeThread: (ref: ScopedThreadRef) => void;
}

function normalizeBaseRef(baseRef: string | null): string | null {
  const normalized = baseRef?.trim();
  return normalized ? normalized : null;
}

export const useDiffPanelStore = create<DiffPanelStoreState>()(
  persist(
    (set) => ({
      byThreadKey: {},
      branchBaseRefByThreadKey: {},
      fileSelectionByThreadKey: {},
      diffRenderMode: "stacked",
      setDiffRenderMode: (diffRenderMode) => set({ diffRenderMode }),
      selectGitScope: (ref, scope) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          const previous = state.byThreadKey[threadKey];
          const previousBaseRef =
            previous?.kind === "branch"
              ? previous.baseRef
              : (state.branchBaseRefByThreadKey[threadKey] ?? null);
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [threadKey]:
                scope === "branch"
                  ? { kind: "branch", baseRef: previousBaseRef }
                  : scope === "commit"
                    ? {
                        kind: "commit",
                        commitRef: previous?.kind === "commit" ? previous.commitRef : null,
                      }
                    : { kind: scope },
            },
            branchBaseRefByThreadKey:
              previous?.kind === "branch"
                ? { ...state.branchBaseRefByThreadKey, [threadKey]: previous.baseRef }
                : state.branchBaseRefByThreadKey,
          };
        }),
      selectBranchBaseRef: (ref, baseRef) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          const normalizedBaseRef = normalizeBaseRef(baseRef);
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [threadKey]: { kind: "branch", baseRef: normalizedBaseRef },
            },
            branchBaseRefByThreadKey: {
              ...state.branchBaseRefByThreadKey,
              [threadKey]: normalizedBaseRef,
            },
          };
        }),
      selectCommit: (ref, commitRef) =>
        set((state) => ({
          byThreadKey: {
            ...state.byThreadKey,
            [scopedThreadKey(ref)]: { kind: "commit", commitRef: normalizeBaseRef(commitRef) },
          },
        })),
      selectLatestTurn: (ref) =>
        set((state) => ({
          byThreadKey: {
            ...state.byThreadKey,
            [scopedThreadKey(ref)]: { kind: "latest-turn" },
          },
        })),
      selectTurn: (ref, turnId, filePath) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          const previous = state.byThreadKey[threadKey];
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [threadKey]: {
                kind: "turn",
                turnId,
                filePath: filePath?.trim() || null,
                revealRequestId:
                  Math.max(
                    previous?.kind === "turn" ? previous.revealRequestId : 0,
                    state.fileSelectionByThreadKey[threadKey]?.turnRevealRequestId ?? 0,
                  ) + 1,
              },
            },
          };
        }),
      selectFile: (ref, selection) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          return {
            fileSelectionByThreadKey: {
              ...state.fileSelectionByThreadKey,
              [threadKey]: {
                ...selection,
                revealRequestId:
                  (state.fileSelectionByThreadKey[threadKey]?.revealRequestId ?? 0) + 1,
              },
            },
          };
        }),
      reconcileTurnSelection: (ref, availableTurnIds) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          const previous = state.byThreadKey[threadKey];
          const latestTurnId = availableTurnIds[0];
          if (
            previous?.kind !== "turn" ||
            latestTurnId === undefined ||
            availableTurnIds.includes(previous.turnId)
          ) {
            return state;
          }
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [threadKey]: { ...previous, turnId: latestTurnId },
            },
          };
        }),
      removeThread: (ref) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          if (
            !(threadKey in state.byThreadKey) &&
            !(threadKey in state.branchBaseRefByThreadKey) &&
            !(threadKey in state.fileSelectionByThreadKey)
          ) {
            return state;
          }
          const { [threadKey]: _removed, ...byThreadKey } = state.byThreadKey;
          const { [threadKey]: _removedBaseRef, ...branchBaseRefByThreadKey } =
            state.branchBaseRefByThreadKey;
          const { [threadKey]: _removedFileSelection, ...fileSelectionByThreadKey } =
            state.fileSelectionByThreadKey;
          return { byThreadKey, branchBaseRefByThreadKey, fileSelectionByThreadKey };
        }),
    }),
    {
      name: "t3code:diff-panel-state:v1",
      version: 2,
      migrate: (persistedState) => {
        const state = persistedState as Partial<DiffPanelStoreState> | null;
        return {
          ...state,
          byThreadKey: Object.fromEntries(
            Object.entries(state?.byThreadKey ?? {}).map(([key, selection]) => [
              key,
              selection.kind === "unstaged" ? { kind: "working-tree" } : selection,
            ]),
          ),
        };
      },
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({
        byThreadKey: state.byThreadKey,
        branchBaseRefByThreadKey: state.branchBaseRefByThreadKey,
        fileSelectionByThreadKey: state.fileSelectionByThreadKey,
        diffRenderMode: state.diffRenderMode,
      }),
    },
  ),
);

export function resolveDiffPanelTurnId(
  selection: DiffPanelSelection,
  latestTurnId: TurnId | null | undefined,
): TurnId | null {
  return selection.kind === "latest-turn"
    ? (latestTurnId ?? null)
    : selection.kind === "turn"
      ? selection.turnId
      : null;
}

export function selectThreadDiffPanelSelection(
  byThreadKey: Record<string, DiffPanelSelection>,
  ref: ScopedThreadRef | null | undefined,
  hasWorkingTreeChanges = false,
): DiffPanelSelection {
  if (!ref) return DEFAULT_SELECTION;
  return (
    byThreadKey[scopedThreadKey(ref)] ??
    (hasWorkingTreeChanges ? DEFAULT_WORKING_TREE_SELECTION : DEFAULT_SELECTION)
  );
}
