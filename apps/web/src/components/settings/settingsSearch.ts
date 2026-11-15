export type SettingsPath =
  | "/settings/general"
  | "/settings/appearance"
  | "/settings/chat"
  | "/settings/diffs"
  | "/settings/keybindings"
  | "/settings/providers"
  | "/settings/tools"
  | "/settings/threads"
  | "/settings/browser"
  | "/settings/scheduled-tasks"
  | "/settings/source-control"
  | "/settings/worktrees"
  | "/settings/connections"
  | "/settings/access"
  | "/settings/maintenance"
  | "/settings/labs"
  | "/settings/about"
  | "/settings/archived";

export interface SettingsSearchItem {
  readonly id: string;
  readonly title: string;
  readonly to: SettingsPath;
  readonly targetId?: string;
}

/**
 * Section labels. The sidebar nav, breadcrumb, and search-result subtitles all
 * render from this record, so each label exists once.
 */
export const SETTINGS_SECTION_LABELS: Readonly<Record<SettingsPath, string>> = {
  "/settings/general": "General",
  "/settings/appearance": "Appearance",
  "/settings/chat": "Chat",
  "/settings/diffs": "Diffs & pull requests",
  "/settings/keybindings": "Keybindings",
  "/settings/providers": "Providers",
  "/settings/tools": "Tools",
  "/settings/threads": "Threads",
  "/settings/browser": "Browser",
  "/settings/scheduled-tasks": "Scheduled tasks",
  "/settings/source-control": "Source control",
  "/settings/worktrees": "Worktrees",
  "/settings/connections": "Environments",
  "/settings/access": "Sharing & access",
  "/settings/maintenance": "Maintenance",
  "/settings/labs": "Labs",
  "/settings/about": "About",
  "/settings/archived": "Archive",
};

/** Sidebar nav order. Hidden headings still name their group for screen readers. */
export const SETTINGS_NAV_GROUPS: ReadonlyArray<{
  readonly heading: string;
  readonly headingHidden?: true;
  readonly paths: ReadonlyArray<SettingsPath>;
}> = [
  {
    heading: "Preferences",
    headingHidden: true,
    paths: [
      "/settings/general",
      "/settings/appearance",
      "/settings/chat",
      "/settings/diffs",
      "/settings/keybindings",
    ],
  },
  {
    heading: "Agents",
    paths: [
      "/settings/providers",
      "/settings/tools",
      "/settings/threads",
      "/settings/browser",
      "/settings/scheduled-tasks",
    ],
  },
  {
    heading: "Code",
    paths: ["/settings/source-control", "/settings/worktrees"],
  },
  {
    heading: "Connections",
    paths: ["/settings/connections", "/settings/access"],
  },
  {
    heading: "More",
    headingHidden: true,
    paths: ["/settings/maintenance", "/settings/labs", "/settings/about", "/settings/archived"],
  },
];

/** Pages that moved; old links and bookmarks redirect here. */
export const MOVED_SETTINGS_PATHS: Readonly<Record<string, SettingsPath>> = {
  "/settings/beta": "/settings/labs",
};

/**
 * Every searchable setting, in result order. This catalog is the single
 * source of truth for anchor ids and visible titles: panels render both via
 * `searchableSetting`, so a retitle (or, later, a translation pass) happens
 * here once instead of separately in the panel and the index.
 */
export const SETTINGS_SEARCH_ITEMS = [
  { id: "tool-call-visibility", title: "Tool calls in chat", to: "/settings/chat" },
  {
    id: "browser-profiles",
    title: "Browser profiles",
    to: "/settings/browser",
    targetId: "browser-profiles",
  },
  {
    id: "browser-search",
    title: "Search engine",
    to: "/settings/browser",
    targetId: "browser-search",
  },
  { id: "scheduled-tasks", title: "Scheduled tasks", to: "/settings/scheduled-tasks" },
  {
    id: "color-scheme",
    title: "Color scheme",
    to: "/settings/appearance",
    // The scheme tiles sit at the top of the Appearance section.
    targetId: "appearance",
  },
  {
    id: "theme",
    title: "Themes",
    to: "/settings/appearance",
    // Theme cards live directly under the scheme tiles; the section is the
    // stable scroll destination for both.
    targetId: "appearance",
  },
  {
    // Prefixed because the slider control already owns the `glass-opacity` id.
    id: "setting-glass-opacity",
    title: "Glass opacity",
    to: "/settings/appearance",
  },
  {
    id: "environment-identification",
    title: "Environment identification",
    to: "/settings/appearance",
    // The setting is stage-dependent, so its parent section is the stable destination.
    targetId: "appearance-interface",
  },
  {
    id: "interface-font",
    title: "Interface font",
    to: "/settings/appearance",
  },
  {
    id: "prompt-font",
    title: "Prompt font",
    to: "/settings/appearance",
  },
  {
    id: "code-font",
    title: "Code font",
    to: "/settings/appearance",
  },
  {
    id: "terminal-font",
    title: "Terminal font",
    to: "/settings/appearance",
  },
  {
    id: "font-smoothing",
    title: "Font smoothing",
    to: "/settings/appearance",
  },
  {
    id: "thread-details-items",
    title: "Thread details",
    to: "/settings/appearance",
  },
  {
    id: "word-wrap",
    title: "Word wrap",
    to: "/settings/appearance",
  },
  {
    id: "composer-context",
    title: "Composer context",
    to: "/settings/appearance",
  },
  {
    id: "project-grouping",
    title: "Project grouping",
    to: "/settings/general",
  },
  {
    id: "time-format",
    title: "Time format",
    to: "/settings/general",
  },
  {
    id: "hide-whitespace-changes",
    title: "Hide whitespace changes",
    to: "/settings/diffs",
  },
  {
    id: "assistant-output",
    title: "Assistant output",
    to: "/settings/threads",
  },
  {
    id: "auto-resume-limited-threads",
    title: "Auto-resume limited threads",
    to: "/settings/threads",
  },
  {
    id: "snooze-limited-threads",
    title: "Snooze limited threads",
    to: "/settings/threads",
  },
  {
    id: "snooze-options",
    title: "Snooze options",
    to: "/settings/threads",
  },
  {
    id: "compact-idle-threads",
    title: "Compact idle threads",
    to: "/settings/providers",
  },
  {
    id: "new-threads",
    title: "Workspace",
    to: "/settings/threads",
  },
  {
    id: "start-from-origin",
    title: "Start from remote",
    to: "/settings/worktrees",
  },
  {
    id: "automatic-worktree-cleanup",
    title: "Automatic worktree cleanup",
    to: "/settings/worktrees",
  },
  {
    id: "worktree-branch-naming",
    title: "Worktree branch naming",
    to: "/settings/worktrees",
  },
  {
    id: "add-project-starts-in",
    title: "Add project starts in",
    to: "/settings/threads",
  },
  {
    id: "archive-confirmation",
    title: "Archive confirmation",
    to: "/settings/general",
  },
  {
    id: "delete-confirmation",
    title: "Delete confirmation",
    to: "/settings/general",
  },
  {
    id: "thread-title-instructions",
    title: "Thread title instructions",
    to: "/settings/threads",
  },
  {
    id: "text-generation-model",
    title: "Text generation model",
    to: "/settings/threads",
  },
  {
    id: "diagnostics",
    title: "Diagnostics",
    to: "/settings/maintenance",
  },
  {
    id: "keybindings",
    title: "Keybindings",
    to: "/settings/keybindings",
  },
  {
    id: "providers",
    title: "Providers",
    to: "/settings/providers",
  },
  { id: "mcp-servers", title: "MCP servers", to: "/settings/tools" },
  { id: "skill-library", title: "Skill library", to: "/settings/tools" },
  {
    id: "source-control",
    title: "Source control",
    to: "/settings/source-control",
  },
  {
    id: "remote-environments",
    title: "Environments",
    to: "/settings/connections",
  },
  {
    id: "new-design",
    title: "New design",
    to: "/settings/labs",
  },
  {
    id: "auto-settle-inactive-threads",
    title: "Auto-settle inactive threads",
    to: "/settings/threads",
  },
  {
    id: "auto-settle-merged-threads",
    title: "Auto-settle merged threads",
    to: "/settings/threads",
  },
  {
    id: "sidebar-working-shelf",
    title: "Working section",
    to: "/settings/general",
  },
  {
    id: "restore-plan-mode",
    title: "Restore plan mode (legacy)",
    to: "/settings/labs",
  },
  {
    id: "background-activity",
    title: "Background activity",
    to: "/settings/maintenance",
  },
  {
    id: "provider-advanced",
    title: "Health check interval",
    to: "/settings/providers",
  },
  {
    id: "version",
    title: "Version",
    to: "/settings/about",
  },
  {
    id: "network-access",
    title: "Network access",
    to: "/settings/access",
  },
  {
    id: "authorized-clients",
    title: "Authorized clients",
    to: "/settings/access",
  },
  {
    id: "archive",
    title: "Archived threads",
    to: "/settings/archived",
  },
] as const satisfies ReadonlyArray<SettingsSearchItem>;

export type SettingsSearchItemId = (typeof SETTINGS_SEARCH_ITEMS)[number]["id"];

const SEARCH_ITEMS_BY_ID = Object.fromEntries(
  SETTINGS_SEARCH_ITEMS.map((item) => [item.id, item]),
) as Readonly<Record<SettingsSearchItemId, SettingsSearchItem>>;

/**
 * `id` and `title` props for the element a search item anchors to. Panels
 * spread (or pick from) this instead of restating the strings, so the catalog
 * and the rendered settings cannot drift apart.
 */
export function searchableSetting(id: SettingsSearchItemId): {
  readonly id: string;
  readonly title: string;
} {
  const { id: anchorId, title } = SEARCH_ITEMS_BY_ID[id];
  return { id: anchorId, title };
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function searchSettings(
  query: string,
  items: ReadonlyArray<SettingsSearchItem> = SETTINGS_SEARCH_ITEMS,
): ReadonlyArray<SettingsSearchItem> {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length === 0) return [];

  return items.filter((item) => normalizeSearchText(item.title).includes(normalizedQuery));
}
