import type { ContextMenuItem, PreviewSessionSnapshot } from "@t3tools/contracts";
import { getTerminalLabel } from "@t3tools/shared/terminalLabels";
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  FileDiff,
  Files,
  Globe2,
  GitPullRequest,
  MessageSquare,
  Plus,
  TerminalSquare,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  LAUNCHER_SHORTCUT_BLOCKING_LAYERS,
  surfaceShortcutActionForKey,
  surfaceShortcutTargetsTypingContext,
  tabWheelDelta,
} from "./rightPanelTabs.logic";
import { useBrowserProfiles } from "~/browser/browserDefaults";
import { isElectron } from "~/env";
import type { RightPanelSurface } from "~/rightPanelStore";
import { cn } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
  MenuSub,
  MenuSubTrigger,
  MenuSubPopup,
} from "~/components/ui/menu";
import { ScrollArea } from "~/components/ui/scroll-area";
import { useTheme } from "~/hooks/useTheme";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";

import { PreviewPanelShell, type PreviewPanelMode } from "./preview/PreviewPanelShell";
import { PierreEntryIcon } from "./chat/PierreEntryIcon";

interface RightPanelTabsProps {
  mode: PreviewPanelMode;
  maximized?: boolean;
  layoutControls?: ReactNode;
  surfaces: readonly RightPanelSurface[];
  activeSurfaceId: string | null;
  pendingSurfaceIds: ReadonlySet<string>;
  previewSessions: Readonly<Record<string, PreviewSessionSnapshot>>;
  terminalLabelsById: ReadonlyMap<string, string>;
  browserProfiles?: readonly { id: string; name: string }[];
  desktopOverlays?: Readonly<Record<string, { audible?: boolean; audioMuted?: boolean }>>;
  onSetBrowserMuted?: (tabId: string, muted: boolean) => void;
  onActivate: (surface: RightPanelSurface) => void;
  onCloseSurface: (surface: RightPanelSurface) => void;
  onCloseOtherSurfaces: (surface: RightPanelSurface) => void;
  onCloseSurfacesToRight: (surface: RightPanelSurface) => void;
  onCloseAllSurfaces: () => void;
  onCopyFilePath: (relativePath: string) => void;
  onAddBrowser: (profileId?: string) => void;
  onAddTerminal: () => void;
  onAddDiff: () => void;
  onAddFiles: () => void;
  onAddAgents: () => void;
  onAddPullRequest?: (() => void) | undefined;
  onAddSideChat?: (() => void) | undefined;
  sideChatAvailable?: boolean | undefined;
  browserAvailable: boolean;
  diffAvailable: boolean;
  filesAvailable: boolean;
  children: ReactNode;
}

const SURFACE_DISABLED_REASONS = {
  browser: "Browser previews are only available in the Test Rig desktop app.",
  files: "Files are only available when a project is open.",
  diff: "Review is only available for server threads in Git repositories.",
  sideChat: "Side chats are available after the first Codex or Claude turn finishes.",
} as const;

type TabContextMenuAction =
  | "mute"
  | "unmute"
  | "copy-path"
  | "close"
  | "close-others"
  | "close-to-right"
  | "close-all";

function DisabledReasonTooltip(props: { reason: string; trigger: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={props.trigger} />
      <TooltipPopup side="top">{props.reason}</TooltipPopup>
    </Tooltip>
  );
}

function SurfaceMenuItem(props: {
  available: boolean;
  disabledReason?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  const item = (
    <MenuItem
      className={!props.available ? "data-disabled:pointer-events-auto" : undefined}
      onClick={() => props.onClick()}
      disabled={!props.available}
    >
      {props.children}
    </MenuItem>
  );
  if (props.available || !props.disabledReason) return item;
  return <DisabledReasonTooltip reason={props.disabledReason} trigger={item} />;
}

function RightPanelEmptyState(props: {
  onAddBrowser: (profileId?: string) => void;
  browserProfiles?: readonly { id: string; name: string }[];
  onAddTerminal: () => void;
  onAddDiff: () => void;
  onAddFiles: () => void;
  onAddAgents: () => void;
  onAddPullRequest?: (() => void) | undefined;
  onAddSideChat?: (() => void) | undefined;
  sideChatAvailable?: boolean | undefined;
  browserAvailable: boolean;
  diffAvailable: boolean;
  filesAvailable: boolean;
}) {
  const actions = [
    {
      label: "Browser",
      shortcut: "B",
      description: "Open a local app or URL.",
      icon: Globe2,
      available: props.browserAvailable,
      disabledReason: SURFACE_DISABLED_REASONS.browser,
      onClick: props.onAddBrowser,
    },
    {
      label: "Terminal",
      shortcut: "T",
      description: "Start a shell in this workspace.",
      icon: TerminalSquare,
      available: true,
      disabledReason: null,
      onClick: props.onAddTerminal,
    },
    {
      label: "Files",
      shortcut: "F",
      description: "Browse and read workspace files.",
      icon: Files,
      available: props.filesAvailable,
      disabledReason: SURFACE_DISABLED_REASONS.files,
      onClick: props.onAddFiles,
    },
    {
      label: "Review",
      shortcut: "D",
      description: "Review Git changes and turn snapshots.",
      icon: FileDiff,
      available: props.diffAvailable,
      disabledReason: SURFACE_DISABLED_REASONS.diff,
      onClick: props.onAddDiff,
    },
    {
      label: "Agents",
      shortcut: "A",
      description: "Watch subagents and workflows run.",
      icon: Bot,
      available: true,
      disabledReason: null,
      onClick: props.onAddAgents,
    },
    ...(props.onAddPullRequest
      ? [
          {
            label: "Pull request",
            shortcut: "P",
            description: "Review the linked pull request.",
            icon: GitPullRequest,
            available: true,
            disabledReason: null,
            onClick: props.onAddPullRequest,
          },
        ]
      : []),
    ...(props.onAddSideChat
      ? [
          {
            label: "Side chat",
            shortcut: "S",
            description: "Explore an idea with this thread’s context.",
            icon: MessageSquare,
            available: props.sideChatAvailable ?? false,
            disabledReason: SURFACE_DISABLED_REASONS.sideChat,
            onClick: props.onAddSideChat,
          },
        ]
      : []),
  ] as const;

  const available = actions.filter((action) => action.available);
  const [highlight, setHighlight] = useState(-1);
  const actionsRef = useRef(available);
  useEffect(() => {
    actionsRef.current = available;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = surfaceShortcutActionForKey(actionsRef.current, event);
      if (
        !action ||
        [...document.querySelectorAll(LAUNCHER_SHORTCUT_BLOCKING_LAYERS)].some(
          (layer) =>
            layer.getAttribute("role") !== "complementary" &&
            layer.getClientRects().length > 0 &&
            getComputedStyle(layer).visibility !== "hidden",
        ) ||
        (event.target instanceof Element && surfaceShortcutTargetsTypingContext(event.target))
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      action.onClick();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="w-full max-w-xl">
        <div className="mb-5 text-center">
          <h3 className="text-sm font-medium text-foreground">Open a surface</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Choose what to show in the right panel.
          </p>
        </div>
        <div
          className="grid grid-cols-2 gap-2"
          tabIndex={0}
          role="group"
          aria-label="Panel launcher"
          onKeyDown={(event) => {
            if (
              event.defaultPrevented ||
              event.metaKey ||
              event.ctrlKey ||
              event.altKey ||
              event.nativeEvent.isComposing ||
              available.length === 0
            )
              return;
            const index = Math.min(highlight, available.length - 1);
            if (["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(event.key)) {
              event.preventDefault();
              const backwards = event.key === "ArrowUp" || event.key === "ArrowLeft";
              setHighlight(
                index < 0
                  ? backwards
                    ? available.length - 1
                    : 0
                  : (index + (backwards ? -1 : 1) + available.length) % available.length,
              );
            } else if (
              event.key === "Enter" &&
              event.target === event.currentTarget &&
              index >= 0
            ) {
              event.preventDefault();
              available[index]?.onClick();
            }
          }}
        >
          {actions.map((action) => {
            const Icon = action.icon;
            const content = (
              <>
                <Icon className="mb-3 size-5" />
                <span className="flex w-full items-center justify-between text-sm font-medium">
                  {action.label}
                  <kbd className="text-2xs text-muted-foreground">{action.shortcut}</kbd>
                </span>
                <span className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {action.description}
                </span>
              </>
            );
            if (action.available) {
              return (
                <button
                  key={action.label}
                  type="button"
                  onClick={() => action.onClick()}
                  aria-keyshortcuts={action.shortcut}
                  data-highlighted={available[highlight] === action || undefined}
                  className="flex min-h-28 w-full flex-col items-start rounded-lg border border-border/80 bg-card p-4 text-left transition data-highlighted:ring-2 data-highlighted:ring-ring hover:border-border hover:bg-accent/60 dark:border-transparent dark:shadow-none dark:inset-ring-1 dark:inset-ring-white/5"
                >
                  {content}
                </button>
              );
            }
            const disabledCard = (
              <button
                type="button"
                className="flex min-h-28 w-full cursor-not-allowed flex-col items-start rounded-lg border border-border/80 bg-card p-4 text-left opacity-40 dark:border-transparent dark:shadow-none dark:inset-ring-1 dark:inset-ring-white/5"
                aria-disabled="true"
              >
                {content}
              </button>
            );
            return (
              <DisabledReasonTooltip
                key={action.label}
                reason={action.disabledReason ?? "This surface is unavailable."}
                trigger={disabledCard}
              />
            );
          })}
        </div>
        {props.browserAvailable && (props.browserProfiles?.length ?? 0) > 1 ? (
          <div className="mt-3 flex justify-center">
            <Menu>
              <MenuTrigger className="text-xs text-muted-foreground hover:text-foreground">
                Open Browser in a profile
              </MenuTrigger>
              <MenuPopup>
                {props.browserProfiles?.map((profile) => (
                  <MenuItem key={profile.id} onClick={() => props.onAddBrowser(profile.id)}>
                    {profile.name}
                  </MenuItem>
                ))}
              </MenuPopup>
            </Menu>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function surfaceTitle(
  surface: RightPanelSurface,
  sessions: Readonly<Record<string, PreviewSessionSnapshot>>,
  terminalLabelsById: ReadonlyMap<string, string>,
): string {
  switch (surface.kind) {
    case "diff":
      return "Review";
    case "files":
      return "Files";
    case "file":
      return surface.relativePath.slice(surface.relativePath.lastIndexOf("/") + 1);
    case "terminal":
      return (
        terminalLabelsById.get(surface.activeTerminalId) ??
        getTerminalLabel(surface.activeTerminalId)
      );
    case "agents":
      return "Agents";
    case "pull-request":
      return "Pull request";
    case "side-chat":
      return "Side chat";
    case "preview": {
      const snapshot = surface.resourceId ? sessions[surface.resourceId] : null;
      if (!snapshot || snapshot.navStatus._tag === "Idle") return "Browser";
      if (snapshot.navStatus.title.trim().length > 0) return snapshot.navStatus.title;
      try {
        return new URL(snapshot.navStatus.url).host || "Browser";
      } catch {
        return "Browser";
      }
    }
  }
}

function SurfaceIcon({ surface, theme }: { surface: RightPanelSurface; theme: "light" | "dark" }) {
  switch (surface.kind) {
    case "preview":
      return <Globe2 className="size-3 shrink-0" />;
    case "diff":
      return <FileDiff className="size-3 shrink-0" />;
    case "files":
      return <Files className="size-3 shrink-0" />;
    case "file":
      return (
        <PierreEntryIcon
          pathValue={surface.relativePath}
          kind="file"
          theme={theme}
          className="size-3"
        />
      );
    case "terminal":
      return <TerminalSquare className="size-3 shrink-0" />;
    case "agents":
      return <Bot className="size-3 shrink-0" />;
    case "pull-request":
      return <GitPullRequest className="size-3 shrink-0" />;
    case "side-chat":
      return <MessageSquare className="size-3 shrink-0" />;
  }
}

export function RightPanelTabs(props: RightPanelTabsProps) {
  const ownsDesktopTitleBar = isElectron && props.mode === "inline";
  const { resolvedTheme } = useTheme();
  const configuredProfiles = useBrowserProfiles();
  const profiles = props.browserProfiles ?? configuredProfiles;
  const tabListRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });
  const scrollTabs = (direction: -1 | 1) => {
    const viewport = tabListRef.current?.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    );
    if (viewport)
      viewport.scrollBy({
        left: direction * Math.max(120, viewport.clientWidth * 0.75),
        behavior: "auto",
      });
  };
  useEffect(() => {
    const root = tabListRef.current;
    const viewport = root?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
    if (!root || !viewport) return;
    const update = () =>
      setOverflow({
        left: viewport.scrollLeft > 1,
        right: viewport.scrollLeft + viewport.clientWidth < viewport.scrollWidth - 1,
      });
    const wheel = (event: WheelEvent) => {
      const delta = tabWheelDelta(event, viewport.clientWidth);
      if (!delta || viewport.scrollWidth <= viewport.clientWidth) return;
      event.preventDefault();
      viewport.scrollLeft += delta;
      update();
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    const content = viewport.firstElementChild;
    if (content) observer.observe(content);
    viewport.addEventListener("scroll", update);
    viewport.addEventListener("wheel", wheel, { passive: false });
    return () => {
      observer.disconnect();
      viewport.removeEventListener("scroll", update);
      viewport.removeEventListener("wheel", wheel);
    };
  }, [props.surfaces.length]);

  const handleTabContextMenu = useCallback(
    async (event: ReactMouseEvent, surface: RightPanelSurface) => {
      event.preventDefault();
      event.stopPropagation();

      const api = readLocalApi();
      if (!api) return;

      const surfaceIndex = props.surfaces.findIndex((entry) => entry.id === surface.id);
      if (surfaceIndex < 0) return;

      const items: ContextMenuItem<TabContextMenuAction>[] = [];
      if (surface.kind === "file") {
        items.push({ id: "copy-path", label: "Copy path" });
      }
      if (surface.kind === "preview" && surface.resourceId && props.onSetBrowserMuted) {
        const muted = props.desktopOverlays?.[surface.resourceId]?.audioMuted === true;
        items.push({ id: muted ? "unmute" : "mute", label: muted ? "Unmute tab" : "Mute tab" });
      }
      items.push(
        { id: "close", label: "Close" },
        {
          id: "close-others",
          label: "Close others",
          disabled: props.surfaces.length <= 1,
        },
        {
          id: "close-to-right",
          label: "Close to the right",
          disabled: surfaceIndex >= props.surfaces.length - 1,
        },
        {
          id: "close-all",
          label: "Close all",
          disabled: props.surfaces.length === 0,
        },
      );

      const action = await api.contextMenu.show(items, { x: event.clientX, y: event.clientY });
      switch (action) {
        case "mute":
        case "unmute":
          if (surface.kind === "preview" && surface.resourceId)
            props.onSetBrowserMuted?.(surface.resourceId, action === "mute");
          break;
        case "copy-path":
          if (surface.kind === "file") props.onCopyFilePath(surface.relativePath);
          break;
        case "close":
          props.onCloseSurface(surface);
          break;
        case "close-others":
          props.onCloseOtherSurfaces(surface);
          break;
        case "close-to-right":
          props.onCloseSurfacesToRight(surface);
          break;
        case "close-all":
          props.onCloseAllSurfaces();
          break;
        case null:
          break;
      }
    },
    [props],
  );
  const handleTabMouseDown = useCallback((event: ReactMouseEvent) => {
    if (event.button !== 1) return;
    event.preventDefault();
  }, []);
  const handleTabAuxClick = useCallback(
    (event: ReactMouseEvent, surface: RightPanelSurface) => {
      if (event.button !== 1) return;
      event.preventDefault();
      event.stopPropagation();
      props.onCloseSurface(surface);
    },
    [props],
  );

  useEffect(() => {
    const activeTab = tabListRef.current?.querySelector<HTMLElement>("[data-active-tab='true']");
    activeTab?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [props.activeSurfaceId]);

  return (
    <PreviewPanelShell
      mode={props.mode}
      {...(props.maximized !== undefined ? { maximized: props.maximized } : {})}
    >
      <div
        className={cn(
          "workspace-topbar gap-1 pl-2",
          props.mode !== "inline" && "[--workspace-topbar-height:--spacing(11)]",
          props.mode === "inline" ? "pr-28" : "pr-3",
          ownsDesktopTitleBar && "wco:pr-[calc(var(--workspace-native-controls-inset)+6rem)]",
          props.mode === "inline" && props.maximized && COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
        )}
        data-right-panel-tabbar
      >
        <ScrollArea
          ref={tabListRef}
          hideScrollbars
          scrollFade
          className={cn("min-w-0 flex-1 rounded-none", ownsDesktopTitleBar && "drag-region")}
          data-right-panel-tab-list
        >
          <div className="flex h-full w-max min-w-full items-center gap-1">
            {props.surfaces.map((surface) => {
              const active = surface.id === props.activeSurfaceId;
              const pending = props.pendingSurfaceIds.has(surface.id);
              const title = surfaceTitle(surface, props.previewSessions, props.terminalLabelsById);
              const audio =
                surface.kind === "preview" && surface.resourceId
                  ? props.desktopOverlays?.[surface.resourceId]
                  : undefined;
              return (
                <div
                  key={surface.id}
                  data-active-tab={active}
                  onMouseDown={handleTabMouseDown}
                  onAuxClick={(event) => handleTabAuxClick(event, surface)}
                  onContextMenu={(event) => void handleTabContextMenu(event, surface)}
                  className={cn(
                    "group/tab flex h-6 max-w-36 shrink-0 items-center gap-0.5 rounded-md pr-2 pl-1.5 text-xs",
                    active
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )}
                >
                  <button
                    type="button"
                    className="group/close relative flex size-4 shrink-0 items-center justify-center rounded-sm hover:bg-muted"
                    aria-label={`Close ${title}`}
                    onClick={() => props.onCloseSurface(surface)}
                  >
                    <span className="relative flex size-3 items-center justify-center group-hover/tab:hidden group-focus-visible/close:hidden">
                      <SurfaceIcon surface={surface} theme={resolvedTheme} />
                      {pending ? (
                        <span
                          className="absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full bg-current"
                          aria-hidden
                        />
                      ) : null}
                    </span>
                    <X className="hidden size-3 group-hover/tab:block group-focus-visible/close:block" />
                  </button>
                  {surface.kind === "preview" &&
                  surface.resourceId &&
                  props.onSetBrowserMuted &&
                  (audio?.audible || audio?.audioMuted) ? (
                    <button
                      type="button"
                      className="shrink-0 rounded-sm p-0.5 hover:bg-muted"
                      aria-label={audio.audioMuted ? "Unmute tab" : "Mute tab"}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (surface.resourceId)
                          props.onSetBrowserMuted?.(surface.resourceId, !audio.audioMuted);
                      }}
                    >
                      {audio.audioMuted ? (
                        <VolumeX className="size-3" />
                      ) : (
                        <Volume2 className="size-3" />
                      )}
                    </button>
                  ) : null}
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          className="flex min-w-0 items-center"
                          onClick={() => props.onActivate(surface)}
                        >
                          <span className="truncate">{title}</span>
                        </button>
                      }
                    />
                    <TooltipPopup>{title}</TooltipPopup>
                  </Tooltip>
                </div>
              );
            })}
          </div>
        </ScrollArea>
        {overflow.left || overflow.right ? (
          <div className="flex shrink-0 items-center [-webkit-app-region:no-drag]">
            <button
              type="button"
              aria-label="Scroll tabs left"
              disabled={!overflow.left}
              className="p-1 disabled:opacity-30"
              onClick={() => scrollTabs(-1)}
            >
              <ChevronLeft className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label="Scroll tabs right"
              disabled={!overflow.right}
              className="p-1 disabled:opacity-30"
              onClick={() => scrollTabs(1)}
            >
              <ChevronRight className="size-3.5" />
            </button>
          </div>
        ) : null}
        {props.surfaces.length > 0 ? (
          <Menu>
            <MenuTrigger
              className="relative inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Add panel surface"
            >
              <Plus className="size-3.5" />
            </MenuTrigger>
            <MenuPopup align="start" side="bottom" sideOffset={6} className="min-w-44">
              <SurfaceMenuItem
                available={props.browserAvailable}
                disabledReason={SURFACE_DISABLED_REASONS.browser}
                onClick={props.onAddBrowser}
              >
                <Globe2 />
                Browser
              </SurfaceMenuItem>
              {props.browserAvailable && profiles.length > 1 ? (
                <MenuSub>
                  <MenuSubTrigger>
                    <Globe2 />
                    Browser profile
                  </MenuSubTrigger>
                  <MenuSubPopup>
                    {profiles.map((profile) => (
                      <MenuItem key={profile.id} onClick={() => props.onAddBrowser(profile.id)}>
                        {profile.name}
                      </MenuItem>
                    ))}
                  </MenuSubPopup>
                </MenuSub>
              ) : null}
              <SurfaceMenuItem available onClick={props.onAddTerminal}>
                <TerminalSquare />
                Terminal
              </SurfaceMenuItem>
              <SurfaceMenuItem
                available={props.filesAvailable}
                disabledReason={SURFACE_DISABLED_REASONS.files}
                onClick={props.onAddFiles}
              >
                <Files />
                Files
              </SurfaceMenuItem>
              <SurfaceMenuItem
                available={props.diffAvailable}
                disabledReason={SURFACE_DISABLED_REASONS.diff}
                onClick={props.onAddDiff}
              >
                <FileDiff />
                Review
              </SurfaceMenuItem>
              {props.onAddPullRequest ? (
                <SurfaceMenuItem available onClick={props.onAddPullRequest}>
                  <GitPullRequest />
                  Pull request
                </SurfaceMenuItem>
              ) : null}
              {props.onAddSideChat ? (
                <SurfaceMenuItem
                  available={props.sideChatAvailable ?? false}
                  disabledReason={SURFACE_DISABLED_REASONS.sideChat}
                  onClick={props.onAddSideChat}
                >
                  <MessageSquare />
                  Side chat
                </SurfaceMenuItem>
              ) : null}
              <SurfaceMenuItem available onClick={props.onAddAgents}>
                <Bot />
                Agents
              </SurfaceMenuItem>
            </MenuPopup>
          </Menu>
        ) : null}
        {props.layoutControls}
      </div>
      <div className="flex min-h-0 flex-1 flex-col" data-right-panel-surface-content>
        {props.activeSurfaceId === null ? (
          <RightPanelEmptyState
            onAddBrowser={props.onAddBrowser}
            browserProfiles={profiles}
            onAddTerminal={props.onAddTerminal}
            onAddDiff={props.onAddDiff}
            onAddFiles={props.onAddFiles}
            onAddAgents={props.onAddAgents}
            onAddPullRequest={props.onAddPullRequest}
            onAddSideChat={props.onAddSideChat}
            sideChatAvailable={props.sideChatAvailable}
            browserAvailable={props.browserAvailable}
            diffAvailable={props.diffAvailable}
            filesAvailable={props.filesAvailable}
          />
        ) : (
          props.children
        )}
      </div>
    </PreviewPanelShell>
  );
}
