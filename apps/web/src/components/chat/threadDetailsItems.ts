import type { ClientSettings } from "@t3tools/contracts";

// Ids are stored in client settings and match upstream T3 Code's, so never rename one.
export const THREAD_DETAILS_ITEMS = [
  { id: "environment", label: "Environment and worktree", defaultVisible: true },
  { id: "openIn", label: "Open in editor", defaultVisible: true },
  { id: "scripts", label: "Project scripts", defaultVisible: true },
  { id: "branch", label: "Branch and pull request", defaultVisible: true },
  { id: "changes", label: "Changes", defaultVisible: true },
  { id: "servers", label: "Servers", defaultVisible: true },
  { id: "automations", label: "Automations", defaultVisible: true },
  { id: "lineage", label: "Lineage", defaultVisible: true },
  { id: "context", label: "Context window", defaultVisible: true },
] as const;

type ThreadDetailsItem = (typeof THREAD_DETAILS_ITEMS)[number];
export type ThreadDetailsItemId = ThreadDetailsItem["id"];
export type ThreadDetailsVisibility = Readonly<Record<ThreadDetailsItemId, boolean>>;
type ThreadDetailsItemSettings = Pick<ClientSettings, "threadDetailsItems">;

export function resolveThreadDetailsVisibility(
  settings: ThreadDetailsItemSettings,
): ThreadDetailsVisibility {
  return Object.fromEntries(
    THREAD_DETAILS_ITEMS.map((item) => [
      item.id,
      settings.threadDetailsItems[item.id] ?? item.defaultVisible,
    ]),
  ) as Record<ThreadDetailsItemId, boolean>;
}

/** Stores only choices that differ from the default, so a later default change reaches everyone else. */
export function setThreadDetailsItem(
  settings: ThreadDetailsItemSettings,
  item: ThreadDetailsItem,
  visible: boolean,
): ClientSettings["threadDetailsItems"] {
  const { [item.id]: _previous, ...rest } = settings.threadDetailsItems;
  return visible === item.defaultVisible ? rest : { ...rest, [item.id]: visible };
}

export function isDefaultThreadDetailsVisibility(visibility: ThreadDetailsVisibility) {
  return THREAD_DETAILS_ITEMS.every((item) => visibility[item.id] === item.defaultVisible);
}
