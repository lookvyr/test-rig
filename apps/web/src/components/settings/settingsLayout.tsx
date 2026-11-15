import { DEFAULT_SERVER_SETTINGS, type ServerSettings } from "@t3tools/contracts";
import * as Equal from "effect/Equal";
import { InfoIcon, Undo2Icon } from "lucide-react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  createContext,
  type ComponentPropsWithoutRef,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SettingsGroup } from "./SettingsGroup";
import { useOptionalSettingsScope } from "./SettingsScopeContext";
import { SettingsScopeSentence } from "./SettingsScopeSentence";
import {
  isProjectScopedSettingKey,
  listProjectOverrides,
  type ProjectOverrideEntry,
  scopedSettingsAreMixed,
  scopedSettingsSource,
} from "./scopedSettings";
import { useClearProjectOverrides, useClearScopedSettings } from "./useScopedSettings";
import {
  SettingInheritance,
  type SettingInheritanceState,
  type SettingOverridingProject,
} from "./SettingInheritance";

const EMPTY_SETTING_KEYS: readonly (keyof ServerSettings)[] = [];

interface SettingsSearchTargetContextValue {
  readonly targetId: string | null;
  readonly onTargetHandled: () => void;
}

const noop = () => undefined;
const SettingsSearchTargetContext = createContext<SettingsSearchTargetContextValue>({
  targetId: null,
  onTargetHandled: noop,
});

export function SettingsSearchTargetProvider({
  targetId,
  onTargetHandled = noop,
  children,
}: {
  targetId: string | null;
  onTargetHandled?: () => void;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ targetId, onTargetHandled }), [onTargetHandled, targetId]);
  return <SettingsSearchTargetContext value={value}>{children}</SettingsSearchTargetContext>;
}

function scrollAndFocusSettingsTarget(target: HTMLElement): void {
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const scrollTarget =
    target.tagName === "SECTION" && target.firstElementChild
      ? (target.firstElementChild as HTMLElement)
      : target;

  scrollTarget.scrollIntoView({
    behavior: prefersReducedMotion ? "auto" : "smooth",
    block: "center",
  });
  target.focus({ preventScroll: true });
  target.classList.remove("settings-search-target-pulse");
  if (prefersReducedMotion) return;
  void target.offsetWidth;
  target.classList.add("settings-search-target-pulse");
  // The class also suppresses the focus outline (the pulse is the destination
  // indicator), so drop it once the element is no longer the destination.
  target.addEventListener("blur", () => target.classList.remove("settings-search-target-pulse"), {
    once: true,
  });
}

/** The row id a settings-search jump is currently trying to reach, if any. */
export function useSettingsSearchTargetId(): string | null {
  return useContext(SettingsSearchTargetContext).targetId;
}

export function useSettingsSearchTarget<T extends HTMLElement>(id: string | undefined) {
  const { targetId, onTargetHandled } = useContext(SettingsSearchTargetContext);
  const isSearchTarget = id !== undefined && id === targetId;
  const targetRef = useCallback(
    (target: T | null) => {
      if (target && isSearchTarget) {
        scrollAndFocusSettingsTarget(target);
        onTargetHandled();
      }
    },
    [isSearchTarget, onTargetHandled],
  );

  return targetRef;
}

/** Info affordance explaining how a setting interacts with the shared background policy. */
export function PolicyTooltip({ children }: { readonly children: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className="inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
            aria-label="Background policy details"
          >
            <InfoIcon className="size-3.5" />
          </button>
        }
      />
      <TooltipPopup side="top" className="max-w-72">
        {children}
      </TooltipPopup>
    </Tooltip>
  );
}

/** Re-render every `intervalMs`; return a stable timestamp snapshot for render-time relative labels. */
export function useRelativeTimeTick(intervalMs = 1_000) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return nowMs;
}

export function SettingsSection({
  title,
  hideTitle = false,
  icon,
  titleAction,
  headerAction,
  variant = "grouped",
  children,
  className,
  ...sectionProps
}: ComponentPropsWithoutRef<"section"> & {
  title: string;
  hideTitle?: boolean;
  icon?: ReactNode;
  titleAction?: ReactNode;
  headerAction?: ReactNode;
  variant?: "grouped" | "plain";
  children: ReactNode;
}) {
  const targetRef = useSettingsSearchTarget<HTMLElement>(sectionProps.id);

  return (
    <section
      {...sectionProps}
      ref={targetRef}
      tabIndex={sectionProps.id ? -1 : sectionProps.tabIndex}
      className={cn(!hideTitle && "space-y-2.5", className)}
    >
      {hideTitle ? (
        <h2 className="sr-only">{title}</h2>
      ) : (
        <div className="flex min-h-7 items-start justify-between gap-4 px-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-1">
            <h2 className="flex min-h-7 items-center gap-2 text-base font-semibold text-foreground">
              {icon}
              {title}
            </h2>
            {titleAction}
          </div>
          <div className="flex min-h-7 min-w-7 items-center justify-end">{headerAction}</div>
        </div>
      )}
      <SettingsGroup variant={variant}>{children}</SettingsGroup>
    </section>
  );
}

export function SettingsUnavailableGroup({
  children,
  message,
}: {
  children: ReactNode;
  message?: ReactNode;
}) {
  if (message === undefined) return children;

  return (
    <div className="border-border/60 bg-muted/20 py-1.5">
      <div className="flex items-start gap-2 px-3 py-2 text-xs leading-relaxed text-muted-foreground sm:px-4">
        <InfoIcon className="mt-0.5 size-3.5 shrink-0 text-warning" />
        <p>{message}</p>
      </div>
      <div className="[&_h3]:opacity-64 [&_p]:opacity-64">{children}</div>
    </div>
  );
}

function projectOverrides(
  context: ReturnType<typeof useOptionalSettingsScope>,
  scopedKeys: ReadonlyArray<keyof ServerSettings>,
): SettingOverridingProject[] {
  if (context === null || scopedKeys.length === 0) return [];
  return listProjectOverrides(context.connectedEnvironments, scopedKeys).flatMap((entry) => {
    const group = context.groups.find((candidate) =>
      candidate.memberProjects.some(
        (member) => member.environmentId === entry.environmentId && member.id === entry.projectId,
      ),
    );
    if (!group) return [];
    return [
      {
        ...entry,
        label: group.displayName,
        open: () =>
          context.selectScope({
            project: group.projectKey,
            ...(context.search.machine ? { machine: context.search.machine } : {}),
          }),
      },
    ];
  });
}

/**
 * One settings row. Rows for server settings pass `serverScoped` and the
 * `settingKeys` they edit so the page scope can mark mixed values, show where
 * a value comes from, reset project overrides, and lock environment-wide
 * settings while a project is selected.
 */
export function SettingsRow({
  title,
  description,
  status,
  resetAction,
  onResetOverride,
  control,
  serverScoped = false,
  settingKeys = EMPTY_SETTING_KEYS,
  mixed: mixedOverride,
  children,
  className,
  ...rowProps
}: Omit<ComponentPropsWithoutRef<"div">, "title"> & {
  title: ReactNode;
  description?: ReactNode;
  status?: ReactNode;
  resetAction?: ReactNode;
  /** Replaces the default override reset, which clears `settingKeys` on the selected project. */
  onResetOverride?: () => void;
  control?: ReactNode;
  serverScoped?: boolean;
  settingKeys?: readonly (keyof ServerSettings)[];
  mixed?: boolean;
  children?: ReactNode;
}) {
  const targetRef = useSettingsSearchTarget<HTMLDivElement>(rowProps.id);
  const context = useOptionalSettingsScope();
  const clearOverrides = useClearScopedSettings();
  const clearProjectOverrides = useClearProjectOverrides();
  const isProjectScope =
    context !== null && (context.scope.kind === "project" || context.scope.kind === "checkout");
  const scopedKeys = settingKeys.filter(isProjectScopedSettingKey);
  const environmentWide = isProjectScope && serverScoped && scopedKeys.length === 0;
  const mixed =
    mixedOverride ?? (context !== null && scopedSettingsAreMixed(context.targets, settingKeys));
  const source =
    context && isProjectScope ? scopedSettingsSource(context.targets, scopedKeys) : null;
  const unavailable =
    serverScoped && context !== null && context.connectedEnvironments.length === 0;
  const inheritedFrom =
    source === "environment" && context?.scope.environmentIds.length === 1
      ? (context.environments.find(
          (environment) => environment.environmentId === context.scope.environmentIds[0],
        )?.label ?? "environment")
      : "environment";
  const environmentSettingsById = new Map(
    (context?.connectedEnvironments ?? []).flatMap((environment) =>
      environment.serverConfig
        ? [[environment.environmentId, environment.serverConfig.settings] as const]
        : [],
    ),
  );
  const overridingProjects = isProjectScope ? [] : projectOverrides(context, scopedKeys);
  const renderedReset = unavailable ? null : isProjectScope && scopedKeys.length > 0 ? (
    source === "project" || source === "mixed" ? (
      <SettingResetButton
        label={typeof title === "string" ? title : "override"}
        tooltip="Reset to inherited value"
        onClick={() => (onResetOverride ? onResetOverride() : clearOverrides(scopedKeys))}
      />
    ) : null
  ) : (
    resetAction
  );
  const inertControl = (message: string) => (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            className="flex w-full items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring @min-[32rem]/settings-row:w-auto"
          />
        }
      >
        <div
          inert
          className="flex w-full items-center gap-2 opacity-50 @min-[32rem]/settings-row:w-auto"
        >
          {control}
        </div>
      </TooltipTrigger>
      <TooltipPopup side="top">{message}</TooltipPopup>
    </Tooltip>
  );
  const renderedControl =
    unavailable && control
      ? inertControl("Reconnect the selected environment to change this setting.")
      : environmentWide && control
        ? inertControl("Environment-wide setting. Select All projects to change it.")
        : control;
  const customized =
    context !== null &&
    settingKeys.some((key) =>
      context.targets.some((candidate) => {
        const environmentSettings = environmentSettingsById.get(candidate.environmentId);
        return (
          environmentSettings !== undefined &&
          !Equal.equals(environmentSettings[key], DEFAULT_SERVER_SETTINGS[key])
        );
      }),
    );
  const inheritance: { state: SettingInheritanceState; summary: string } = mixed
    ? { state: "mixed", summary: "Mixed across selected environments" }
    : source === "project"
      ? { state: "overridden", summary: "Overridden for this project" }
      : source === "t3.json"
        ? { state: "inherited", summary: "Inherited from the repository's t3.json" }
        : source === "environment" && scopedKeys.length > 0
          ? { state: "inherited", summary: `Inherited from ${inheritedFrom}` }
          : customized
            ? { state: "environment", summary: "Set on the environment" }
            : { state: "default", summary: "Built-in default" };
  // A lone environment with no project overrides has nothing to explain, so the marker stays out.
  const showsInheritance =
    context !== null &&
    serverScoped &&
    settingKeys.length > 0 &&
    (isProjectScope || mixed || overridingProjects.length > 0 || context.targets.length > 1);
  const renderedInheritance = showsInheritance ? (
    <SettingInheritance
      state={inheritance.state}
      summary={inheritance.summary}
      targets={context.targets}
      environments={context.connectedEnvironments}
      keys={settingKeys}
      overridingProjects={overridingProjects}
      onClearOverrides={(entries: readonly ProjectOverrideEntry[]) =>
        clearProjectOverrides(entries, scopedKeys)
      }
    />
  ) : null;

  return (
    <div
      {...rowProps}
      ref={targetRef}
      tabIndex={rowProps.id ? -1 : rowProps.tabIndex}
      data-slot="settings-row"
      className={cn(
        "group/settings-row @container/settings-row rounded-xl px-3 sm:px-4 aria-disabled:opacity-64 aria-disabled:[&_*]:text-muted-foreground",
        children ? "pt-3 pb-1" : "py-3",
        className,
      )}
    >
      <div className="flex flex-col gap-3 @min-[32rem]/settings-row:grid @min-[32rem]/settings-row:grid-cols-[minmax(0,1fr)_auto] @min-[32rem]/settings-row:items-center @min-[32rem]/settings-row:gap-8">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-h-5 items-center gap-1.5">
            <h3 className="text-sm font-medium text-foreground">{title}</h3>
            {renderedInheritance ? (
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
                {renderedInheritance}
              </span>
            ) : null}
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
              {renderedReset}
            </span>
          </div>
          {description ? (
            <p className="max-w-2xl text-pretty text-xs leading-normal text-muted-foreground">
              {description}
            </p>
          ) : null}
          {status ? <div className="pt-0.5 text-xs text-muted-foreground">{status}</div> : null}
        </div>
        {renderedControl ? (
          <div className="flex w-full min-w-0 shrink-0 items-center gap-2 @min-[32rem]/settings-row:w-auto @min-[32rem]/settings-row:justify-end @min-[32rem]/settings-row:[&_[data-slot=select-trigger]]:min-w-40">
            {renderedControl}
          </div>
        ) : null}
      </div>
      {(unavailable || environmentWide) && children ? (
        <div inert className="opacity-50">
          {children}
        </div>
      ) : (
        children
      )}
    </div>
  );
}

export function SettingResetButton({
  label,
  tooltip = "Reset to default",
  disabled = false,
  onClick,
}: {
  label: string;
  tooltip?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-micro"
            variant="ghost-muted"
            aria-label={`Reset ${label} to default`}
            disabled={disabled}
            onClick={(event) => {
              event.stopPropagation();
              onClick();
            }}
          >
            <Undo2Icon className="size-3" />
          </Button>
        }
      />
      <TooltipPopup side="top">{tooltip}</TooltipPopup>
    </Tooltip>
  );
}

export function SettingsPageContainer({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const navigate = useNavigate();
  const hash = useLocation({ select: (location) => location.hash });
  const targetId = hash.replace(/^#/, "") || null;
  const clearTargetHash = useCallback(() => {
    void navigate({ hash: "", replace: true, resetScroll: false, hashScrollIntoView: false });
  }, [navigate]);

  return (
    <SettingsSearchTargetProvider targetId={targetId} onTargetHandled={clearTargetHash}>
      <div
        className="settings-page-scroll-fade scrollbar-gutter-both flex-1 overflow-y-auto"
        data-settings-page-scroll
      >
        <div
          className={cn(
            "mx-auto flex w-full max-w-4xl flex-col gap-8 px-5 pt-6 pb-12 sm:px-6",
            className,
          )}
        >
          <SettingsScopeSentence />
          {children}
        </div>
      </div>
    </SettingsSearchTargetProvider>
  );
}

export function scrollToSettingsTarget(targetId: string): boolean {
  const target = document.getElementById(targetId);
  if (!target) return false;
  scrollAndFocusSettingsTarget(target);
  return true;
}
