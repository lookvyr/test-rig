import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { PreviewSessionSnapshot, ScopedThreadRef } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { resolveStorage } from "./lib/storage";
import { randomUUID } from "./lib/utils";
import type { RightPanelSurface } from "./rightPanelStore";

export type ClosedView =
  | {
      kind: "panel-tab";
      threadRef: ScopedThreadRef;
      surface: Exclude<RightPanelSurface, { kind: "terminal" }>;
    }
  | { kind: "browser"; threadRef: ScopedThreadRef; snapshot: PreviewSessionSnapshot };
export type ClosedViewEntry = ClosedView & { id: string };

const sameTarget = (entry: ClosedView, view: ClosedView) =>
  entry.kind === view.kind &&
  scopedThreadKey(entry.threadRef) === scopedThreadKey(view.threadRef) &&
  (entry.kind === "browser" && view.kind === "browser"
    ? entry.snapshot.tabId === view.snapshot.tabId
    : entry.kind === "panel-tab" &&
      view.kind === "panel-tab" &&
      entry.surface.id === view.surface.id);

const isThreadRef = Schema.is(ScopedThreadRef);
const isSnapshot = Schema.is(PreviewSessionSnapshot);

function validEntry(value: unknown): value is ClosedViewEntry {
  if (
    !value ||
    typeof value !== "object" ||
    !("id" in value) ||
    typeof value.id !== "string" ||
    !("threadRef" in value) ||
    !isThreadRef(value.threadRef)
  )
    return false;
  if ("kind" in value && value.kind === "browser")
    return "snapshot" in value && isSnapshot(value.snapshot);
  if (!("kind" in value) || value.kind !== "panel-tab" || !("surface" in value)) return false;
  const surface = value.surface as Partial<RightPanelSurface> | null;
  if (!surface || typeof surface.id !== "string") return false;
  if (surface.kind === "file")
    return (
      typeof surface.relativePath === "string" &&
      surface.id === `file:${surface.relativePath}` &&
      (surface.revealLine === null || Number.isSafeInteger(surface.revealLine)) &&
      Number.isSafeInteger(surface.revealRequestId)
    );
  if (surface.kind === "preview")
    return surface.id === "browser:new" && surface.resourceId === null;
  return (
    ["diff", "files", "agents", "side-chat", "pull-request"].includes(surface.kind ?? "") &&
    surface.id === surface.kind
  );
}

export const useClosedViewStore = create<{
  entries: ClosedViewEntry[];
  remember: (view: ClosedView) => string;
  remove: (id: string) => void;
  defer: (id: string) => void;
}>()(
  persist(
    (set) => ({
      entries: [],
      remember: (view) => {
        const id = randomUUID();
        set((state) => ({
          entries: [
            { ...view, id },
            ...state.entries.filter((entry) => !sameTarget(entry, view)),
          ].slice(0, 20),
        }));
        return id;
      },
      remove: (id) =>
        set((state) => ({ entries: state.entries.filter((entry) => entry.id !== id) })),
      defer: (id) =>
        set((state) => {
          const entry = state.entries.find((entry) => entry.id === id);
          return entry
            ? { entries: [...state.entries.filter((entry) => entry.id !== id), entry] }
            : state;
        }),
    }),
    {
      name: "test-rig:closed-views:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      // Private browsing may be restored during this session, but never after a reload.
      partialize: ({ entries }) => ({
        entries: entries.filter(
          (entry) => entry.kind !== "browser" || entry.snapshot.profileId !== "incognito",
        ),
      }),
      merge: (persisted, current) => {
        const entries = (persisted as { entries?: unknown } | null)?.entries;
        return {
          ...current,
          entries: Array.isArray(entries)
            ? entries
                .filter(validEntry)
                .filter(
                  (entry) => entry.kind !== "browser" || entry.snapshot.profileId !== "incognito",
                )
                .slice(0, 20)
            : [],
        };
      },
    },
  ),
);
