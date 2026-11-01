import {
  type FilesystemBrowseEntry,
  type EnvironmentId,
  type KeybindingCommand,
  THREAD_JUMP_KEYBINDING_COMMANDS,
} from "@t3tools/contracts";
import type { SidebarThreadSortOrder } from "@t3tools/contracts/settings";
import { threadSearchSubject } from "@t3tools/client-runtime/state/thread-search";
import {
  foldSearchQuery,
  PALETTE_SECONDARY_LIMIT,
  PALETTE_THREAD_LIMIT,
  rankSearchGroups,
  scoreSearchTerms,
  scoreThreadSearch,
  type SearchMatchHint,
  type SearchTermsMatch,
  type ThreadSearchMatch,
  type ThreadSearchSubject,
} from "@t3tools/shared/paletteSearch";
import { type ReactNode } from "react";
import { sortThreads } from "../lib/threadSort";
import { formatRelativeTimeLabel } from "../timestampFormat";
import { type Project, type SidebarThreadSummary, type Thread } from "../types";

export const RECENT_THREAD_LIMIT = 12;
export const ITEM_ICON_CLASS = "size-4 text-icon-muted";
export const ADDON_ICON_CLASS = "size-4";

/**
 * The global search overlay hosts three mutually exclusive surfaces: the
 * command palette (⌘K), the project file picker (⌘P), and project content
 * search (⇧⌘F). One reducer owns open/mode state so the surfaces can never
 * stack and re-triggering a mode's shortcut toggles it closed.
 */
export type SearchOverlayMode = "command" | "files" | "content";

export interface CommandPaletteOpenIntent {
  readonly environmentId?: EnvironmentId;
  readonly kind: "add-project" | "new-thread-in" | "new-project";
}

export interface CommandPaletteUiState {
  readonly open: boolean;
  readonly mode: SearchOverlayMode;
  readonly openIntent: CommandPaletteOpenIntent | null;
}

export type CommandPaletteUiAction =
  | { readonly _tag: "SetOpen"; readonly open: boolean }
  | { readonly _tag: "ToggleMode"; readonly mode: SearchOverlayMode }
  | { readonly _tag: "OpenNewProject"; readonly environmentId?: EnvironmentId }
  | { readonly _tag: "OpenAddProject" }
  | { readonly _tag: "OpenNewThreadIn" }
  | { readonly _tag: "ClearOpenIntent" };

export function reduceCommandPaletteUiState(
  state: CommandPaletteUiState,
  action: CommandPaletteUiAction,
): CommandPaletteUiState {
  switch (action._tag) {
    case "SetOpen":
      return {
        open: action.open,
        mode: "command",
        openIntent: action.open ? state.openIntent : null,
      };
    case "ToggleMode":
      return state.open && state.mode === action.mode
        ? { open: false, mode: "command", openIntent: null }
        : { open: true, mode: action.mode, openIntent: null };
    case "OpenNewProject":
      return {
        open: true,
        mode: "command",
        openIntent: {
          kind: "new-project",
          ...(action.environmentId ? { environmentId: action.environmentId } : {}),
        },
      };
    case "OpenAddProject":
      return { open: true, mode: "command", openIntent: { kind: "add-project" } };
    case "OpenNewThreadIn":
      return { open: true, mode: "command", openIntent: { kind: "new-thread-in" } };
    case "ClearOpenIntent":
      return state.openIntent ? { ...state, openIntent: null } : state;
  }
}

export interface CommandPaletteThreadContentMatch {
  readonly source: "user" | "assistant";
  readonly snippet: string;
  readonly query: string;
}

export interface CommandPaletteItem {
  readonly kind: "action" | "submenu";
  readonly value: string;
  readonly searchTerms: ReadonlyArray<string>;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly threadContentMatch?: CommandPaletteThreadContentMatch;
  readonly timestamp?: string;
  readonly threadSearchKey?: string;
  /** Thread rows rank by this, with use history, instead of by `searchTerms`. */
  readonly threadSearch?: ThreadSearchSubject;
  /** Shown in place of the description when the match is not in the title. */
  readonly matchHint?: SearchMatchHint;
  /** Listed last in its group and never decides where the group sits. */
  readonly secondary?: boolean;
  readonly icon: ReactNode;
  readonly disabled?: boolean;
  /** Optional content rendered inline before the title text. */
  readonly titleLeadingContent?: ReactNode;
  /** Optional content rendered inline after the title text (before the timestamp). */
  readonly titleTrailingContent?: ReactNode;
  readonly shortcutCommand?: KeybindingCommand;
}

export interface CommandPaletteActionItem extends CommandPaletteItem {
  readonly kind: "action";
  readonly keepOpen?: boolean;
  readonly run: () => Promise<void>;
}

export interface CommandPaletteSubmenuItem extends CommandPaletteItem {
  readonly kind: "submenu";
  readonly addonIcon: ReactNode;
  readonly groups: ReadonlyArray<CommandPaletteGroup>;
  readonly initialQuery?: string;
}

export interface CommandPaletteGroup {
  readonly value: string;
  readonly label: string;
  readonly items: ReadonlyArray<CommandPaletteActionItem | CommandPaletteSubmenuItem>;
}

export interface CommandPaletteView {
  readonly addonIcon: ReactNode;
  readonly groups: ReadonlyArray<CommandPaletteGroup>;
  readonly initialQuery?: string;
}

export type CommandPaletteRow =
  | {
      readonly kind: "label";
      readonly key: string;
      readonly label: string;
      readonly first: boolean;
    }
  | {
      readonly kind: "item";
      readonly key: string;
      readonly item: CommandPaletteActionItem | CommandPaletteSubmenuItem;
      /** Position among enabled items, or null for disabled rows the keyboard skips. */
      readonly itemIndex: number | null;
    };

/**
 * Flattens groups into the rows a virtualized list renders. `itemValues` is the
 * highlightable item order Base UI navigates; `rowIndexByItemIndex` maps a
 * highlight back to its row for scrolling.
 */
export function buildCommandPaletteRows(groups: ReadonlyArray<CommandPaletteGroup>) {
  const rows: CommandPaletteRow[] = [];
  const itemValues: string[] = [];
  const rowIndexByItemIndex: number[] = [];
  for (const group of groups) {
    if (group.label) {
      rows.push({
        kind: "label",
        key: `group:${group.value}`,
        label: group.label,
        first: rows.length === 0,
      });
    }
    for (const item of group.items) {
      const itemIndex = item.disabled ? null : itemValues.length;
      if (itemIndex !== null) {
        itemValues.push(item.value);
        rowIndexByItemIndex.push(rows.length);
      }
      rows.push({ kind: "item", key: `${group.value}:${item.value}`, item, itemIndex });
    }
  }
  return { rows, itemValues, rowIndexByItemIndex };
}

/** The enabled item Enter should run for a highlight, whether or not its row is mounted. */
export function findHighlightedCommandPaletteItem(
  groups: ReadonlyArray<CommandPaletteGroup>,
  highlightedItemValue: string | null,
): CommandPaletteActionItem | CommandPaletteSubmenuItem | null {
  if (highlightedItemValue === null) return null;
  for (const group of groups) {
    for (const item of group.items) {
      if (item.value === highlightedItemValue && !item.disabled) return item;
    }
  }
  return null;
}

export function enumerateCommandPaletteItems(
  items: ReadonlyArray<CommandPaletteActionItem>,
): CommandPaletteActionItem[] {
  return items.map((item, index) => {
    const shortcutCommand = THREAD_JUMP_KEYBINDING_COMMANDS[index];
    if (shortcutCommand) return { ...item, shortcutCommand };

    const { shortcutCommand: _shortcutCommand, ...itemWithoutShortcut } = item;
    return itemWithoutShortcut;
  });
}

export type CommandPaletteMode = "root" | "root-browse" | "submenu" | "submenu-browse";

export function buildProjectActionItems(input: {
  projects: ReadonlyArray<Project>;
  valuePrefix: string;
  icon: (project: Project) => ReactNode;
  runProject: (project: Project) => Promise<void>;
  searchTerms?: (project: Project) => ReadonlyArray<string>;
  shortcutCommand?: KeybindingCommand;
}): CommandPaletteActionItem[] {
  return input.projects.map((project) => ({
    kind: "action",
    value: `${input.valuePrefix}:${project.environmentId}:${project.id}`,
    searchTerms: [project.title, project.workspaceRoot, ...(input.searchTerms?.(project) ?? [])],
    title: project.title,
    description: project.workspaceRoot,
    icon: input.icon(project),
    ...(input.shortcutCommand !== undefined ? { shortcutCommand: input.shortcutCommand } : {}),
    run: async () => {
      await input.runProject(project);
    },
  }));
}

export type BuildThreadActionItemsThread = Pick<
  SidebarThreadSummary,
  | "sideOfThreadId"
  | "lineage"
  | "archivedAt"
  | "branch"
  | "createdAt"
  | "environmentId"
  | "id"
  | "projectId"
  | "title"
> &
  Partial<
    Pick<
      SidebarThreadSummary,
      "pullRequests" | "linkedPullRequest" | "branchPullRequest" | "opens" | "latestUserMessageAt"
    >
  > & {
    updatedAt: string;
  };

export function buildThreadActionItems<TThread extends BuildThreadActionItemsThread>(input: {
  threads: ReadonlyArray<TThread>;
  activeThreadId?: Thread["id"];
  projectTitleById: ReadonlyMap<Project["id"], string>;
  sortOrder: SidebarThreadSortOrder;
  icon: ReactNode;
  /** Optional content rendered inline before the title text per-thread. */
  renderLeadingContent?: (thread: TThread) => ReactNode;
  /** Optional content rendered inline after the title text per-thread. */
  renderTrailingContent?: (thread: TThread) => ReactNode;
  runThread: (thread: TThread) => Promise<void>;
  /** Makes the environment searchable; pass it only with two or more environments. */
  environmentLabelOf?: (thread: TThread) => string | null;
}): CommandPaletteActionItem[] {
  const visibleThreads = sortThreads(
    input.threads.filter(
      (thread) =>
        thread.archivedAt === null &&
        !thread.sideOfThreadId &&
        thread.lineage.relationshipToParent !== "subagent",
    ),
    input.sortOrder,
  );

  return visibleThreads.map((thread) => {
    const projectTitle = input.projectTitleById.get(thread.projectId);
    const descriptionParts: string[] = [];

    if (projectTitle) {
      descriptionParts.push(projectTitle);
    }
    if (thread.branch) {
      descriptionParts.push(`#${thread.branch}`);
    }
    const isCurrent = thread.id === input.activeThreadId;
    if (isCurrent) {
      descriptionParts.push("Current thread");
    }

    const leadingContent = input.renderLeadingContent?.(thread);
    const trailingContent = input.renderTrailingContent?.(thread);

    return Object.assign(
      {
        kind: "action" as const,
        value: `thread:${thread.id}`,
        threadSearchKey: JSON.stringify([thread.environmentId, thread.id]),
        searchTerms: [thread.title],
        threadSearch: threadSearchSubject(
          {
            ...thread,
            latestUserMessageAt: thread.latestUserMessageAt ?? null,
            opens: thread.opens ?? null,
          },
          projectTitle,
          input.environmentLabelOf?.(thread),
        ),
        title: thread.title,
        description: descriptionParts.join(` · `),
        timestamp: formatRelativeTimeLabel(
          thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt,
        ),
        icon: input.icon,
      },
      leadingContent ? { titleLeadingContent: leadingContent } : {},
      trailingContent ? { titleTrailingContent: trailingContent } : {},
      // Last in its group: picking the thread already open does nothing.
      isCurrent ? { secondary: true } : {},
      {
        run: async () => {
          await input.runThread(thread);
        },
      },
    );
  });
}

export function buildThreadMessageActionItems(input: {
  readonly threadItems: ReadonlyArray<CommandPaletteActionItem>;
  readonly matches: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly threadId: Thread["id"];
    readonly messageId?: string;
    readonly source: "user" | "assistant";
    readonly snippet: string;
    readonly messageCreatedAt: string | null;
  }>;
  readonly query: string;
  readonly openMatch: (match: (typeof input.matches)[number]) => void;
}): CommandPaletteActionItem[] {
  if (input.matches.length === 0) return [];
  const items = new Map(input.threadItems.map((item) => [item.threadSearchKey, item]));
  return input.matches.flatMap((match) => {
    const key = JSON.stringify([match.environmentId, match.threadId]);
    const item = items.get(key);
    if (!item) return [];
    return [
      {
        ...item,
        value: `message:${key}:${match.messageId ?? match.source}`,
        ...(match.messageCreatedAt
          ? { timestamp: formatRelativeTimeLabel(match.messageCreatedAt) }
          : {}),
        threadContentMatch: { source: match.source, snippet: match.snippet, query: input.query },
        run: async () => {
          await item.run();
          input.openMatch(match);
        },
      },
    ];
  });
}

type PaletteItem = CommandPaletteActionItem | CommandPaletteSubmenuItem;

function rankPaletteItem(
  item: PaletteItem,
  normalizedQuery: string,
  now: number,
  options: { readonly typos: boolean },
) {
  const match = scorePaletteItem(item, normalizedQuery, now, options);
  // A row listed last in its group (the open thread) does not decide where the group sits.
  return match && item.secondary ? { ...match, groupQuality: 0 } : match;
}

function scorePaletteItem(
  item: PaletteItem,
  normalizedQuery: string,
  now: number,
  options: { readonly typos: boolean },
): (SearchTermsMatch & Partial<Pick<ThreadSearchMatch, "explain">>) | ThreadSearchMatch | null {
  if (item.threadSearch) return scoreThreadSearch(normalizedQuery, item.threadSearch, now, options);
  // The title names the item; search terms are keywords.
  const terms =
    typeof item.title === "string" && item.title !== item.searchTerms[0]
      ? [item.title, ...item.searchTerms]
      : item.searchTerms;
  return scoreSearchTerms(normalizedQuery, terms, options);
}

/**
 * Equal match classes put commands before threads, so "new" runs "New thread".
 * Message matches stay in a final group so late results cannot move earlier rows.
 */
export function filterCommandPaletteGroups(input: {
  activeGroups: ReadonlyArray<CommandPaletteGroup>;
  query: string;
  isInSubmenu: boolean;
  /** Root options are also searched when a submenu has no match. */
  allOptions?: {
    readonly rootGroups: ReadonlyArray<CommandPaletteGroup>;
    readonly nestedItems: ReadonlyArray<CommandPaletteActionItem>;
  };
  projectSearchItems: ReadonlyArray<CommandPaletteActionItem>;
  threadSearchItems: ReadonlyArray<CommandPaletteActionItem>;
  messageSearchItems?: ReadonlyArray<CommandPaletteActionItem>;
  /** Ranking time; pass the time the palette opened so rows do not reorder as time passes. */
  now?: number;
}): CommandPaletteGroup[] {
  if (input.allOptions && input.isInSubmenu) {
    const { allOptions, ...submenuInput } = input;
    const scoped = filterCommandPaletteGroups(submenuInput);
    if (scoped.length > 0 || input.query.trim().length === 0) return scoped;
    return filterCommandPaletteGroups({
      ...input,
      activeGroups: allOptions.rootGroups,
      isInSubmenu: false,
    });
  }
  const isActionsFilter = input.query.startsWith(">");
  const searchQuery = isActionsFilter ? input.query.slice(1) : input.query;
  const normalizedQuery = foldSearchQuery(searchQuery);

  if (normalizedQuery.length === 0) {
    if (isActionsFilter) {
      return input.activeGroups.filter((group) => group.value === "actions");
    }
    return [...input.activeGroups];
  }

  let baseGroups = [...input.activeGroups];
  if (isActionsFilter) {
    baseGroups = baseGroups.filter((group) => group.value === "actions");
  } else if (!input.isInSubmenu) {
    baseGroups = baseGroups.filter((group) => group.value !== "recent-threads");
  }

  const searchableGroups = [...baseGroups];
  const searchesEverything = !input.isInSubmenu && !isActionsFilter;
  // On equal match classes, groups keep this order: threads, what people search
  // for most, right after commands.
  if (searchesEverything) {
    if (input.allOptions && input.allOptions.nestedItems.length > 0) {
      searchableGroups.push({
        value: "nested-search",
        label: "Suggestions",
        items: input.allOptions.nestedItems,
      });
    }
    if (input.threadSearchItems.length > 0) {
      searchableGroups.push({
        value: "threads-search",
        label: "Threads",
        items: input.threadSearchItems,
      });
    }
    if (input.projectSearchItems.length > 0) {
      searchableGroups.push({
        value: "projects-search",
        label: "Projects",
        items: input.projectSearchItems,
      });
    }
  }

  const now = input.now ?? Date.now();
  const ranked = rankSearchGroups(
    searchableGroups.map((group) => ({ group, items: group.items })),
    (item, options) => rankPaletteItem(item, normalizedQuery, now, options),
  );
  const threadsMatch = ranked.some(({ group }) => group.value === "threads-search");
  const groups = ranked.map(({ group, ranked: items }): CommandPaletteGroup => {
    const limit =
      group.value === "threads-search"
        ? PALETTE_THREAD_LIMIT
        : group.value === "nested-search" || (searchesEverything && threadsMatch)
          ? PALETTE_SECONDARY_LIMIT
          : items.length;
    return {
      value: group.value,
      label: group.label,
      // Secondary items stay below the rest; the sort is stable, so score order holds.
      items: items
        .toSorted(
          (left, right) =>
            Number(left.item.secondary ?? false) - Number(right.item.secondary ?? false),
        )
        .slice(0, limit)
        .map(({ item, match }) => {
          if (match.ranges.length > 0) return item;
          // Built only for the rows shown.
          const matchHint = match.explain?.();
          return matchHint ? { ...item, matchHint } : item;
        }),
    };
  });

  if (!searchesEverything) return groups;
  // A thread already shown by its metadata does not need a second message row.
  const listedThreads = new Set(
    groups
      .filter((group) => group.value === "threads-search")
      .flatMap((group) =>
        group.items.flatMap((item) => (item.threadSearchKey ? [item.threadSearchKey] : [])),
      ),
  );
  const messageItems =
    input.messageSearchItems?.filter(
      (item) => !item.threadSearchKey || !listedThreads.has(item.threadSearchKey),
    ) ?? [];
  // Indexed word matches need not contain the query as one contiguous phrase.
  return messageItems.length === 0
    ? groups
    : [...groups, { value: "messages-search", label: "In messages", items: messageItems }];
}

/** Only query message history when the palette can display global search results. */
export function commandPaletteMessageSearchQuery(input: {
  readonly query: string;
  readonly isBrowsing: boolean;
  readonly isCloning: boolean;
  readonly submenuGroups: ReadonlyArray<CommandPaletteGroup> | null;
}): string {
  if (input.isBrowsing || input.isCloning || input.query.startsWith(">")) return "";
  if (
    input.submenuGroups !== null &&
    filterCommandPaletteGroups({
      activeGroups: input.submenuGroups,
      query: input.query,
      isInSubmenu: true,
      projectSearchItems: [],
      threadSearchItems: [],
    }).length > 0
  )
    return "";
  return input.query;
}

/** Searchable submenu actions retain their original handler and environment target. */
export function buildNestedSearchItems(
  items: ReadonlyArray<CommandPaletteActionItem | CommandPaletteSubmenuItem>,
  query: string,
): CommandPaletteActionItem[] {
  const topLevelNames = new Set(items.map((item) => item.title));
  const foldedQuery = foldSearchQuery(query);
  return items.flatMap((parent) => {
    if (parent.kind !== "submenu" || typeof parent.title !== "string") return [];
    const stem = parent.title.replace(/(\.\.\.|…)$/u, "");
    // Naming only the submenu should offer that row, not every option inside it.
    if (foldSearchQuery(stem).startsWith(foldedQuery)) return [];
    const prefix = stem === parent.title ? `${stem}: ` : `${stem.trimEnd()} `;
    return parent.groups.flatMap((group) =>
      group.items.flatMap((child) => {
        if (child.kind !== "action" || typeof child.title !== "string") return [];
        const title = `${prefix}${child.title}`;
        if (topLevelNames.has(title)) return [];
        return [{ ...child, title, searchTerms: [title] }];
      }),
    );
  });
}

export function buildBrowseGroups(input: {
  browseEntries: ReadonlyArray<FilesystemBrowseEntry>;
  browseQuery: string;
  canBrowseUp: boolean;
  upIcon: ReactNode;
  directoryIcon: ReactNode;
  browseUp: () => void | Promise<void>;
  browseTo: (name: string) => void | Promise<void>;
}): CommandPaletteGroup[] {
  const items: CommandPaletteActionItem[] = [];

  if (input.canBrowseUp) {
    items.push({
      kind: "action",
      value: "browse:up",
      searchTerms: [input.browseQuery, ".."],
      title: "..",
      icon: input.upIcon,
      keepOpen: true,
      run: async () => {
        await input.browseUp();
      },
    });
  }

  for (const entry of input.browseEntries) {
    items.push({
      kind: "action",
      value: `browse:${entry.fullPath}`,
      searchTerms: [input.browseQuery, entry.fullPath, entry.name],
      title: entry.name,
      icon: input.directoryIcon,
      keepOpen: true,
      run: async () => {
        await input.browseTo(entry.name);
      },
    });
  }

  return [{ value: "directories", label: "Directories", items }];
}

export function getCommandPaletteMode(input: {
  currentView: CommandPaletteView | null;
  isBrowsing: boolean;
}): CommandPaletteMode {
  if (input.currentView) {
    return input.isBrowsing ? "submenu-browse" : "submenu";
  }
  return input.isBrowsing ? "root-browse" : "root";
}

export function buildRootGroups(input: {
  actionItems: ReadonlyArray<CommandPaletteActionItem | CommandPaletteSubmenuItem>;
  recentThreadItems: ReadonlyArray<CommandPaletteActionItem>;
}): CommandPaletteGroup[] {
  const groups: CommandPaletteGroup[] = [];
  if (input.actionItems.length > 0) {
    groups.push({ value: "actions", label: "Actions", items: input.actionItems });
  }
  if (input.recentThreadItems.length > 0) {
    groups.push({
      value: "recent-threads",
      label: "Recent Threads",
      items: input.recentThreadItems,
    });
  }
  return groups;
}

export function getCommandPaletteInputPlaceholder(mode: CommandPaletteMode): string {
  switch (mode) {
    case "root":
      return "Search commands, projects, and threads...";
    case "root-browse":
      return "Enter project path (e.g. ~/projects/my-app)";
    case "submenu":
      return "Search...";
    case "submenu-browse":
      return "Enter path (e.g. ~/projects/my-app)";
  }
}
