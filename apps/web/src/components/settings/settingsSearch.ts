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
  | "/settings/projects"
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
  "/settings/projects": "Projects",
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
    paths: ["/settings/projects", "/settings/source-control", "/settings/worktrees"],
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
  { id: "projects", title: "Projects", to: "/settings/projects" },
  { id: "project-actions", title: "Project actions", to: "/settings/projects" },
  { id: "project-checkouts", title: "Project checkouts", to: "/settings/projects" },
  { id: "send-shortcut", title: "Send shortcut", to: "/settings/chat" },
  { id: "skills-in-slash-menu", title: "Show skills in slash menu", to: "/settings/chat" },
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
  { id: "browser-link-target", title: "Open links in", to: "/settings/browser" },
  { id: "agent-browser-access", title: "Agent browser access", to: "/settings/browser" },
  {
    id: "browser-auto-show-floating-preview",
    title: "Auto-show floating preview",
    to: "/settings/browser",
  },
  { id: "browser-default-viewport", title: "Default browser viewport", to: "/settings/browser" },
  { id: "browser-default-zoom", title: "Default browser zoom", to: "/settings/browser" },
  {
    id: "browser-default-appearance",
    title: "Default browser appearance",
    to: "/settings/browser",
  },
  {
    id: "browser-recording-frame-rate",
    title: "Browser recording frame rate",
    to: "/settings/browser",
  },
  {
    id: "browser-recording-key-presses",
    title: "Show key presses in recordings",
    to: "/settings/browser",
  },
  {
    id: "browser-recording-mouse-presses",
    title: "Show mouse presses in recordings",
    to: "/settings/browser",
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
    // Prefixed because the slider control already owns the `appearance-contrast` id.
    id: "setting-appearance-contrast",
    title: "Contrast",
    to: "/settings/appearance",
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
    id: "project-order",
    title: "Project order",
    to: "/settings/general",
  },
  {
    id: "worktree-submodules",
    title: "Submodules",
    to: "/settings/worktrees",
  },
  {
    id: "continue-threads-after-restart",
    title: "Continue threads after restarts",
    to: "/settings/maintenance",
  },
  {
    id: "default-model",
    title: "Default model",
    to: "/settings/threads",
  },
  {
    id: "default-permissions",
    title: "Default permissions",
    to: "/settings/threads",
  },
  {
    id: "time-format",
    title: "Time format",
    to: "/settings/general",
  },
  { id: "chat-width", title: "Chat width", to: "/settings/appearance" },
  { id: "effort-display", title: "Effort display", to: "/settings/appearance" },
  { id: "diff-layout", title: "Diff layout", to: "/settings/diffs" },
  { id: "diff-files-collapsed", title: "Default diff file state", to: "/settings/diffs" },
  { id: "diff-color-scheme", title: "Diff colors", to: "/settings/diffs" },
  {
    id: "hide-whitespace-changes",
    title: "Hide whitespace changes",
    to: "/settings/diffs",
  },
  {
    id: "response-streaming",
    title: "Response streaming",
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
    id: "storage-worktrees-location",
    title: "Worktree location",
    to: "/settings/worktrees",
  },
  {
    id: "storage-worktrees",
    title: "Worktree cleanup",
    to: "/settings/worktrees",
  },
  {
    id: "storage-worktree-keep-when",
    title: "Keep worktrees with local changes",
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
  { id: "ghq-clone-layout", title: "Clone into host folders", to: "/settings/threads" },
  {
    id: "pull-request-links-in-app",
    title: "Open pull requests in Test Rig",
    to: "/settings/diffs",
  },
  { id: "auto-pull", title: "Automatically pull", to: "/settings/source-control" },
  {
    id: "remove-agent-credits",
    title: "Remove agent credits when merging",
    to: "/settings/source-control",
  },
  { id: "unpin-confirmation", title: "Unpin confirmation", to: "/settings/general" },
  { id: "keep-awake", title: "Keep awake while agents work", to: "/settings/maintenance" },
  { id: "storage-artifacts", title: "Artifacts and logs", to: "/settings/maintenance" },
  { id: "storage-delete-now", title: "Delete now", to: "/settings/maintenance" },
  {
    id: "auto-settle-keep-pull-requests",
    title: "Keep threads with a pull request",
    to: "/settings/threads",
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
    id: "worktree-fast-checkout",
    title: "Fast worktree checkout",
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
