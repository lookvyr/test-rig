import type { EnvironmentId, ProjectId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import { createMemoryStorage, type StateStorage } from "./lib/storage";
import type { DraftId } from "./composerDraftStore";
import { randomUUID } from "./lib/utils";

export interface PullRequestWorkspaceScope {
  environmentId: EnvironmentId;
  cwd: string;
  /** The canonical URL returned by the hosting provider, never a bare PR number. */
  reference: string;
}

export interface PullRequestNote {
  id: string;
  body: string;
  headSha: string;
  selected: boolean;
  filePath?: string;
  line?: number;
  side?: "old" | "new";
}

export interface PullRequestLinkedTarget {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  threadId: ThreadId;
  draftId?: DraftId;
}

export type PullRequestNoteDraft = Omit<PullRequestNote, "id" | "selected">;

export interface PullRequestWorkspaceEntry {
  scope: PullRequestWorkspaceScope;
  instructions: string;
  noteDraft: PullRequestNoteDraft | null;
  notes: PullRequestNote[];
  selectedFilePath: string | null;
  tab: "summary" | "code" | "timeline";
  linkedTarget: PullRequestLinkedTarget | null;
  linkedAt?: number;
}

export const EMPTY_PULL_REQUEST_WORKSPACE = {
  instructions: "",
  noteDraft: null,
  notes: [] as PullRequestNote[],
  selectedFilePath: null,
  tab: "summary" as const,
  linkedTarget: null,
};
export const PULL_REQUEST_WORKSPACE_STORAGE_KEY = "test-rig:pull-request-workspaces:v1";

export function canonicalPullRequestReference(reference: string): string {
  const url = new URL(reference);
  const match = /^(\/[^/]+\/[^/]+\/pull\/\d+)(?:\/.*)?$/i.exec(url.pathname);
  url.pathname = match?.[1]?.toLowerCase() ?? url.pathname.replace(/\/$/, "");
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function pullRequestWorkspaceKey(scope: PullRequestWorkspaceScope): string {
  return JSON.stringify([
    scope.environmentId,
    scope.cwd.replace(/\/$/, ""),
    canonicalPullRequestReference(scope.reference),
  ]);
}

export function isPullRequestNoteStale(note: PullRequestNote, headSha: string): boolean {
  return note.headSha !== headSha;
}

export function findPullRequestWorkspaceForThread(
  entries: Record<string, PullRequestWorkspaceEntry>,
  threadRef: ScopedThreadRef,
  preferredWorkspaceKey?: string,
): PullRequestWorkspaceEntry | null {
  if (preferredWorkspaceKey !== undefined) {
    const entry = entries[preferredWorkspaceKey];
    return entry?.linkedTarget?.environmentId === threadRef.environmentId &&
      entry.linkedTarget.threadId === threadRef.threadId
      ? entry
      : null;
  }
  return Object.values(entries).reduce<PullRequestWorkspaceEntry | null>((latest, entry) => {
    if (
      entry.linkedTarget?.environmentId !== threadRef.environmentId ||
      entry.linkedTarget.threadId !== threadRef.threadId
    )
      return latest;
    return !latest || (entry.linkedAt ?? 0) >= (latest.linkedAt ?? 0) ? entry : latest;
  }, null);
}

interface PullRequestWorkspaceState {
  entriesByKey: Record<string, PullRequestWorkspaceEntry>;
  ensureWorkspace: (scope: PullRequestWorkspaceScope) => void;
  setInstructions: (scope: PullRequestWorkspaceScope, instructions: string) => void;
  setTab: (scope: PullRequestWorkspaceScope, tab: PullRequestWorkspaceEntry["tab"]) => void;
  setSelectedFile: (scope: PullRequestWorkspaceScope, path: string | null) => void;
  addNote: (
    scope: PullRequestWorkspaceScope,
    note: Omit<PullRequestNote, "id" | "selected"> & { selected?: boolean },
  ) => string;
  updateNote: (
    scope: PullRequestWorkspaceScope,
    id: string,
    patch: Partial<Omit<PullRequestNote, "id">>,
  ) => void;
  removeNote: (scope: PullRequestWorkspaceScope, id: string) => void;
  setNoteDraft: (scope: PullRequestWorkspaceScope, draft: PullRequestNoteDraft | null) => void;
  link: (scope: PullRequestWorkspaceScope, target: PullRequestLinkedTarget) => void;
}

const PersistedEntry = Schema.Struct({
  scope: Schema.Struct({
    environmentId: Schema.String,
    cwd: Schema.String,
    reference: Schema.String,
  }),
  instructions: Schema.String,
  noteDraft: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        body: Schema.String,
        headSha: Schema.String,
        filePath: Schema.optionalKey(Schema.String),
        line: Schema.optionalKey(Schema.Number),
        side: Schema.optionalKey(Schema.Literals(["old", "new"])),
      }),
    ),
  ),
  notes: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      body: Schema.String,
      headSha: Schema.String,
      selected: Schema.Boolean,
      filePath: Schema.optionalKey(Schema.String),
      line: Schema.optionalKey(Schema.Number),
      side: Schema.optionalKey(Schema.Literals(["old", "new"])),
    }),
  ),
  selectedFilePath: Schema.NullOr(Schema.String),
  tab: Schema.Literals(["summary", "code", "timeline"]),
  linkedAt: Schema.optionalKey(Schema.Number),
  linkedTarget: Schema.NullOr(
    Schema.Struct({
      environmentId: Schema.String,
      projectId: Schema.String,
      threadId: Schema.String,
      draftId: Schema.optionalKey(Schema.String),
    }),
  ),
});
const decodePersisted = Schema.decodeUnknownOption(
  Schema.Struct({
    entriesByKey: Schema.Record(Schema.String, PersistedEntry),
  }),
);

export function createPullRequestWorkspaceStore(storage: StateStorage) {
  return create<PullRequestWorkspaceState>()(
    persist(
      (set) => {
        const update = (
          scope: PullRequestWorkspaceScope,
          change: (entry: PullRequestWorkspaceEntry) => PullRequestWorkspaceEntry,
        ) => {
          const key = pullRequestWorkspaceKey(scope);
          set((state) => ({
            entriesByKey: {
              ...state.entriesByKey,
              [key]: change(
                state.entriesByKey[key] ?? {
                  ...EMPTY_PULL_REQUEST_WORKSPACE,
                  scope: { ...scope, reference: canonicalPullRequestReference(scope.reference) },
                  notes: [],
                },
              ),
            },
          }));
        };
        return {
          entriesByKey: {},
          ensureWorkspace: (scope) => update(scope, (entry) => entry),
          setInstructions: (scope, instructions) =>
            update(scope, (entry) => ({ ...entry, instructions })),
          setTab: (scope, tab) => update(scope, (entry) => ({ ...entry, tab })),
          setSelectedFile: (scope, selectedFilePath) =>
            update(scope, (entry) => ({ ...entry, selectedFilePath })),
          addNote: (scope, note) => {
            const id = randomUUID();
            update(scope, (entry) => ({
              ...entry,
              notes: [...entry.notes, { ...note, selected: note.selected ?? true, id }],
            }));
            return id;
          },
          updateNote: (scope, id, patch) =>
            update(scope, (entry) => ({
              ...entry,
              notes: entry.notes.map((note) => (note.id === id ? { ...note, ...patch } : note)),
            })),
          removeNote: (scope, id) =>
            update(scope, (entry) => ({
              ...entry,
              notes: entry.notes.filter((note) => note.id !== id),
            })),
          setNoteDraft: (scope, noteDraft) => update(scope, (entry) => ({ ...entry, noteDraft })),
          link: (scope, linkedTarget) =>
            update(scope, (entry) => ({ ...entry, linkedTarget, linkedAt: Date.now() })),
        };
      },
      {
        name: PULL_REQUEST_WORKSPACE_STORAGE_KEY,
        version: 1,
        storage: createJSONStorage(() => storage),
        partialize: (state) => ({ entriesByKey: state.entriesByKey }),
        merge: (persisted, current) => {
          const decoded = decodePersisted(persisted);
          return Option.isSome(decoded)
            ? {
                ...current,
                entriesByKey: decoded.value.entriesByKey as Record<
                  string,
                  PullRequestWorkspaceEntry
                >,
              }
            : current;
        },
      },
    ),
  );
}

export const usePullRequestWorkspaceStore = createPullRequestWorkspaceStore(
  typeof localStorage === "undefined" ? createMemoryStorage() : localStorage,
);
