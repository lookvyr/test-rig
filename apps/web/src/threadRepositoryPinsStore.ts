import type { ThreadRepository } from "@t3tools/client-runtime/state/thread-repositories";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";

const NO_PINS: ReadonlyArray<ThreadRepository> = Object.freeze([]);

const pinsKey = (ref: ScopedThreadRef) => `${ref.environmentId}\u0000${ref.threadId}`;

interface ThreadRepositoryPinsStore {
  /** Kept for the session only: a reload shows the repositories the thread changed. */
  readonly pinsByThread: Readonly<Record<string, ReadonlyArray<ThreadRepository>>>;
  readonly pin: (ref: ScopedThreadRef, repository: ThreadRepository) => void;
  readonly unpin: (ref: ScopedThreadRef, repositoryKey: string) => void;
}

/** Repositories picked from "Other repositories..." in a thread's details, per thread. */
export const useThreadRepositoryPinsStore = create<ThreadRepositoryPinsStore>((set) => ({
  pinsByThread: {},
  pin: (ref, repository) =>
    set((state) => {
      const key = pinsKey(ref);
      const current = state.pinsByThread[key] ?? NO_PINS;
      if (current.some((entry) => entry.key === repository.key)) return state;
      return { pinsByThread: { ...state.pinsByThread, [key]: [...current, repository] } };
    }),
  unpin: (ref, repositoryKey) =>
    set((state) => {
      const key = pinsKey(ref);
      const current = state.pinsByThread[key] ?? NO_PINS;
      const next = current.filter((entry) => entry.key !== repositoryKey);
      if (next.length === current.length) return state;
      return { pinsByThread: { ...state.pinsByThread, [key]: next } };
    }),
}));

export function useThreadRepositoryPins(ref: ScopedThreadRef): ReadonlyArray<ThreadRepository> {
  return useThreadRepositoryPinsStore((state) => state.pinsByThread[pinsKey(ref)] ?? NO_PINS);
}
