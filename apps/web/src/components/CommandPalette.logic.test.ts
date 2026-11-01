import { makeTestThread } from "../test/threadFixtures";
import { describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type { Thread } from "../types";
import {
  buildBrowseGroups,
  buildNestedSearchItems,
  commandPaletteMessageSearchQuery,
  buildCommandPaletteRows,
  findHighlightedCommandPaletteItem,
  type CommandPaletteActionItem,
  buildThreadActionItems,
  buildThreadMessageActionItems,
  enumerateCommandPaletteItems,
  filterCommandPaletteGroups,
  reduceCommandPaletteUiState,
  type CommandPaletteGroup,
} from "./CommandPalette.logic";

describe("reduceCommandPaletteUiState", () => {
  const closedState = { open: false, mode: "command", openIntent: null } as const;

  it("toggles each overlay mode open and closed", () => {
    const filesOpen = reduceCommandPaletteUiState(closedState, {
      _tag: "ToggleMode",
      mode: "files",
    });
    expect(filesOpen).toEqual({ open: true, mode: "files", openIntent: null });

    const contentOpen = reduceCommandPaletteUiState(filesOpen, {
      _tag: "ToggleMode",
      mode: "content",
    });
    expect(contentOpen).toEqual({ open: true, mode: "content", openIntent: null });

    expect(
      reduceCommandPaletteUiState(contentOpen, { _tag: "ToggleMode", mode: "content" }),
    ).toEqual({ open: false, mode: "command", openIntent: null });
  });

  it("switches between open modes without closing", () => {
    const filesOpen = reduceCommandPaletteUiState(closedState, {
      _tag: "ToggleMode",
      mode: "files",
    });
    expect(reduceCommandPaletteUiState(filesOpen, { _tag: "ToggleMode", mode: "command" })).toEqual(
      {
        open: true,
        mode: "command",
        openIntent: null,
      },
    );
  });

  it("routes open intents to command mode", () => {
    const filesOpen = reduceCommandPaletteUiState(closedState, {
      _tag: "ToggleMode",
      mode: "files",
    });
    expect(reduceCommandPaletteUiState(filesOpen, { _tag: "OpenAddProject" })).toEqual({
      open: true,
      mode: "command",
      openIntent: { kind: "add-project" },
    });
    expect(reduceCommandPaletteUiState(filesOpen, { _tag: "OpenNewThreadIn" })).toEqual({
      open: true,
      mode: "command",
      openIntent: { kind: "new-thread-in" },
    });
  });

  it("resets to command mode for dialog-driven opens and closes", () => {
    const filesOpen = reduceCommandPaletteUiState(closedState, {
      _tag: "ToggleMode",
      mode: "files",
    });

    expect(reduceCommandPaletteUiState(filesOpen, { _tag: "SetOpen", open: false })).toEqual({
      open: false,
      mode: "command",
      openIntent: null,
    });
    expect(reduceCommandPaletteUiState(filesOpen, { _tag: "SetOpen", open: true })).toEqual({
      open: true,
      mode: "command",
      openIntent: null,
    });
  });
});

describe("enumerateCommandPaletteItems", () => {
  it("assigns positional jump shortcuts to the first nine displayed items", () => {
    const items = Array.from({ length: 10 }, (_, index) => ({
      kind: "action" as const,
      value: `project-${index + 1}`,
      searchTerms: [],
      title: `Project ${index + 1}`,
      icon: null,
      shortcutCommand: "chat.new" as const,
      run: async () => undefined,
    }));

    expect(enumerateCommandPaletteItems(items).map((item) => item.shortcutCommand)).toEqual([
      "thread.jump.1",
      "thread.jump.2",
      "thread.jump.3",
      "thread.jump.4",
      "thread.jump.5",
      "thread.jump.6",
      "thread.jump.7",
      "thread.jump.8",
      "thread.jump.9",
      undefined,
    ]);
  });
});
const PROJECT_ID = ProjectId.make("project-1");

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return makeTestThread(overrides);
}

describe("buildThreadActionItems", () => {
  it("hides delegated children but keeps forks and ranks word starts by user recency", () => {
    const parentId = ThreadId.make("parent");
    const items = buildThreadActionItems({
      threads: [
        makeThread({
          id: ThreadId.make("child"),
          lineage: {
            rootThreadId: parentId,
            parentThreadId: parentId,
            relationshipToParent: "subagent",
          },
        }),
        makeThread({
          id: ThreadId.make("fork"),
          title: "Auth",
          lineage: {
            rootThreadId: parentId,
            parentThreadId: parentId,
            relationshipToParent: "fork",
          },
        }),
        makeThread({
          id: ThreadId.make("prefix"),
          title: "Auth old",
          latestUserMessageAt: "2026-01-01T00:00:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("word"),
          title: "Fix auth",
          latestUserMessageAt: "2026-02-01T00:00:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("mid"),
          title: "𠀀auth",
          latestUserMessageAt: "2026-03-01T00:00:00.000Z",
        }),
      ],
      projectTitleById: new Map(),
      sortOrder: "updated_at",
      icon: null,
      runThread: async () => undefined,
    });
    expect(items.some((item) => item.value === "thread:child")).toBe(false);
    expect(
      filterCommandPaletteGroups({
        activeGroups: [],
        query: "auth",
        isInSubmenu: false,
        projectSearchItems: [],
        threadSearchItems: items,
      })[0]?.items.map((item) => item.value),
    ).toEqual(["thread:fork", "thread:word", "thread:prefix", "thread:mid"]);
  });

  it("orders threads by most recent activity and formats timestamps from updatedAt", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-25T12:00:00.000Z"));

    try {
      const items = buildThreadActionItems({
        threads: [
          makeThread({
            id: ThreadId.make("thread-older"),
            title: "Older thread",
            updatedAt: "2026-03-24T12:00:00.000Z",
          }),
          makeThread({
            id: ThreadId.make("thread-newer"),
            title: "Newer thread",
            createdAt: "2026-03-20T00:00:00.000Z",
            updatedAt: "2026-03-20T00:00:00.000Z",
          }),
        ],
        projectTitleById: new Map([[PROJECT_ID, "Project"]]),
        sortOrder: "updated_at",
        icon: null,
        runThread: async (_thread) => undefined,
      });

      expect(items.map((item) => item.value)).toEqual([
        "thread:thread-older",
        "thread:thread-newer",
      ]);
      expect(items[0]?.timestamp).toBe("1d ago");
      expect(items[1]?.timestamp).toBe("5d ago");
    } finally {
      vi.useRealTimers();
    }
  });

  it("ranks thread title matches ahead of contextual project-name matches", () => {
    const threadItems = buildThreadActionItems({
      threads: [
        makeThread({
          id: ThreadId.make("thread-context-match"),
          title: "Fix navbar spacing",
          updatedAt: "2026-03-20T00:00:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("thread-title-match"),
          title: "Project kickoff notes",
          createdAt: "2026-03-02T00:00:00.000Z",
          updatedAt: "2026-03-19T00:00:00.000Z",
        }),
      ],
      projectTitleById: new Map([[PROJECT_ID, "Project"]]),
      sortOrder: "updated_at",
      icon: null,
      runThread: async (_thread) => undefined,
    });

    const groups = filterCommandPaletteGroups({
      activeGroups: [],
      query: "project",
      isInSubmenu: false,
      projectSearchItems: [],
      threadSearchItems: threadItems,
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.value).toBe("threads-search");
    expect(groups[0]?.items.map((item) => item.value)).toEqual([
      "thread:thread-title-match",
      "thread:thread-context-match",
    ]);
  });

  it("preserves thread project-name matches when there is no stronger title match", () => {
    const group: CommandPaletteGroup = {
      value: "threads-search",
      label: "Threads",
      items: [
        {
          kind: "action",
          value: "thread:project-context-only",
          searchTerms: ["Fix navbar spacing", "Project"],
          title: "Fix navbar spacing",
          description: "Project",
          icon: null,
          run: async () => undefined,
        },
      ],
    };

    const groups = filterCommandPaletteGroups({
      activeGroups: [group],
      query: "project",
      isInSubmenu: false,
      projectSearchItems: [],
      threadSearchItems: [],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.items.map((item) => item.value)).toEqual(["thread:project-context-only"]);
  });

  it("reveals the same side chat in search only after it is kept", () => {
    const side = makeThread({ id: ThreadId.make("side"), sideOfThreadId: ThreadId.make("parent") });
    const input = {
      threads: [side],
      projectTitleById: new Map([[PROJECT_ID, "Project"]]),
      sortOrder: "updated_at" as const,
      icon: null,
      runThread: async () => undefined,
    };
    expect(buildThreadActionItems(input)).toEqual([]);
    expect(
      buildThreadActionItems({ ...input, threads: [{ ...side, sideOfThreadId: null }] }).map(
        (item) => item.value,
      ),
    ).toEqual(["thread:side"]);
  });

  it("filters archived threads out of thread search items", () => {
    const items = buildThreadActionItems({
      threads: [
        makeThread({
          id: ThreadId.make("thread-active"),
          title: "Active thread",
          createdAt: "2026-03-02T00:00:00.000Z",
          updatedAt: "2026-03-19T00:00:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("thread-archived"),
          title: "Archived thread",
          archivedAt: "2026-03-20T00:00:00.000Z",
          updatedAt: "2026-03-20T00:00:00.000Z",
        }),
      ],
      projectTitleById: new Map([[PROJECT_ID, "Project"]]),
      sortOrder: "updated_at",
      icon: null,
      runThread: async (_thread) => undefined,
    });

    expect(items.map((item) => item.value)).toEqual(["thread:thread-active"]);
  });
});

describe("shared palette ranking", () => {
  const NOW = Date.parse("2026-11-01T12:00:00.000Z");
  const DAY_MS = 24 * 60 * 60 * 1000;
  const threadItems = (threads: ReadonlyArray<Thread>, activeThreadId?: Thread["id"]) =>
    buildThreadActionItems({
      threads,
      ...(activeThreadId ? { activeThreadId } : {}),
      projectTitleById: new Map([[PROJECT_ID, "web"]]),
      sortOrder: "updated_at",
      icon: null,
      runThread: async () => undefined,
    });
  const search = (
    query: string,
    threadSearchItems: ReadonlyArray<CommandPaletteActionItem>,
    activeGroups: ReadonlyArray<CommandPaletteGroup> = [],
  ) =>
    filterCommandPaletteGroups({
      activeGroups,
      query,
      isInSubmenu: false,
      projectSearchItems: [],
      threadSearchItems,
      now: NOW,
    });
  const titles = (groups: ReadonlyArray<CommandPaletteGroup>) =>
    groups.flatMap((group) => group.items.map((item) => item.title));

  it("matches words in any order, without accents, with one typo", () => {
    const items = threadItems([
      makeThread({ id: ThreadId.make("login"), title: "Fix login redirect loop" }),
      makeThread({ id: ThreadId.make("cafe"), title: "Café menu rendering" }),
      makeThread({ id: ThreadId.make("other"), title: "Unrelated" }),
    ]);
    expect(titles(search("login fix", items))).toEqual(["Fix login redirect loop"]);
    expect(titles(search("cafe", items))).toEqual(["Café menu rendering"]);
    expect(titles(search("logn", items))).toEqual(["Fix login redirect loop"]);
    expect(titles(search("the menu", items))).toEqual(["Café menu rendering"]);
  });

  it("finds threads by pull request number and explains the match", () => {
    const items = threadItems([
      makeThread({
        id: ThreadId.make("pr"),
        title: "Tidy redirects",
        linkedPullRequest: {
          projectId: PROJECT_ID,
          repository: "lookvyr/test-rig",
          number: 2288,
          url: "https://github.com/lookvyr/test-rig/pull/2288",
        },
      }),
    ]);
    for (const query of [
      "2288",
      "pr 2288",
      "#2288",
      "https://github.com/lookvyr/test-rig/pull/2288",
    ]) {
      expect(titles(search(query, items))).toEqual(["Tidy redirects"]);
    }
    expect(search("2288", items)[0]?.items[0]?.matchHint).toMatchObject({
      label: "PR",
      text: "#2288",
    });
  });

  it("does not match every thread through the worktree branch prefix", () => {
    const items = threadItems([
      makeThread({ id: ThreadId.make("a"), title: "Alpha", branch: "test-rig/alpha" }),
      makeThread({ id: ThreadId.make("b"), title: "Beta", branch: "test-rig/beta" }),
    ]);
    expect(titles(search("test-rig", items))).toEqual([]);
    expect(titles(search("test-rig/beta", items))).toEqual(["Beta"]);
  });

  it("puts a thread picked for a query first the next time it is typed", () => {
    const threads = [
      makeThread({
        id: ThreadId.make("recent"),
        title: "Auth refactor",
        latestUserMessageAt: new Date(NOW - DAY_MS).toISOString(),
      }),
      makeThread({
        id: ThreadId.make("picked"),
        title: "Auth tokens",
        latestUserMessageAt: new Date(NOW - 30 * DAY_MS).toISOString(),
        opens: { openedAt: NOW - DAY_MS, score: 1, picks: [{ query: "auth", at: NOW - DAY_MS }] },
      }),
    ];
    expect(titles(search("auth", threadItems(threads)))).toEqual(["Auth tokens", "Auth refactor"]);
    // A pick never lifts a thread that matches only mid-word.
    expect(titles(search("refactor", threadItems(threads)))).toEqual(["Auth refactor"]);
  });

  it("orders groups by match quality and lists the open thread last", () => {
    const settings: CommandPaletteActionItem = {
      kind: "action",
      value: "action:settings",
      searchTerms: ["Open settings", "preferences"],
      title: "Open settings",
      icon: null,
      run: async () => undefined,
    };
    const items = threadItems(
      [
        makeThread({ id: ThreadId.make("current"), title: "Settings page polish" }),
        makeThread({ id: ThreadId.make("other"), title: "Settings sync" }),
      ],
      ThreadId.make("current"),
    );
    const groups = search("settings", items, [
      { value: "actions", label: "Actions", items: [settings] },
    ]);
    expect(groups.map((group) => group.value)).toEqual(["actions", "threads-search"]);
    expect(groups[1]?.items.map((item) => item.value)).toEqual(["thread:other", "thread:current"]);
  });
});

describe("buildBrowseGroups", () => {
  it("waits for asynchronous browse navigation actions", async () => {
    let finishNavigation: (() => void) | undefined;
    const browseTo = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishNavigation = resolve;
        }),
    );
    const groups = buildBrowseGroups({
      browseEntries: [{ name: "Downloads", fullPath: "/Users/test/Downloads" }],
      browseQuery: "~/",
      canBrowseUp: false,
      upIcon: null,
      directoryIcon: null,
      browseUp: vi.fn(),
      browseTo,
    });
    const item = groups[0]?.items[0];
    if (!item || item.kind !== "action") {
      throw new Error("Expected a browse action");
    }

    let actionSettled = false;
    const action = item.run().then(() => {
      actionSettled = true;
    });
    await Promise.resolve();

    expect(browseTo).toHaveBeenCalledWith("Downloads");
    expect(actionSettled).toBe(false);

    finishNavigation?.();
    await action;
    expect(actionSettled).toBe(true);
  });
});

describe("virtualized command palette rows", () => {
  const action = (value: string, disabled = false): CommandPaletteActionItem => ({
    kind: "action",
    value,
    searchTerms: [],
    title: value,
    icon: null,
    ...(disabled ? { disabled } : {}),
    run: async () => {},
  });
  const groups: CommandPaletteGroup[] = [
    { value: "actions", label: "Actions", items: [action("new-thread"), action("offline", true)] },
    { value: "threads", label: "Threads", items: [action("thread-a"), action("thread-b")] },
  ];

  it("keeps group order and headings while indexing only enabled items", () => {
    const { rows, itemValues, rowIndexByItemIndex } = buildCommandPaletteRows(groups);

    expect(rows.map((row) => (row.kind === "label" ? `# ${row.label}` : row.key))).toEqual([
      "# Actions",
      "actions:new-thread",
      "actions:offline",
      "# Threads",
      "threads:thread-a",
      "threads:thread-b",
    ]);
    expect(itemValues).toEqual(["new-thread", "thread-a", "thread-b"]);
    expect(rowIndexByItemIndex).toEqual([1, 4, 5]);
    expect(rows.flatMap((row) => (row.kind === "item" ? [row.itemIndex] : []))).toEqual([
      0,
      null,
      1,
      2,
    ]);
  });

  it("resolves Enter to the highlighted item without needing its row mounted", () => {
    expect(findHighlightedCommandPaletteItem(groups, "thread-b")?.value).toBe("thread-b");
    expect(findHighlightedCommandPaletteItem(groups, "offline")).toBeNull();
    expect(findHighlightedCommandPaletteItem(groups, null)).toBeNull();
  });
});

describe("indexed message search items", () => {
  it("deduplicates message matches against displayed threads by environment and thread", () => {
    const id = ThreadId.make("shared-id");
    const envA = EnvironmentId.make("environment-a");
    const envB = EnvironmentId.make("environment-b");
    const threadItems = buildThreadActionItems({
      threads: [
        makeThread({ id, environmentId: envA, title: "Compact context" }),
        makeThread({ id, environmentId: envB, title: "Other thread" }),
      ],
      projectTitleById: new Map(),
      sortOrder: "updated_at",
      icon: null,
      runThread: async () => undefined,
    });
    const messageItems = buildThreadMessageActionItems({
      threadItems,
      matches: [envA, envB].map((environmentId) => ({
        environmentId,
        threadId: id,
        messageId: "message",
        source: "assistant" as const,
        snippet: "Context compaction occurs",
        messageCreatedAt: null,
      })),
      query: "compact",
      openMatch: () => undefined,
    });
    const groups = filterCommandPaletteGroups({
      activeGroups: [],
      query: "compact",
      isInSubmenu: false,
      projectSearchItems: [],
      threadSearchItems: threadItems,
      messageSearchItems: messageItems,
    });
    expect(groups.map((group) => [group.label, group.items.map((item) => item.title)])).toEqual([
      ["Threads", ["Compact context"]],
      ["In messages", ["Other thread"]],
    ]);
    expect(groups[1]?.items[0]?.threadSearchKey).toBe(JSON.stringify([envB, id]));
    const onlyMetadata = filterCommandPaletteGroups({
      activeGroups: [],
      query: "compact",
      isInSubmenu: false,
      projectSearchItems: [],
      threadSearchItems: threadItems,
      messageSearchItems: messageItems.slice(0, 1),
    });
    expect(onlyMetadata.map((group) => group.label)).toEqual(["Threads"]);
  });

  it("keeps indexed matches separate from title results and opens their scoped message", async () => {
    const id = ThreadId.make("same-thread-id");
    const envA = EnvironmentId.make("environment-a");
    const envB = EnvironmentId.make("environment-b");
    const runThread = vi.fn(async () => undefined);
    const openMatch = vi.fn();
    const threadItems = buildThreadActionItems({
      threads: [
        makeThread({ id, environmentId: envA, title: "Thread A" }),
        makeThread({ id, environmentId: envB, title: "Thread B" }),
      ],
      projectTitleById: new Map(),
      sortOrder: "updated_at",
      icon: null,
      runThread,
    });
    const match = {
      environmentId: envB,
      threadId: id,
      source: "assistant" as const,
      snippet: "The indexed cache now refreshes the sidebar",
      messageId: "message-b",
      messageCreatedAt: null,
    };
    const messageItems = buildThreadMessageActionItems({
      threadItems,
      matches: [match, { ...match, threadId: ThreadId.make("hidden-subagent") }],
      query: "sidebar cache",
      openMatch,
    });
    expect(messageItems).toHaveLength(1);
    expect(messageItems[0]?.title).toBe("Thread B");
    const groups = filterCommandPaletteGroups({
      activeGroups: [],
      query: "sidebar cache",
      isInSubmenu: false,
      projectSearchItems: [],
      threadSearchItems: threadItems,
      messageSearchItems: messageItems,
    });
    expect(groups.map((group) => group.label)).toEqual(["In messages"]);
    await messageItems[0]?.run();
    expect(runThread).toHaveBeenCalledWith(expect.objectContaining({ id, environmentId: envB }));
    expect(openMatch).toHaveBeenCalledWith(match);
    expect(
      filterCommandPaletteGroups({
        activeGroups: [],
        query: ">sidebar",
        isInSubmenu: false,
        projectSearchItems: [],
        threadSearchItems: threadItems,
        messageSearchItems: messageItems,
      }),
    ).toEqual([]);
  });
});

describe("submenu search", () => {
  const action = (value: string, title: string): CommandPaletteActionItem => ({
    kind: "action",
    value,
    title,
    searchTerms: [title],
    icon: null,
    run: vi.fn(async () => undefined),
  });
  const projects = ["web", "web-tools", "web-app", "web-tests", "server"].map((name) =>
    action(`new-thread-in:${name}`, name),
  );
  const submenu = {
    kind: "submenu" as const,
    value: "new-thread-in",
    title: "New thread in...",
    searchTerms: ["new thread", "project"],
    icon: null,
    addonIcon: null,
    groups: [{ value: "projects", label: "Projects", items: projects }],
  };
  const addProject = action("add-project", "Add project");
  const rootItems = [submenu, addProject];
  const rootGroups = [{ value: "actions", label: "Actions", items: rootItems }];
  const message = action("message:one", "Indexed message result");
  const search = (query: string, isInSubmenu = false) =>
    filterCommandPaletteGroups({
      activeGroups: isInSubmenu ? submenu.groups : rootGroups,
      query,
      isInSubmenu,
      allOptions: { rootGroups, nestedItems: buildNestedSearchItems(rootItems, query) },
      projectSearchItems: [],
      threadSearchItems: [],
      messageSearchItems: query === "indexed words" ? [message] : [],
    });

  it("ranks exact submenu options first and limits suggestions to three", async () => {
    const groups = search("new thread in web");
    expect(groups.map((group) => group.label)).toEqual(["Suggestions"]);
    expect(groups[0]?.items.map((item) => item.title)).toEqual([
      "New thread in web",
      "New thread in web-tools",
      "New thread in web-app",
    ]);
    const suggestion = groups[0]!.items[0]!;
    expect(suggestion).toMatchObject({ value: projects[0]!.value, run: projects[0]!.run });
    if (suggestion.kind === "action") await suggestion.run();
    expect(projects[0]!.run).toHaveBeenCalledOnce();
  });

  it("keeps empty and matching submenu searches scoped, and falls back otherwise", () => {
    expect(search("", true)).toEqual(submenu.groups);
    expect(search("web", true)[0]?.items).toEqual(projects.slice(0, 4));
    expect(search("add project", true)[0]?.items).toEqual([addProject]);
    expect(search("indexed words", true)).toEqual([
      { value: "messages-search", label: "In messages", items: [message] },
    ]);
    expect(search("new thread").map((group) => group.value)).not.toContain("nested-search");
    expect(search(">new thread in web")).toEqual([]);
  });

  it("only requests indexed messages when global results can be shown", () => {
    const input = {
      query: "indexed words",
      isBrowsing: false,
      isCloning: false,
      submenuGroups: submenu.groups,
    };
    expect(commandPaletteMessageSearchQuery(input)).toBe("indexed words");
    expect(commandPaletteMessageSearchQuery({ ...input, query: "web" })).toBe("");
    expect(commandPaletteMessageSearchQuery({ ...input, query: "" })).toBe("");
    expect(commandPaletteMessageSearchQuery({ ...input, query: ">add project" })).toBe("");
    expect(
      commandPaletteMessageSearchQuery({ ...input, isBrowsing: true, query: "/tmp/project" }),
    ).toBe("");
    expect(
      commandPaletteMessageSearchQuery({ ...input, isCloning: true, query: "owner/repo" }),
    ).toBe("");
    expect(commandPaletteMessageSearchQuery({ ...input, submenuGroups: null })).toBe(
      "indexed words",
    );
  });

  it("preserves action state and skips existing top-level options", () => {
    const disabled = { ...action("offline", "Offline"), disabled: true, keepOpen: true };
    const parent = {
      ...submenu,
      groups: [{ value: "projects", label: "Projects", items: [disabled] }],
    };
    expect(buildNestedSearchItems([parent], "offline")[0]).toMatchObject({
      disabled: true,
      keepOpen: true,
      run: disabled.run,
      value: disabled.value,
    });
    expect(
      buildNestedSearchItems([parent, action("existing", "New thread in Offline")], "offline"),
    ).toEqual([]);
  });
});
