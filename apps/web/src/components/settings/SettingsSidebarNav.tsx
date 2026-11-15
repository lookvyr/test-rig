import { cn } from "../../lib/utils";
import { isSettingsSearchShortcut } from "./settingsSearchShortcut";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
} from "react";
import {
  ArchiveIcon,
  BotIcon,
  CalendarClockIcon,
  FileDiffIcon,
  FlaskConicalIcon,
  FolderTreeIcon,
  FoldersIcon,
  GitBranchIcon,
  GlobeIcon,
  HammerIcon,
  InfoIcon,
  KeyboardIcon,
  MessageSquareTextIcon,
  MessagesSquareIcon,
  PaletteIcon,
  SearchIcon,
  ServerIcon,
  Settings2Icon,
  ShieldCheckIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { useAtomValue } from "@effect/atom-react";
import { useLocation, useNavigate } from "@tanstack/react-router";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Kbd } from "../ui/kbd";
import {
  SidebarContent,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../ui/sidebar";
import { primaryServerConfigAtom } from "../../state/server";
import { scrollToSettingsTarget } from "./settingsLayout";
import {
  searchSettings,
  SETTINGS_NAV_GROUPS,
  SETTINGS_SEARCH_ITEMS,
  SETTINGS_SECTION_LABELS,
  type SettingsPath,
  type SettingsSearchItem,
} from "./settingsSearch";
import { useOptionalSettingsScope } from "./SettingsScopeContext";
import { SETTINGS_SCOPED_PATHS } from "./SettingsScopeSentence";
import { settingsLinkSearch } from "./settingsScopeNavigation";

const SETTINGS_SECTION_ICONS: Readonly<
  Record<SettingsPath, ComponentType<{ className?: string }>>
> = {
  "/settings/general": Settings2Icon,
  "/settings/appearance": PaletteIcon,
  "/settings/chat": MessageSquareTextIcon,
  "/settings/diffs": FileDiffIcon,
  "/settings/keybindings": KeyboardIcon,
  "/settings/providers": BotIcon,
  "/settings/tools": HammerIcon,
  "/settings/threads": MessagesSquareIcon,
  "/settings/browser": GlobeIcon,
  "/settings/scheduled-tasks": CalendarClockIcon,
  "/settings/projects": FoldersIcon,
  "/settings/source-control": GitBranchIcon,
  "/settings/worktrees": FolderTreeIcon,
  "/settings/connections": ServerIcon,
  "/settings/access": ShieldCheckIcon,
  "/settings/maintenance": WrenchIcon,
  "/settings/labs": FlaskConicalIcon,
  "/settings/about": InfoIcon,
  "/settings/archived": ArchiveIcon,
};

// Detail pages without a nav entry highlight the page that links to them.
const SETTINGS_DETAIL_PAGE_PARENTS: Readonly<Record<string, SettingsPath>> = {
  "/settings/diagnostics": "/settings/maintenance",
};

function SettingsSectionIcon({ to }: { to: SettingsPath }) {
  const Icon = SETTINGS_SECTION_ICONS[to];
  return <Icon className="size-4 shrink-0 text-(--sidebar-icon-color)" />;
}

export function SettingsSidebarNav({ pathname }: { pathname: string }) {
  const navigate = useNavigate();
  const currentHash = useLocation({ select: (location) => location.hash });
  const scopeSearch = useOptionalSettingsScope()?.search;
  const linkSearch = useCallback(
    (to: SettingsPath) =>
      settingsLinkSearch(pathname, to, scopeSearch ?? {}, SETTINGS_SCOPED_PATHS),
    [pathname, scopeSearch],
  );
  const activePath = SETTINGS_DETAIL_PAGE_PARENTS[pathname] ?? pathname;
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [compactSearchOpen, setCompactSearchOpen] = useState(false);
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  // Fast checkout only renders when the primary server is a Mac, so its result would lead nowhere.
  const fastCheckoutSupported =
    useAtomValue(primaryServerConfigAtom)?.environment.capabilities.fastWorktreeCheckout === true;
  const results = useMemo(
    () =>
      searchSettings(
        query,
        fastCheckoutSupported
          ? SETTINGS_SEARCH_ITEMS
          : SETTINGS_SEARCH_ITEMS.filter((item) => item.id !== "worktree-fast-checkout"),
      ),
    [query, fastCheckoutSupported],
  );
  const isSearching = query.trim().length > 0;
  const hasResults = results.length > 0;

  useEffect(() => {
    const result = results[activeResultIndex];
    if (!result) return;
    document
      .getElementById(`settings-search-result-${result.id}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeResultIndex, results]);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target;
      const element = target instanceof HTMLElement ? target : null;
      if (
        !isSettingsSearchShortcut(event, {
          editable:
            element !== null &&
            (element.tagName === "INPUT" ||
              element.tagName === "TEXTAREA" ||
              element.isContentEditable),
          // Nested dialogs, popups and keybinding capture keep their keyboard focus.
          popup:
            element?.closest(
              '[role="dialog"]:not([data-app-modal]), [aria-modal="true"]:not([data-app-modal]), [data-slot$="popup"]:not([data-app-modal]), [data-keybinding-capture]',
            ) != null,
        })
      )
        return;

      event.preventDefault();
      setCompactSearchOpen(true);
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (compactSearchOpen) searchInputRef.current?.focus();
  }, [compactSearchOpen]);

  const handleSectionClick = useCallback(
    (to: SettingsPath) => {
      setCompactSearchOpen(false);
      void navigate({
        to,
        search: linkSearch(to),
        hash: "",
        replace: true,
        hashScrollIntoView: false,
      });
    },
    [linkSearch, navigate],
  );
  const clearSearch = useCallback(() => {
    setQuery("");
    setActiveResultIndex(0);
  }, []);
  const handleSearchResultClick = useCallback(
    (item: SettingsSearchItem) => {
      clearSearch();
      setCompactSearchOpen(false);
      const targetId = item.targetId ?? item.id;
      if (pathname === item.to && currentHash.replace(/^#/, "") === targetId) {
        scrollToSettingsTarget(targetId);
        return;
      }
      void navigate({
        to: item.to,
        search: linkSearch(item.to),
        hash: targetId,
        replace: true,
        hashScrollIntoView: false,
      });
    },
    [clearSearch, currentHash, linkSearch, navigate, pathname],
  );
  const handleSearchKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape" && isSearching) {
        event.preventDefault();
        event.stopPropagation();
        clearSearch();
        return;
      }
      if (results.length === 0) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveResultIndex((index) => (index + 1) % results.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveResultIndex((index) => (index - 1 + results.length) % results.length);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const result = results[activeResultIndex];
        if (result) handleSearchResultClick(result);
      }
    },
    [activeResultIndex, clearSearch, handleSearchResultClick, isSearching, results],
  );

  return (
    <nav
      aria-label="Settings"
      className={cn(
        "flex w-60 shrink-0 flex-col border-e bg-sidebar text-sidebar-foreground max-md:w-14",
        compactSearchOpen &&
          "max-md:absolute max-md:inset-y-0 max-md:start-0 max-md:z-10 max-md:w-full",
      )}
    >
      <SidebarContent className="overflow-x-hidden">
        <SidebarGroup className="gap-2 p-[var(--sidebar-content-inset)]">
          <div
            className={cn(
              "flex h-8 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
              !compactSearchOpen && "max-md:hidden",
            )}
          >
            <SearchIcon className="size-4 shrink-0 text-sidebar-muted-foreground/80" />
            <Input
              ref={searchInputRef}
              nativeInput
              unstyled
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.currentTarget.value);
                setActiveResultIndex(0);
              }}
              onKeyDown={handleSearchKeyDown}
              onFocus={() => setCompactSearchOpen(true)}
              onBlur={() => {
                if (!isSearching) setCompactSearchOpen(false);
              }}
              placeholder="Search"
              aria-label="Search settings"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={isSearching && hasResults}
              aria-controls={isSearching && hasResults ? "settings-search-results" : undefined}
              aria-activedescendant={
                isSearching && results[activeResultIndex]
                  ? `settings-search-result-${results[activeResultIndex].id}`
                  : undefined
              }
              className="min-w-0 flex-1 [&_[data-slot=input]]:h-auto [&_[data-slot=input]]:p-0 [&_[data-slot=input]]:leading-normal [&_[data-slot=input]]:text-sm [&_[data-slot=input]]:font-medium [&_[data-slot=input]]:text-sidebar-foreground [&_[data-slot=input]]:placeholder:text-sidebar-muted-foreground"
            />
            {isSearching ? (
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                className="size-5 shrink-0 rounded-sm text-sidebar-muted-foreground hover:bg-sidebar-control-surface hover:text-sidebar-foreground"
                aria-label="Clear settings search"
                onClick={() => {
                  clearSearch();
                  searchInputRef.current?.focus();
                }}
              >
                <XIcon className="size-3" />
              </Button>
            ) : (
              <Kbd className="mr-px h-4 min-w-0 rounded-sm bg-sidebar-control-surface px-1.5 text-[10px] text-sidebar-muted-foreground ring-1 ring-sidebar-border">
                /
              </Kbd>
            )}
          </div>
          {isSearching && results.length === 0 ? (
            <p
              role="status"
              className="px-2 py-6 text-center text-xs text-sidebar-muted-foreground"
            >
              No settings found
            </p>
          ) : null}
          <SidebarMenu
            className="ps-px"
            id={isSearching && hasResults ? "settings-search-results" : undefined}
            role={isSearching && hasResults ? "listbox" : undefined}
            aria-label={isSearching && hasResults ? "Settings search results" : undefined}
          >
            {!compactSearchOpen && !isSearching ? (
              <SidebarMenuItem className="md:hidden">
                <SidebarMenuButton
                  aria-label="Search settings"
                  onClick={() => setCompactSearchOpen(true)}
                >
                  <SearchIcon />
                </SidebarMenuButton>
              </SidebarMenuItem>
            ) : null}
            {isSearching
              ? results.map((item, index) => (
                  <SidebarMenuItem key={item.id} role="presentation">
                    <SidebarMenuButton
                      id={`settings-search-result-${item.id}`}
                      role="option"
                      aria-selected={index === activeResultIndex}
                      tabIndex={-1}
                      size="sm"
                      isActive={index === activeResultIndex}
                      className="h-auto min-h-10 items-start"
                      onMouseMove={() => setActiveResultIndex(index)}
                      onClick={() => handleSearchResultClick(item)}
                    >
                      <SettingsSectionIcon to={item.to} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-sidebar-foreground">
                          {item.title}
                        </span>
                        <span className="block truncate text-2xs text-sidebar-muted-foreground/75">
                          {SETTINGS_SECTION_LABELS[item.to]}
                        </span>
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))
              : null}
          </SidebarMenu>
          {isSearching ? null : (
            <div className="flex flex-col gap-4">
              {SETTINGS_NAV_GROUPS.map((group, index) => (
                <div
                  key={group.heading}
                  className="flex flex-col gap-1 max-md:border-t max-md:border-sidebar-border max-md:pt-4 max-md:first:border-t-0 max-md:first:pt-0"
                >
                  <h3
                    id={`settings-nav-group-${index}`}
                    className={cn(
                      "px-2 text-xs font-medium text-sidebar-muted-foreground/80",
                      group.headingHidden ? "sr-only" : !compactSearchOpen && "max-md:sr-only",
                    )}
                  >
                    {group.heading}
                  </h3>
                  {/* The heading stays outside the group it names so screen readers do not read it twice. */}
                  <div role="group" aria-labelledby={`settings-nav-group-${index}`}>
                    <SidebarMenu>
                      {group.paths.map((to) => {
                        const Icon = SETTINGS_SECTION_ICONS[to];
                        const isActive = activePath === to;
                        return (
                          <SidebarMenuItem key={to}>
                            <SidebarMenuButton
                              aria-current={isActive ? "page" : undefined}
                              isActive={isActive}
                              onClick={() => handleSectionClick(to)}
                            >
                              <Icon />
                              <span
                                className={cn("truncate", !compactSearchOpen && "max-md:sr-only")}
                              >
                                {SETTINGS_SECTION_LABELS[to]}
                              </span>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        );
                      })}
                    </SidebarMenu>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SidebarGroup>
      </SidebarContent>
    </nav>
  );
}
