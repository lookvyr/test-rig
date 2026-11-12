import { useAtomValue } from "@effect/atom-react";
import { ArrowLeftIcon, ArrowRightIcon, SettingsIcon } from "lucide-react";
import { memo, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";

import { APP_BASE_NAME } from "../../branding";
import { useEnvironmentIdentificationMode } from "../../hooks/useSettings";
import { shortcutLabelForCommand } from "../../keybindings";
import { cn } from "../../lib/utils";
import {
  navigateHistory,
  useCanNavigateHistory,
  type HistoryDirection,
} from "../../navigationHistory";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import {
  resolveEnvironmentIdentificationPillLabel,
  resolveSidebarStageBackdropVariant,
  SidebarStageBackdrop,
  useEnvironmentStageLabel,
} from "../SidebarStageBackdrop";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SidebarProviderUpdatePill } from "./SidebarProviderUpdatePill";

// White glyphs and hover wash for controls drawn over the stage backdrop.
const BACKDROP_CONTROL_CLASS =
  "[:hover,[data-pressed]]:bg-white/15 focus-visible:ring-white/90 focus-visible:ring-offset-blue-700 [&_svg]:stroke-white/90! [&_svg]:opacity-100! [&_svg]:hover:stroke-white!";

export const SidebarChromeHeader = memo(function SidebarChromeHeader({
  isElectron,
}: {
  isElectron: boolean;
}) {
  const stageLabel = useEnvironmentStageLabel();
  const environmentIdentificationMode = useEnvironmentIdentificationMode();
  const backdropVariant = resolveSidebarStageBackdropVariant(
    stageLabel,
    environmentIdentificationMode === "artwork",
  );
  const pillLabel =
    environmentIdentificationMode === "pill"
      ? resolveEnvironmentIdentificationPillLabel(stageLabel)
      : null;

  return (
    <SidebarHeader
      className={cn(
        "@container/sidebar-header relative h-[var(--workspace-topbar-height)] shrink-0 flex-row items-center px-3 py-0 md:px-0",
        isElectron && "drag-region",
      )}
    >
      {backdropVariant ? <SidebarStageBackdrop variant={backdropVariant} /> : null}
      <SidebarTrigger
        className={cn("relative z-10 md:hidden", backdropVariant && BACKDROP_CONTROL_CLASS)}
      />
      <div className="relative z-10 ml-[var(--workspace-titlebar-content-left)] hidden min-w-0 items-center gap-1 md:flex">
        <SidebarBrand onBackdrop={backdropVariant !== null} />
        {isElectron ? (
          <div className="flex shrink-0 items-center">
            <HistoryNavigationButton direction="back" onBackdrop={backdropVariant !== null} />
            <HistoryNavigationButton direction="forward" onBackdrop={backdropVariant !== null} />
          </div>
        ) : null}
      </div>
      {pillLabel ? (
        <Badge
          className="relative z-10 ml-1 rounded-full px-1.5 text-muted-foreground"
          data-environment-identification="pill"
          size="sm"
          variant="secondary"
        >
          {pillLabel}
        </Badge>
      ) : null}
    </SidebarHeader>
  );
});

function HistoryNavigationButton({
  direction,
  onBackdrop,
}: {
  direction: HistoryDirection;
  onBackdrop: boolean;
}) {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const enabled = useCanNavigateHistory(direction);
  const label = direction === "back" ? "Go back" : "Go forward";
  const shortcutLabel = shortcutLabelForCommand(
    keybindings,
    direction === "back" ? "navigation.back" : "navigation.forward",
  );
  const Icon = direction === "back" ? ArrowLeftIcon : ArrowRightIcon;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            className={cn("[-webkit-app-region:no-drag]", onBackdrop && BACKDROP_CONTROL_CLASS)}
            disabled={!enabled}
            onClick={() => navigateHistory(direction)}
            size="icon-sm"
            variant="ghost"
          />
        }
      >
        <Icon className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        {label}
        {shortcutLabel ? ` (${shortcutLabel})` : ""}
      </TooltipPopup>
    </Tooltip>
  );
}

function SidebarBrand({ onBackdrop }: { onBackdrop: boolean }) {
  return (
    <Link
      aria-label="Go to threads"
      className={cn(
        "sidebar-brand relative z-10 h-7 w-fit min-w-0 items-center gap-1 overflow-hidden rounded-md outline-hidden ring-ring focus-visible:ring-2",
        onBackdrop ? "text-white" : "text-foreground",
      )}
      to="/"
    >
      <span
        className={cn(
          "truncate text-sm font-semibold tracking-tight",
          onBackdrop ? "text-white/70" : "text-muted-foreground",
        )}
      >
        {APP_BASE_NAME}
      </span>
    </Link>
  );
}

function SidebarUtilityItem({
  icon,
  label,
  onClick,
  ...rest
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  "aria-haspopup"?: "dialog";
}) {
  return (
    <SidebarMenuItem className="shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton aria-label={label} onClick={onClick} size="icon" {...rest}>
              {icon}
            </SidebarMenuButton>
          }
        />
        <TooltipPopup side="top">{label}</TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}

const SidebarUtilityMenu = memo(function SidebarUtilityMenu() {
  const navigate = useNavigate();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { isMobile, setOpenMobile } = useSidebar();
  const pullRequestsShortcutLabel = shortcutLabelForCommand(keybindings, "pullRequest.open");
  const closeMobileSidebar = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <SidebarMenu className="flex-row items-center">
      <SidebarUtilityItem
        icon={<SettingsIcon />}
        label="Settings"
        aria-haspopup="dialog"
        onClick={() => {
          closeMobileSidebar();
          void navigate({ to: "/settings" });
        }}
      />
      <SidebarUtilityItem
        icon={<PullRequestGlyph.pullRequest />}
        label={
          pullRequestsShortcutLabel
            ? `Pull requests (${pullRequestsShortcutLabel})`
            : "Pull requests"
        }
        onClick={() => {
          closeMobileSidebar();
          void navigate({ to: "/pull-requests" });
        }}
      />
      <SidebarMenuItem className="ml-auto flex min-w-0 flex-1">
        <SidebarProviderUpdatePill />
      </SidebarMenuItem>
    </SidebarMenu>
  );
});

export const SidebarChromeFooter = memo(function SidebarChromeFooter() {
  return (
    <SidebarFooter className="p-[var(--sidebar-content-inset)]">
      <SidebarUtilityMenu />
    </SidebarFooter>
  );
});
