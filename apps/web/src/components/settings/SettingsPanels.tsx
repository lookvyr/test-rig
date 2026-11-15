import { ThreadTitleInstructionsSettings } from "./ThreadTitleInstructionsSettings";
import {
  isDefaultThreadDetailsVisibility,
  resolveThreadDetailsVisibility,
} from "../chat/threadDetailsItems";
import { AdvancedSettings } from "./AdvancedSettings";
import {
  StorageCleanupSections,
  WorktreeCleanupSection,
  WorktreesDirectoryRow,
} from "./StorageSettings";
import { BranchNamingSection } from "./BranchNamingSettings";
import { AutoSettleRows, SidebarWorkingShelfRow } from "./LabsSettingsPanel";
import { ScopedSwitch } from "./ScopedSwitch";
import {
  useScopedServerProviders,
  useScopedSettings,
  useUpdateScopedSettings,
} from "./useScopedSettings";
import { presentThreadShell } from "@t3tools/client-runtime/state/models";
import { ArchiveIcon, ArchiveX, Trash2Icon, LoaderIcon, SettingsIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import {
  type BackgroundActivityProfile,
  ProviderDriverKind,
  type ResponseStreamingMode,
  type SidebarProjectGroupingMode,
  type SendShortcut,
  type SidebarProjectSortOrder,
  type ServerSettings,
  type WorktreeSubmodules,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import type { UnifiedSettings } from "@t3tools/contracts/settings";
import { runtimeModeConfig, runtimeModeOptions } from "../chat/runtimeModeConfig";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  ToolCallVisibility,
  DEFAULT_ENVIRONMENT_IDENTIFICATION_MODE,
  DEFAULT_UNIFIED_SETTINGS,
  type EnvironmentIdentificationMode,
  MAX_CODE_FONT_SIZE,
  MAX_GLASS_OPACITY,
  MAX_INTERFACE_FONT_SIZE,
  MAX_PROMPT_FONT_SIZE,
  MAX_TERMINAL_FONT_SIZE,
  MIN_CODE_FONT_SIZE,
  MIN_GLASS_OPACITY,
  MIN_INTERFACE_FONT_SIZE,
  MIN_PROMPT_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
} from "@t3tools/contracts/settings";
import { resolveServerBackgroundActivitySettings } from "@t3tools/shared/backgroundActivitySettings";
import { createModelSelection } from "@t3tools/shared/model";
import * as Duration from "effect/Duration";
import * as Equal from "effect/Equal";
import * as Schema from "effect/Schema";
import { APP_VERSION } from "../../branding";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import {
  resolveEnvironmentIdentificationPillLabel,
  useEnvironmentStageLabel,
} from "../SidebarStageBackdrop";
import { useCustomThemes } from "../../hooks/useCustomThemes";
import {
  readAppearanceModePreference,
  readThemeHalves,
  readThemePreference,
  useTheme,
} from "../../hooks/useTheme";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import {
  useClientSettings,
  usePrimarySettings,
  useUpdateClientSettings,
  useUpdatePrimarySettings,
} from "../../hooks/useSettings";
import { useThreadActions } from "../../hooks/useThreadActions";
import {
  getCustomModelOptionsByInstance,
  resolveAppModelSelectionState,
} from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { ensureLocalApi, readLocalApi } from "../../localApi";
import { isMacPlatform } from "../../lib/utils";
import { primaryServerObservabilityAtom } from "../../state/server";
import { useProjects } from "../../state/entities";
import { useArchivedThreadSnapshots } from "../../lib/archivedThreadsState";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { DraftInput } from "../ui/draft-input";
import { Input } from "../ui/input";
import {
  DEFAULT_CODE_FONT_STACK,
  DEFAULT_SANS_FONT_STACK,
  isFontFamilyAvailable,
  isMonospaceFamily,
  resolveDefaultFamilyLabel,
  resolveTerminalFontPreference,
  TYPOGRAPHY_ADVANCED_STORAGE_KEY,
} from "../../appearanceFonts";
import { CodeFontPreview, PromptFontPreview, TerminalFontPreview } from "./SettingsFontPreviews";
import { discoverInstalledFonts, FontFamilyPicker, useFontEnumeration } from "./FontFamilyPicker";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "../ui/number-field";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ThemeLibrary } from "./ThemeSettings";
import {
  backgroundActivityOverrideSettings,
  backgroundActivitySharedPolicySettings,
  durationToSeconds,
  formatDiagnosticsDescription,
  normalizeIntervalSeconds,
  PROVIDER_HEALTH_INTERVAL_STEP_SECONDS,
  hasChangedBackgroundActivitySettings,
  isProjectGroupingEnabled,
  projectGroupingModeFromToggle,
  readLastEnabledProjectGroupingMode,
  rememberEnabledProjectGroupingMode,
  resolveBackgroundActivityProfileOption,
} from "./SettingsPanels.logic";
import {
  PolicyTooltip,
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
  useSettingsSearchTargetId,
} from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { SnoozePresetsRow } from "./SnoozePresetsSettings";
import { ThreadDetailsItemsRow } from "./ThreadDetailsItemsRow";
import { ProjectFavicon } from "../ProjectFavicon";

const ENVIRONMENT_IDENTIFICATION_LABELS: Record<EnvironmentIdentificationMode, string> = {
  artwork: "Artwork",
  pill: "Version pill",
  none: "None",
};

const RESPONSE_STREAMING_MODE_LABELS: Record<ResponseStreamingMode, string> = {
  turn: "Wait for the full response",
  paragraph: "Show finished paragraphs",
};

const RESPONSE_STREAMING_MODE_DESCRIPTIONS: Record<ResponseStreamingMode, string> = {
  turn: "Text appears once the agent finishes its turn.",
  paragraph: "Each paragraph or code block appears as soon as it is complete.",
};

const TIMESTAMP_FORMAT_LABELS = {
  locale: "System default",
  "12-hour": "12-hour",
  "24-hour": "24-hour",
} as const;

const BACKGROUND_ACTIVITY_PROFILE_LABELS: Record<BackgroundActivityProfile, string> = {
  balanced: "Balanced",
  performance: "Performance",
  "battery-saver": "Battery saver",
};

type BackgroundActivityProfileOption = BackgroundActivityProfile | "advanced";

const BACKGROUND_ACTIVITY_PROFILE_OPTION_LABELS: Record<BackgroundActivityProfileOption, string> = {
  ...BACKGROUND_ACTIVITY_PROFILE_LABELS,
  advanced: "Advanced",
};

const BACKGROUND_ACTIVITY_PROFILE_DESCRIPTIONS: Record<BackgroundActivityProfile, string> = {
  balanced:
    "Pauses background probes when clients are idle, the host is locked, or low power mode is active.",
  performance: "Allows scoped background probes while any subscribed client remains connected.",
  "battery-saver": "Also pauses background probes when the host or client is on battery.",
};

const ADVANCED_BACKGROUND_ACTIVITY_DESCRIPTION =
  "Uses custom background intervals with the selected shared power policy.";

const DEFAULT_DRIVER_KIND = ProviderDriverKind.make("codex");
const BACKGROUND_ACTIVITY_BOOLEAN_OVERRIDES: ReadonlyArray<{
  readonly key:
    | "pauseWhenHostLocked"
    | "pauseWhenHostLowPower"
    | "pauseWhenClientLowPower"
    | "pauseWhenOnBattery";
  readonly label: string;
}> = [
  { key: "pauseWhenHostLocked", label: "Pause when host is locked" },
  { key: "pauseWhenHostLowPower", label: "Pause on host low power" },
  { key: "pauseWhenClientLowPower", label: "Pause on client low power" },
  { key: "pauseWhenOnBattery", label: "Pause on battery" },
];

function resetBackgroundActivitySettings() {
  return {
    backgroundActivity: DEFAULT_UNIFIED_SETTINGS.backgroundActivity,
  };
}

function backgroundActivityProfileSettings(profile: BackgroundActivityProfile) {
  return {
    backgroundActivity: {
      schemaVersion: 1 as const,
      profile,
      overrides: {},
    },
  };
}

function AboutVersionTitle() {
  return (
    <span className="inline-flex items-center gap-2">
      <span>Version</span>
      <code className="text-[11px] font-medium text-muted-foreground">{APP_VERSION}</code>
    </span>
  );
}

function AboutVersionSection() {
  return (
    <SettingsRow title={<AboutVersionTitle />} description="Current version of the application." />
  );
}

export function useSettingsRestore(onRestored?: () => void) {
  const {
    theme,
    setTheme,
    followSystem,
    setFollowSystem,
    setThemeHalf,
    clearThemeHalves,
    themeHalves,
  } = useTheme();
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();

  const isTextGenerationModelDirty = !Equal.equals(
    settings.textGenerationModelSelection ?? null,
    DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection ?? null,
  );
  const isBackgroundActivityDirty = hasChangedBackgroundActivitySettings(settings);

  const changedSettingLabels = useMemo(
    () => [
      ...(theme !== "system" ? ["Theme"] : []),
      ...(!followSystem ? ["Follow system"] : []),
      ...(themeHalves !== null ? ["Theme mix"] : []),
      ...(settings.glassOpacity !== DEFAULT_UNIFIED_SETTINGS.glassOpacity ? ["Glass opacity"] : []),
      ...(settings.environmentIdentificationMode !==
      DEFAULT_UNIFIED_SETTINGS.environmentIdentificationMode
        ? ["Environment identification"]
        : []),
      ...(settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat
        ? ["Time format"]
        : []),
      ...(settings.sidebarWorkingShelfEnabled !==
      DEFAULT_UNIFIED_SETTINGS.sidebarWorkingShelfEnabled
        ? ["Working section"]
        : []),
      ...(!isDefaultThreadDetailsVisibility(resolveThreadDetailsVisibility(settings))
        ? ["Thread details"]
        : []),
      ...(settings.fontSizeInterface !== DEFAULT_UNIFIED_SETTINGS.fontSizeInterface ||
      settings.fontSizePrompt !== DEFAULT_UNIFIED_SETTINGS.fontSizePrompt ||
      settings.fontSizeCode !== DEFAULT_UNIFIED_SETTINGS.fontSizeCode ||
      settings.fontSizeTerminal !== DEFAULT_UNIFIED_SETTINGS.fontSizeTerminal
        ? ["Font sizes"]
        : []),
      ...(settings.fontSmoothing !== DEFAULT_UNIFIED_SETTINGS.fontSmoothing
        ? ["Font smoothing"]
        : []),
      ...(settings.sidebarProjectGroupingMode !==
      DEFAULT_UNIFIED_SETTINGS.sidebarProjectGroupingMode
        ? ["Project Grouping"]
        : []),
      ...(settings.wordWrap !== DEFAULT_UNIFIED_SETTINGS.wordWrap ? ["Word wrap"] : []),
      ...(settings.persistComposerContextStrip !==
      DEFAULT_UNIFIED_SETTINGS.persistComposerContextStrip
        ? ["Composer context"]
        : []),
      ...(settings.toolCallVisibility !== DEFAULT_UNIFIED_SETTINGS.toolCallVisibility
        ? ["Tool calls in chat"]
        : []),
      ...(settings.fontFamilySans !== DEFAULT_UNIFIED_SETTINGS.fontFamilySans
        ? ["Interface font"]
        : []),
      ...(settings.fontFamilyComposer !== DEFAULT_UNIFIED_SETTINGS.fontFamilyComposer
        ? ["Prompt font"]
        : []),
      ...(settings.redesignEnabled !== DEFAULT_UNIFIED_SETTINGS.redesignEnabled
        ? ["New design"]
        : []),
      ...(settings.fontFamilyCode !== DEFAULT_UNIFIED_SETTINGS.fontFamilyCode ? ["Code font"] : []),
      ...(settings.fontFamilyTerminal !== DEFAULT_UNIFIED_SETTINGS.fontFamilyTerminal
        ? ["Terminal font"]
        : []),
      ...(settings.diffIgnoreWhitespace !== DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace
        ? ["Diff whitespace changes"]
        : []),
      ...(settings.responseStreamingMode !== DEFAULT_UNIFIED_SETTINGS.responseStreamingMode
        ? ["Response streaming"]
        : []),
      ...(isBackgroundActivityDirty ? ["Background activity"] : []),
      ...(settings.defaultThreadEnvMode !== DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode
        ? ["New thread mode"]
        : []),
      ...(settings.newWorktreesStartFromOrigin !==
      DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin
        ? ["New worktrees start from origin"]
        : []),
      ...(!Equal.equals(settings.storageCleanup, DEFAULT_UNIFIED_SETTINGS.storageCleanup)
        ? ["Storage cleanup"]
        : []),
      ...(settings.worktreesDirectory !== DEFAULT_UNIFIED_SETTINGS.worktreesDirectory
        ? ["Worktree location"]
        : []),
      ...(settings.autoResumeLimitedThreads !== DEFAULT_UNIFIED_SETTINGS.autoResumeLimitedThreads
        ? ["Auto-resume limited threads"]
        : []),
      ...(settings.snoozeLimitedThreads !== DEFAULT_UNIFIED_SETTINGS.snoozeLimitedThreads
        ? ["Snooze limited threads"]
        : []),
      ...(!Equal.equals(settings.snoozePresets, DEFAULT_UNIFIED_SETTINGS.snoozePresets)
        ? ["Snooze options"]
        : []),
      ...(settings.compactIdleThreads !== DEFAULT_UNIFIED_SETTINGS.compactIdleThreads
        ? ["Compact idle threads"]
        : []),
      ...(settings.addProjectBaseDirectory !== DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory
        ? ["Add project base directory"]
        : []),
      ...(settings.confirmThreadArchive !== DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive
        ? ["Archive confirmation"]
        : []),
      ...(settings.confirmThreadDelete !== DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete
        ? ["Delete confirmation"]
        : []),
      ...(isTextGenerationModelDirty ? ["Text generation model"] : []),
      ...(settings.threadTitleInstructions !== "" ? ["Thread title instructions"] : []),
    ],
    [
      isTextGenerationModelDirty,
      settings.threadTitleInstructions,
      isBackgroundActivityDirty,
      settings.confirmThreadArchive,
      settings.confirmThreadDelete,
      settings.addProjectBaseDirectory,
      settings.defaultThreadEnvMode,
      settings.storageCleanup,
      settings.worktreesDirectory,
      settings.autoResumeLimitedThreads,
      settings.snoozeLimitedThreads,
      settings.snoozePresets,
      settings.compactIdleThreads,
      settings.newWorktreesStartFromOrigin,
      settings.diffIgnoreWhitespace,
      settings.environmentIdentificationMode,
      settings.redesignEnabled,
      settings.fontFamilyCode,
      settings.fontFamilyComposer,
      settings.fontFamilySans,
      settings.fontFamilyTerminal,
      settings.fontSizeCode,
      settings.fontSizeInterface,
      settings.fontSizePrompt,
      settings.fontSizeTerminal,
      settings.glassOpacity,
      settings.responseStreamingMode,
      settings.sidebarProjectGroupingMode,
      settings.sidebarWorkingShelfEnabled,
      settings.sidebarProjectSortOrder,
      settings.defaultModelSelection,
      settings.defaultRuntimeMode,
      settings.threadDetailsItems,
      settings.fontSmoothing,
      settings.timestampFormat,
      settings.wordWrap,
      settings.persistComposerContextStrip,
      followSystem,
      theme,
    ],
  );

  const restoreDefaults = useCallback(async () => {
    if (changedSettingLabels.length === 0) return;
    const api = readLocalApi();
    const confirmed = await (api ?? ensureLocalApi()).dialogs.confirm(
      ["Restore device defaults?", `This will reset: ${changedSettingLabels.join(", ")}.`].join(
        "\n",
      ),
    );
    if (!confirmed) return;

    // Only touch the theme keys that are actually dirty, so a theme-storage
    // failure cannot block restoring unrelated settings. Preferences are
    // re-read after the confirmation dialog: they may have changed (another
    // tab, an OS flip) while it was open, and rollback must restore the live
    // values rather than the ones captured at render time.
    let previousTheme = theme;
    try {
      previousTheme = readThemePreference();
    } catch {
      // Storage is unreadable; the render-time value is the best rollback.
    }
    // The mix may have changed while the confirmation dialog was open; both
    // the dirty check and the rollback must see the live value.
    const liveHalves = readThemeHalves();
    const needsThemeReset = previousTheme !== "system";
    const needsMixReset = liveHalves !== null;
    // Same for the appearance mode: trusting the render-time value would skip
    // the reset and report success while a non-system mode stayed in storage.
    const needsFollowSystemReset = readAppearanceModePreference(previousTheme) !== "system";
    const notifyThemeRestoreFailure = () => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Couldn’t restore theme settings",
          description: "Try again.",
        }),
      );
    };
    // Rollback restores the base preference first (which clears any mix) and
    // then re-applies the captured mix on top, so no failure path can leave
    // the pair of keys half-restored.
    const previousHalves = liveHalves;
    const rollbackThemeState = () => {
      if (needsThemeReset) setTheme(previousTheme);
      if (previousHalves?.light) setThemeHalf("light", previousHalves.light);
      if (previousHalves?.dark) setThemeHalf("dark", previousHalves.dark);
    };
    if (needsThemeReset && !setTheme("system")) {
      notifyThemeRestoreFailure();
      return;
    }
    if (needsMixReset && !clearThemeHalves()) {
      rollbackThemeState();
      notifyThemeRestoreFailure();
      return;
    }
    if (needsFollowSystemReset && !setFollowSystem(true)) {
      rollbackThemeState();
      notifyThemeRestoreFailure();
      return;
    }
    updateSettings({
      timestampFormat: DEFAULT_UNIFIED_SETTINGS.timestampFormat,
      wordWrap: DEFAULT_UNIFIED_SETTINGS.wordWrap,
      persistComposerContextStrip: DEFAULT_UNIFIED_SETTINGS.persistComposerContextStrip,
      toolCallVisibility: DEFAULT_UNIFIED_SETTINGS.toolCallVisibility,
      diffIgnoreWhitespace: DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace,
      environmentIdentificationMode: DEFAULT_UNIFIED_SETTINGS.environmentIdentificationMode,
      glassOpacity: DEFAULT_UNIFIED_SETTINGS.glassOpacity,
      sidebarWorkingShelfEnabled: DEFAULT_UNIFIED_SETTINGS.sidebarWorkingShelfEnabled,
      sidebarProjectSortOrder: DEFAULT_UNIFIED_SETTINGS.sidebarProjectSortOrder,
      defaultModelSelection: null,
      defaultRuntimeMode: DEFAULT_UNIFIED_SETTINGS.defaultRuntimeMode,
      threadDetailsItems: {},
      fontSizeInterface: DEFAULT_UNIFIED_SETTINGS.fontSizeInterface,
      fontSizePrompt: DEFAULT_UNIFIED_SETTINGS.fontSizePrompt,
      fontSizeCode: DEFAULT_UNIFIED_SETTINGS.fontSizeCode,
      fontSizeTerminal: DEFAULT_UNIFIED_SETTINGS.fontSizeTerminal,
      fontSmoothing: DEFAULT_UNIFIED_SETTINGS.fontSmoothing,
      sidebarProjectGroupingMode: DEFAULT_UNIFIED_SETTINGS.sidebarProjectGroupingMode,
      responseStreamingMode: DEFAULT_UNIFIED_SETTINGS.responseStreamingMode,
      backgroundActivity: DEFAULT_UNIFIED_SETTINGS.backgroundActivity,
      backgroundActivityProfile: DEFAULT_UNIFIED_SETTINGS.backgroundActivityProfile,
      automaticGitFetchInterval: DEFAULT_UNIFIED_SETTINGS.automaticGitFetchInterval,
      providerHealthRefreshInterval: DEFAULT_UNIFIED_SETTINGS.providerHealthRefreshInterval,
      defaultThreadEnvMode: DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode,
      storageCleanup: DEFAULT_UNIFIED_SETTINGS.storageCleanup,
      worktreesDirectory: DEFAULT_UNIFIED_SETTINGS.worktreesDirectory,
      autoResumeLimitedThreads: DEFAULT_UNIFIED_SETTINGS.autoResumeLimitedThreads,
      snoozeLimitedThreads: DEFAULT_UNIFIED_SETTINGS.snoozeLimitedThreads,
      snoozePresets: DEFAULT_UNIFIED_SETTINGS.snoozePresets,
      compactIdleThreads: DEFAULT_UNIFIED_SETTINGS.compactIdleThreads,
      newWorktreesStartFromOrigin: DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin,
      addProjectBaseDirectory: DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory,
      confirmThreadArchive: DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive,
      confirmThreadDelete: DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete,
      textGenerationModelSelection: DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
      threadTitleInstructions: DEFAULT_UNIFIED_SETTINGS.threadTitleInstructions,
      redesignEnabled: DEFAULT_UNIFIED_SETTINGS.redesignEnabled,
      fontFamilySans: DEFAULT_UNIFIED_SETTINGS.fontFamilySans,
      fontFamilyComposer: DEFAULT_UNIFIED_SETTINGS.fontFamilyComposer,
      fontFamilyCode: DEFAULT_UNIFIED_SETTINGS.fontFamilyCode,
      fontFamilyTerminal: DEFAULT_UNIFIED_SETTINGS.fontFamilyTerminal,
    });
    onRestored?.();
  }, [
    changedSettingLabels,
    clearThemeHalves,
    onRestored,
    setFollowSystem,
    setTheme,
    setThemeHalf,
    theme,
    themeHalves,
    updateSettings,
  ]);

  return {
    changedSettingLabels,
    restoreDefaults,
  };
}

function BackgroundActivityAdvancedDialog({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const resolvedBackgroundActivity = resolveServerBackgroundActivitySettings(settings);
  const activeProfile = resolvedBackgroundActivity.profile;
  const automaticGitFetchIntervalSeconds = durationToSeconds(
    resolvedBackgroundActivity.automaticGitFetchInterval,
  );
  const providerHealthRefreshIntervalSeconds = durationToSeconds(
    resolvedBackgroundActivity.providerHealthRefreshInterval,
  );
  const hostPowerMonitorActiveIntervalSeconds = durationToSeconds(
    resolvedBackgroundActivity.hostPowerMonitorActiveInterval,
  );
  const hostPowerMonitorIdleIntervalSeconds = durationToSeconds(
    resolvedBackgroundActivity.hostPowerMonitorIdleInterval,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Background Activity</DialogTitle>
          <DialogDescription>
            Tune the shared power policy and the background intervals that feed it.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-0 px-6 pb-5">
          <div className="overflow-hidden rounded-xl border bg-card text-card-foreground">
            <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="text-sm font-medium">Shared policy</div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Controls whether background work may run after a subscribed interval fires.
                </p>
              </div>
              <Select
                value={activeProfile}
                onValueChange={(value) => {
                  if (
                    value === "balanced" ||
                    value === "performance" ||
                    value === "battery-saver"
                  ) {
                    updateSettings({
                      backgroundActivity: backgroundActivitySharedPolicySettings(settings, value),
                    });
                  }
                }}
              >
                <SelectTrigger className="w-full sm:w-40" aria-label="Shared background policy">
                  <SelectValue>{BACKGROUND_ACTIVITY_PROFILE_LABELS[activeProfile]}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem hideIndicator value="balanced">
                    {BACKGROUND_ACTIVITY_PROFILE_LABELS.balanced}
                  </SelectItem>
                  <SelectItem hideIndicator value="performance">
                    {BACKGROUND_ACTIVITY_PROFILE_LABELS.performance}
                  </SelectItem>
                  <SelectItem hideIndicator value="battery-saver">
                    {BACKGROUND_ACTIVITY_PROFILE_LABELS["battery-saver"]}
                  </SelectItem>
                </SelectPopup>
              </Select>
            </div>

            <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="text-sm font-medium">Git fetch interval</div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Refresh remote branch status in the background.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <NumberField
                  value={automaticGitFetchIntervalSeconds}
                  min={0}
                  step={5}
                  size="sm"
                  className="w-32"
                  onValueChange={(value) =>
                    updateSettings(
                      backgroundActivityOverrideSettings(
                        settings.backgroundActivity,
                        resolvedBackgroundActivity,
                        {
                          automaticGitFetchInterval: Duration.seconds(
                            normalizeIntervalSeconds(value),
                          ),
                        },
                      ),
                    )
                  }
                >
                  <NumberFieldGroup>
                    <NumberFieldDecrement aria-label="Decrease Git fetch interval" />
                    <NumberFieldInput aria-label="Git fetch interval in seconds" />
                    <NumberFieldIncrement aria-label="Increase Git fetch interval" />
                  </NumberFieldGroup>
                </NumberField>
                <span className="text-xs text-muted-foreground">seconds</span>
              </div>
            </div>

            <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="text-sm font-medium">Provider health interval</div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Refresh provider availability, versions, auth state, and model metadata.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <NumberField
                  value={providerHealthRefreshIntervalSeconds}
                  min={0}
                  step={PROVIDER_HEALTH_INTERVAL_STEP_SECONDS}
                  size="sm"
                  className="w-32"
                  onValueChange={(value) =>
                    updateSettings(
                      backgroundActivityOverrideSettings(
                        settings.backgroundActivity,
                        resolvedBackgroundActivity,
                        {
                          providerHealthRefreshInterval: Duration.seconds(
                            normalizeIntervalSeconds(value),
                          ),
                        },
                      ),
                    )
                  }
                >
                  <NumberFieldGroup>
                    <NumberFieldDecrement aria-label="Decrease provider health interval" />
                    <NumberFieldInput aria-label="Provider health interval in seconds" />
                    <NumberFieldIncrement aria-label="Increase provider health interval" />
                  </NumberFieldGroup>
                </NumberField>
                <span className="text-xs text-muted-foreground">seconds</span>
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="text-sm font-medium">Host power monitor</div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Poll host power state while clients are active.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <NumberField
                  value={hostPowerMonitorActiveIntervalSeconds}
                  min={5}
                  step={5}
                  size="sm"
                  className="w-32"
                  onValueChange={(value) =>
                    updateSettings(
                      backgroundActivityOverrideSettings(
                        settings.backgroundActivity,
                        resolvedBackgroundActivity,
                        {
                          hostPowerMonitorActiveInterval: Duration.seconds(
                            normalizeIntervalSeconds(value, 5),
                          ),
                        },
                      ),
                    )
                  }
                >
                  <NumberFieldGroup>
                    <NumberFieldDecrement aria-label="Decrease active host power interval" />
                    <NumberFieldInput aria-label="Active host power interval in seconds" />
                    <NumberFieldIncrement aria-label="Increase active host power interval" />
                  </NumberFieldGroup>
                </NumberField>
                <span className="text-xs text-muted-foreground">seconds</span>
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="text-sm font-medium">Idle host monitor</div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Poll host power state when no foreground client is active.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <NumberField
                  value={hostPowerMonitorIdleIntervalSeconds}
                  min={5}
                  step={30}
                  size="sm"
                  className="w-32"
                  onValueChange={(value) =>
                    updateSettings(
                      backgroundActivityOverrideSettings(
                        settings.backgroundActivity,
                        resolvedBackgroundActivity,
                        {
                          hostPowerMonitorIdleInterval: Duration.seconds(
                            normalizeIntervalSeconds(value, 5),
                          ),
                        },
                      ),
                    )
                  }
                >
                  <NumberFieldGroup>
                    <NumberFieldDecrement aria-label="Decrease idle host power interval" />
                    <NumberFieldInput aria-label="Idle host power interval in seconds" />
                    <NumberFieldIncrement aria-label="Increase idle host power interval" />
                  </NumberFieldGroup>
                </NumberField>
                <span className="text-xs text-muted-foreground">seconds</span>
              </div>
            </div>

            <div className="grid gap-0 border-t sm:grid-cols-2">
              {BACKGROUND_ACTIVITY_BOOLEAN_OVERRIDES.map(({ key, label }) => (
                <label
                  key={key}
                  className="flex items-center justify-between gap-3 border-b px-4 py-3 last:border-b-0 sm:border-r sm:even:border-r-0"
                >
                  <span className="text-sm font-medium">{label}</span>
                  <Switch
                    checked={resolvedBackgroundActivity[key]}
                    onCheckedChange={(checked) =>
                      updateSettings(
                        backgroundActivityOverrideSettings(
                          settings.backgroundActivity,
                          resolvedBackgroundActivity,
                          {
                            [key]: Boolean(checked),
                          },
                        ),
                      )
                    }
                    aria-label={label}
                  />
                </label>
              ))}
            </div>
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => updateSettings(resetBackgroundActivitySettings())}
          >
            Reset all
          </Button>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function AppearanceSettingsPanel() {
  const {
    appearanceMode,
    refreshTheme,
    resolvedTheme,
    setAppearanceMode,
    setTheme,
    setThemeHalf,
    theme,
    themeHalves,
  } = useTheme();
  const customThemes = useCustomThemes();
  const [isImportThemeOpen, setIsImportThemeOpen] = useState(false);
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const environmentStageLabel = useEnvironmentStageLabel();
  const showEnvironmentIdentification =
    resolveEnvironmentIdentificationPillLabel(environmentStageLabel) !== null;
  const glassOpacityRatio =
    (settings.glassOpacity - MIN_GLASS_OPACITY) / (MAX_GLASS_OPACITY - MIN_GLASS_OPACITY);
  const glassOpacitySliderStyle = {
    "--settings-slider-progress": `${glassOpacityRatio * 100}%`,
    "--settings-slider-fill-offset": `${0.5 - glassOpacityRatio}rem`,
  } as CSSProperties;

  return (
    <SettingsPageContainer>
      <SettingsSection id="appearance" title="Colors & themes" variant="plain" hideTitle>
        <div id={searchableSetting("theme").id}>
          <ThemeLibrary
            appearanceMode={appearanceMode}
            customThemes={customThemes}
            initialAppearance={resolvedTheme}
            refreshTheme={refreshTheme}
            isImportOpen={isImportThemeOpen}
            setAppearanceMode={setAppearanceMode}
            setTheme={setTheme}
            setThemeHalf={setThemeHalf}
            theme={theme}
            themeHalves={themeHalves}
            onImportOpenChange={setIsImportThemeOpen}
          />
        </div>
      </SettingsSection>

      <SettingsSection id="appearance-interface" title="Interface">
        <SettingsRow
          {...searchableSetting("setting-glass-opacity")}
          description="Control how transparent glass surfaces are. Higher values make menus, dialogs, and the composer more solid."
          resetAction={
            settings.glassOpacity !== DEFAULT_UNIFIED_SETTINGS.glassOpacity ? (
              <SettingResetButton
                label="glass opacity"
                onClick={() =>
                  updateSettings({ glassOpacity: DEFAULT_UNIFIED_SETTINGS.glassOpacity })
                }
              />
            ) : null
          }
          control={
            <div className="flex w-full items-center gap-3 sm:w-52">
              <output
                className="min-w-12 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
                htmlFor="glass-opacity"
              >
                {settings.glassOpacity}%
              </output>
              <input
                aria-label="Glass opacity"
                className="settings-slider min-w-0 flex-1"
                id="glass-opacity"
                max={MAX_GLASS_OPACITY}
                min={MIN_GLASS_OPACITY}
                onChange={(event) => {
                  const glassOpacity = Number(event.currentTarget.value);
                  if (
                    Number.isInteger(glassOpacity) &&
                    glassOpacity >= MIN_GLASS_OPACITY &&
                    glassOpacity <= MAX_GLASS_OPACITY
                  ) {
                    updateSettings({ glassOpacity });
                  }
                }}
                step={5}
                style={glassOpacitySliderStyle}
                type="range"
                value={settings.glassOpacity}
              />
            </div>
          }
        />
        <ClientSelectRow
          settingKey="chatWidth"
          {...searchableSetting("chat-width")}
          description="Maximum width of messages and the composer."
          ariaLabel="Chat width"
          options={[
            ["comfortable", "Comfortable"],
            ["wide", "Wide"],
            ["full", "Full"],
          ]}
        />
        <ThreadDetailsItemsRow />
        <ClientSelectRow
          settingKey="effortDisplay"
          {...searchableSetting("effort-display")}
          description="Show reasoning effort in the composer as its name or as bars."
          ariaLabel="Effort display"
          options={[
            ["label", "Word"],
            ["bars", "Bars"],
          ]}
        />
        <AdvancedSettings
          targetIds={[
            "appearance-interface",
            searchableSetting("environment-identification").id,
            searchableSetting("composer-context").id,
          ]}
        >
          {showEnvironmentIdentification ? (
            <SettingsRow
              {...searchableSetting("environment-identification")}
              description="Choose how Dev and Nightly environments are identified."
              resetAction={
                settings.environmentIdentificationMode !==
                DEFAULT_ENVIRONMENT_IDENTIFICATION_MODE ? (
                  <SettingResetButton
                    label="environment identification"
                    onClick={() =>
                      updateSettings({
                        environmentIdentificationMode: DEFAULT_ENVIRONMENT_IDENTIFICATION_MODE,
                      })
                    }
                  />
                ) : null
              }
              control={
                <Select
                  value={settings.environmentIdentificationMode}
                  onValueChange={(value) => {
                    if (value === "artwork" || value === "pill" || value === "none") {
                      updateSettings({ environmentIdentificationMode: value });
                    }
                  }}
                >
                  <SelectTrigger className="w-full sm:w-40" aria-label="Environment identification">
                    <SelectValue>
                      {ENVIRONMENT_IDENTIFICATION_LABELS[settings.environmentIdentificationMode]}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="end" alignItemWithTrigger={false}>
                    {Object.entries(ENVIRONMENT_IDENTIFICATION_LABELS).map(([value, label]) => (
                      <SelectItem hideIndicator key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              }
            />
          ) : null}
          <SettingsRow
            {...searchableSetting("composer-context")}
            description="Keep branch and worktree controls below the composer after a thread starts."
            resetAction={
              settings.persistComposerContextStrip !==
              DEFAULT_UNIFIED_SETTINGS.persistComposerContextStrip ? (
                <SettingResetButton
                  label="composer context"
                  onClick={() =>
                    updateSettings({
                      persistComposerContextStrip:
                        DEFAULT_UNIFIED_SETTINGS.persistComposerContextStrip,
                    })
                  }
                />
              ) : null
            }
            control={
              <Switch
                checked={settings.persistComposerContextStrip}
                onCheckedChange={(checked) =>
                  updateSettings({ persistComposerContextStrip: Boolean(checked) })
                }
                aria-label="Keep composer context visible in active threads"
              />
            }
          />
        </AdvancedSettings>
      </SettingsSection>

      <TypographySection />
    </SettingsPageContainer>
  );
}

function useFontDefaultFamilies() {
  const settings = usePrimarySettings();
  // An unset preference shows the font it resolves to on this machine; the
  // default stacks are the platform's own faces, so the name is probed, not
  // hardcoded.
  const defaults = useMemo(
    () => ({
      sans: resolveDefaultFamilyLabel(DEFAULT_SANS_FONT_STACK) ?? "System default",
      code: resolveDefaultFamilyLabel(DEFAULT_CODE_FONT_STACK) ?? "System monospace",
    }),
    [],
  );
  return {
    sans: defaults.sans,
    code: defaults.code,
    // The composer inherits whatever the interface preference resolves to.
    interfaceFamily: settings.fontFamilySans.trim() || defaults.sans,
  };
}

function InterfaceFontRow({ preview }: { preview?: ReactNode }) {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const defaults = useFontDefaultFamilies();
  return (
    <FontFamilySettingsRow
      {...searchableSetting("interface-font")}
      description="Everything outside code blocks and the terminal."
      defaultFamily={defaults.sans}
      value={settings.fontFamilySans}
      onValueChange={(fontFamilySans) => updateSettings({ fontFamilySans })}
      size={{
        label: "Interface font size",
        min: MIN_INTERFACE_FONT_SIZE,
        max: MAX_INTERFACE_FONT_SIZE,
        value: settings.fontSizeInterface,
        onChange: (fontSizeInterface) => updateSettings({ fontSizeInterface }),
      }}
      {...(preview !== undefined ? { preview } : {})}
    />
  );
}

function PromptFontRow() {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const defaults = useFontDefaultFamilies();
  return (
    <FontFamilySettingsRow
      {...searchableSetting("prompt-font")}
      description="Only the box you write prompts in. Mono works well here."
      defaultFamily={defaults.interfaceFamily}
      value={settings.fontFamilyComposer}
      onValueChange={(fontFamilyComposer) => updateSettings({ fontFamilyComposer })}
      size={{
        label: "Prompt font size",
        min: MIN_PROMPT_FONT_SIZE,
        max: MAX_PROMPT_FONT_SIZE,
        value: settings.fontSizePrompt,
        onChange: (fontSizePrompt) => updateSettings({ fontSizePrompt }),
      }}
      preview={<PromptFontPreview />}
    />
  );
}

function CodeFontRow({
  title,
  description = "Code blocks, diffs, and file previews.",
  preview,
}: {
  title?: string;
  description?: string;
  preview?: ReactNode;
}) {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const defaults = useFontDefaultFamilies();
  return (
    <FontFamilySettingsRow
      {...searchableSetting("code-font")}
      {...(title !== undefined ? { title } : {})}
      description={description}
      defaultFamily={defaults.code}
      value={settings.fontFamilyCode}
      onValueChange={(fontFamilyCode) => updateSettings({ fontFamilyCode })}
      requireMonospace
      size={{
        label: "Code font size",
        min: MIN_CODE_FONT_SIZE,
        max: MAX_CODE_FONT_SIZE,
        value: settings.fontSizeCode,
        onChange: (fontSizeCode) => updateSettings({ fontSizeCode }),
      }}
      preview={preview ?? <CodeFontPreview />}
    />
  );
}

function TerminalFontRow() {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const defaults = useFontDefaultFamilies();
  return (
    <FontFamilySettingsRow
      {...searchableSetting("terminal-font")}
      description="Terminal output, independent from code blocks and diffs."
      defaultFamily={defaults.code}
      value={settings.fontFamilyTerminal}
      onValueChange={(fontFamilyTerminal) => updateSettings({ fontFamilyTerminal })}
      requireMonospace
      size={{
        label: "Terminal font size",
        min: MIN_TERMINAL_FONT_SIZE,
        max: MAX_TERMINAL_FONT_SIZE,
        value: settings.fontSizeTerminal,
        onChange: (fontSizeTerminal) => updateSettings({ fontSizeTerminal }),
      }}
      preview={
        <TerminalFontPreview
          family={resolveTerminalFontPreference({
            advanced: true,
            code: settings.fontFamilyCode,
            terminal: settings.fontFamilyTerminal,
          })}
          size={settings.fontSizeTerminal}
        />
      }
    />
  );
}

function FontSmoothingRow() {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  if (!isMacPlatform(navigator.platform)) return null;
  return (
    <SettingsRow
      {...searchableSetting("font-smoothing")}
      description="Render text with thinner grayscale anti-aliasing instead of macOS's heavier default."
      resetAction={
        settings.fontSmoothing !== DEFAULT_UNIFIED_SETTINGS.fontSmoothing ? (
          <SettingResetButton
            label="font smoothing"
            onClick={() =>
              updateSettings({ fontSmoothing: DEFAULT_UNIFIED_SETTINGS.fontSmoothing })
            }
          />
        ) : null
      }
      control={
        <Switch
          checked={settings.fontSmoothing}
          onCheckedChange={(checked) => updateSettings({ fontSmoothing: Boolean(checked) })}
          aria-label="Font smoothing"
        />
      }
    />
  );
}

function WordWrapRow() {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  return (
    <SettingsRow
      {...searchableSetting("word-wrap")}
      description="Wrap long lines in code blocks, tables, diffs, and file previews by default."
      resetAction={
        settings.wordWrap !== DEFAULT_UNIFIED_SETTINGS.wordWrap ? (
          <SettingResetButton
            label="word wrapping"
            onClick={() => updateSettings({ wordWrap: DEFAULT_UNIFIED_SETTINGS.wordWrap })}
          />
        ) : null
      }
      control={
        <Switch
          checked={settings.wordWrap}
          onCheckedChange={(checked) => updateSettings({ wordWrap: Boolean(checked) })}
          aria-label="Wrap code, tables, diffs, and file previews by default"
        />
      }
    />
  );
}

function FontSettingsGroup() {
  return (
    <>
      <InterfaceFontRow />
      <PromptFontRow />
      <CodeFontRow />
      <TerminalFontRow />
    </>
  );
}

/**
 * The two-font view: one sans, one monospace. The prompt follows the
 * interface font and the terminal follows the monospace font, so the demos
 * under each row show every surface the choice reaches.
 */
function SimpleFontRows() {
  const settings = usePrimarySettings();
  return (
    <>
      <InterfaceFontRow preview={<PromptFontPreview />} />
      <CodeFontRow
        description="Code blocks, diffs, file previews, and the terminal."
        preview={
          <>
            <CodeFontPreview />
            <TerminalFontPreview
              family={resolveTerminalFontPreference({
                advanced: false,
                code: settings.fontFamilyCode,
                terminal: settings.fontFamilyTerminal,
              })}
              size={settings.fontSizeTerminal}
            />
          </>
        }
      />
    </>
  );
}

// Font smoothing only renders on macOS, so elsewhere a search jump must not open the fold.
const FONT_SMOOTHING_TARGET_IDS =
  typeof navigator !== "undefined" && isMacPlatform(navigator.platform) ? ["font-smoothing"] : [];
// Search jumps to the per-surface rows turn on separate fonts so the row mounts.
const SEPARATE_FONT_TARGET_IDS: ReadonlySet<string> = new Set(["prompt-font", "terminal-font"]);

/**
 * The two-font view by default - one sans, one monospace, each cascading to
 * every surface it reaches - with an Advanced switch in the section header
 * that reveals the per-surface override rows. The choice persists locally,
 * and a settings-search jump to an override row flips Advanced on so the
 * target exists to scroll to.
 */
function TypographySection() {
  const [advanced, setAdvanced] = useLocalStorage(
    TYPOGRAPHY_ADVANCED_STORAGE_KEY,
    false,
    Schema.Boolean,
  );
  const searchTargetId = useSettingsSearchTargetId();
  // Flip Advanced on once per search jump so the hidden target can mount and
  // scroll; tracking the handled id lets the user turn it back off without
  // the still-set target immediately re-expanding the section.
  const lastExpandedTargetRef = useRef<string | null>(null);
  useEffect(() => {
    if (searchTargetId === null || !SEPARATE_FONT_TARGET_IDS.has(searchTargetId)) return;
    if (lastExpandedTargetRef.current === searchTargetId) return;
    lastExpandedTargetRef.current = searchTargetId;
    setAdvanced(true);
  }, [searchTargetId, setAdvanced]);
  return (
    <SettingsSection id="typography" title="Typography">
      {advanced ? <FontSettingsGroup /> : <SimpleFontRows />}
      <WordWrapRow />
      <AdvancedSettings targetIds={FONT_SMOOTHING_TARGET_IDS}>
        <SettingsRow
          title="Separate fonts"
          description="Set the prompt, code, and terminal fonts separately."
          control={
            <Switch
              checked={advanced}
              onCheckedChange={(checked) => setAdvanced(Boolean(checked))}
              aria-label="Set fonts separately"
            />
          }
        />
        <FontSmoothingRow />
      </AdvancedSettings>
    </SettingsSection>
  );
}

function FontFamilySettingsRow({
  id,
  title,
  description,
  defaultFamily,
  preview,
  value,
  onValueChange,
  requireMonospace = false,
  size,
}: {
  id?: string;
  title: string;
  description: string;
  /** What an unset preference renders as, e.g. "Menlo". */
  defaultFamily: string;
  preview?: ReactNode;
  value: string;
  onValueChange: (value: string) => void;
  requireMonospace?: boolean;
  size: { label: string; min: number; max: number; value: number; onChange: (v: number) => void };
}) {
  const trimmed = value.trim();
  // The fallback input edits a draft; the preference only commits once typing
  // pauses and the text probes as an available font (or is an explicit
  // clear), so the current font holds and nothing reflows mid-word.
  const [draft, setDraft] = useState(value);
  const [draftSettled, setDraftSettled] = useState(true);
  const commitTimerRef = useRef<number | null>(null);
  const lastValueRef = useRef(value);
  if (lastValueRef.current !== value) {
    // The committed value changed externally (hydration, reset, picker
    // selection); adopt it and drop any pending commit of a stale draft.
    lastValueRef.current = value;
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    setDraft(value);
    setDraftSettled(true);
  }
  useEffect(
    () => () => {
      if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current);
    },
    [],
  );
  const acceptsFamily = (candidate: string) =>
    isFontFamilyAvailable(candidate) && (!requireMonospace || isMonospaceFamily(candidate));
  const commitDraft = (next: string) => {
    setDraftSettled(true);
    // A rejected name stays in the field, flagged: the terminal would silently
    // fall back to its default, so the row must not claim it took the value.
    if (next.trim().length === 0 || acceptsFamily(next)) {
      onValueChange(next);
    }
  };
  const flushDraft = () => {
    if (commitTimerRef.current === null) return;
    window.clearTimeout(commitTimerRef.current);
    commitTimerRef.current = null;
    commitDraft(draft);
  };
  const draftTrimmed = draft.trim();
  // Flag an unknown name only once typing pauses, and never for an empty
  // field - that is the starting state, not a rejected entry.
  const draftPending = draftSettled && draftTrimmed.length > 0 && draftTrimmed !== trimmed;
  const resetAction =
    trimmed.length > 0 ? (
      <SettingResetButton
        label={`${title.toLowerCase()} family`}
        onClick={() => onValueChange("")}
      />
    ) : null;
  const fontEnumeration = useFontEnumeration();
  // Everyone starts on the plain input; focusing it is the user gesture that
  // runs font discovery. Where the engine can enumerate, the control then
  // upgrades to the picker - popped open when the swap happens under focus,
  // so the interaction continues without a second click.
  const inputFocusedRef = useRef(false);
  const familyControl =
    fontEnumeration.status === "granted" ? (
      <FontFamilyPicker
        ariaLabel={`${title} family`}
        defaultFamily={defaultFamily}
        selectedFamily={trimmed}
        requireMonospace={requireMonospace}
        initialOpen={inputFocusedRef.current}
        onSelect={onValueChange}
      />
    ) : (
      <Input
        aria-label={`${title} family`}
        aria-invalid={draftPending || undefined}
        autoCapitalize="off"
        autoComplete="off"
        className="min-w-0 flex-1"
        maxLength={200}
        onFocus={() => {
          inputFocusedRef.current = true;
          discoverInstalledFonts();
        }}
        onBlur={() => {
          inputFocusedRef.current = false;
          flushDraft();
        }}
        onChange={(event) => {
          const next = event.currentTarget.value;
          setDraft(next);
          setDraftSettled(false);
          if (commitTimerRef.current !== null) {
            window.clearTimeout(commitTimerRef.current);
          }
          commitTimerRef.current = window.setTimeout(() => {
            commitTimerRef.current = null;
            commitDraft(next);
          }, 400);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") flushDraft();
          if (event.key === "Escape") {
            // Discard uncommitted typing without closing the settings page,
            // which is what an unhandled Escape does.
            event.preventDefault();
            event.stopPropagation();
            if (commitTimerRef.current !== null) {
              window.clearTimeout(commitTimerRef.current);
              commitTimerRef.current = null;
            }
            setDraft(value);
            setDraftSettled(true);
          }
        }}
        placeholder={defaultFamily}
        spellCheck={false}
        value={draft}
      />
    );
  const control = (
    <div className="flex w-full items-center gap-2 sm:w-auto">
      <div className="min-w-0 flex-1 sm:w-44 sm:flex-none">{familyControl}</div>
      <Select
        value={String(size.value)}
        onValueChange={(next) => {
          if (typeof next !== "string") return;
          const parsed = Number(next);
          if (Number.isInteger(parsed) && parsed >= size.min && parsed <= size.max) {
            size.onChange(parsed);
          }
        }}
      >
        <SelectTrigger className="w-22 shrink-0" aria-label={size.label}>
          <SelectValue>{size.value} px</SelectValue>
        </SelectTrigger>
        <SelectPopup align="end" alignItemWithTrigger={false}>
          {Array.from({ length: size.max - size.min + 1 }, (_, index) => size.min + index).map(
            (px) => (
              <SelectItem hideIndicator key={px} value={String(px)}>
                {px} px
              </SelectItem>
            ),
          )}
        </SelectPopup>
      </Select>
    </div>
  );
  return (
    <SettingsRow
      {...(id !== undefined ? { id } : {})}
      title={title}
      description={description}
      resetAction={resetAction}
      control={control}
    >
      {preview}
    </SettingsRow>
  );
}

const TOOL_CALL_VISIBILITY_LABELS: Record<ToolCallVisibility, string> = {
  showAll: "Show all",
  hideSuccessful: "Hide successful",
  hideAll: "Hide all",
  zen: "Zen",
};

const isToolCallVisibility = Schema.is(ToolCallVisibility);

const SIDEBAR_PROJECT_SORT_ORDER_LABELS: Record<SidebarProjectSortOrder, string> = {
  updated_at: "Last user message",
  created_at: "Created at",
  manual: "Manual",
};

/** Order of projects in the sidebar, the project picker, and the command palette. */
function ProjectOrderRow() {
  const sortOrder = useClientSettings((settings) => settings.sidebarProjectSortOrder);
  const updateSettings = useUpdateClientSettings();
  return (
    <SettingsRow
      {...searchableSetting("project-order")}
      description="Order of projects in the sidebar, the project picker, and the command palette."
      resetAction={
        sortOrder !== DEFAULT_UNIFIED_SETTINGS.sidebarProjectSortOrder ? (
          <SettingResetButton
            label="project order"
            onClick={() =>
              updateSettings({
                sidebarProjectSortOrder: DEFAULT_UNIFIED_SETTINGS.sidebarProjectSortOrder,
              })
            }
          />
        ) : null
      }
      control={
        <Select
          value={sortOrder}
          onValueChange={(value) => {
            if (value === "updated_at" || value === "created_at" || value === "manual") {
              updateSettings({ sidebarProjectSortOrder: value });
            }
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-44" aria-label="Project order">
            <SelectValue>{SIDEBAR_PROJECT_SORT_ORDER_LABELS[sortOrder]}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {(["updated_at", "created_at", "manual"] as const).map((value) => (
              <SelectItem hideIndicator key={value} value={value}>
                {SIDEBAR_PROJECT_SORT_ORDER_LABELS[value]}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}

/**
 * The model new threads start with. Unset is "Automatic": the model of the last launched thread.
 * A configured model wins over that memory.
 */
export function DefaultModelRow() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const serverProviders = useScopedServerProviders();
  const entries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(deriveProviderInstanceEntries(serverProviders), settings),
  );
  const modelOptions = getCustomModelOptionsByInstance(settings, serverProviders);
  const configured = settings.defaultModelSelection;
  const automaticEntry = entries.find((entry) => entry.enabled && entry.isAvailable);
  const selection =
    configured ??
    (automaticEntry
      ? createModelSelection(
          automaticEntry.instanceId,
          modelOptions.get(automaticEntry.instanceId)?.[0]?.slug ?? "",
        )
      : null);
  const activeEntry = entries.find((entry) => entry.instanceId === selection?.instanceId);
  return (
    <SettingsRow
      id="default-model"
      title="Model"
      serverScoped
      settingKeys={["defaultModelSelection"]}
      description="Default model for new threads."
      status={
        configured === null
          ? "Automatic: new threads start with the model you used most recently. Choose a model to always start with it."
          : undefined
      }
      resetAction={
        configured !== null ? (
          <SettingResetButton
            label="default model"
            tooltip="Use the most recent model"
            onClick={() => updateSettings({ defaultModelSelection: null })}
          />
        ) : null
      }
      control={
        selection ? (
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
            <ProviderModelPicker
              activeInstanceId={selection.instanceId}
              model={selection.model}
              lockedProvider={null}
              instanceEntries={entries}
              modelOptionsByInstance={modelOptions}
              triggerVariant="outline"
              triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
              onInstanceModelChange={(instanceId, model) =>
                updateSettings({ defaultModelSelection: createModelSelection(instanceId, model) })
              }
            />
            {configured !== null && activeEntry ? (
              <TraitsPicker
                provider={activeEntry.driverKind}
                models={activeEntry.models}
                model={configured.model}
                prompt=""
                onPromptChange={() => {}}
                modelOptions={configured.options ?? []}
                allowPromptInjectedEffort={false}
                triggerVariant="outline"
                triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                onModelOptionsChange={(options) =>
                  updateSettings({
                    defaultModelSelection: createModelSelection(
                      configured.instanceId,
                      configured.model,
                      options,
                    ),
                  })
                }
              />
            ) : null}
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">No providers available</span>
        )
      }
    />
  );
}

/** Where new threads start: the project checkout or a new worktree. */
export function NewThreadWorkspaceRow() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      {...searchableSetting("new-threads")}
      description="Where new threads start."
      serverScoped
      settingKeys={["defaultThreadEnvMode"]}
      resetAction={
        settings.defaultThreadEnvMode !== DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode ? (
          <SettingResetButton
            label="new thread workspace"
            onClick={() =>
              updateSettings({
                defaultThreadEnvMode: DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode,
              })
            }
          />
        ) : null
      }
      control={
        <Select
          value={settings.defaultThreadEnvMode}
          onValueChange={(value) => {
            if (value === "local" || value === "worktree") {
              updateSettings({ defaultThreadEnvMode: value });
            }
          }}
        >
          <SelectTrigger className="w-full sm:w-44" aria-label="Default thread mode">
            <SelectValue>
              {settings.defaultThreadEnvMode === "worktree" ? "New worktree" : "Local"}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            <SelectItem hideIndicator value="local">
              Local
            </SelectItem>
            <SelectItem hideIndicator value="worktree">
              New worktree
            </SelectItem>
          </SelectPopup>
        </Select>
      }
    />
  );
}

/** Approval level new threads start in. */
export function DefaultPermissionsRow() {
  const runtimeMode = useScopedSettings((settings) => settings.defaultRuntimeMode);
  const updateSettings = useUpdateScopedSettings();
  const Icon = runtimeModeConfig[runtimeMode].icon;
  return (
    <SettingsRow
      id="default-permissions"
      title="Permissions"
      serverScoped
      settingKeys={["defaultRuntimeMode"]}
      description={runtimeModeConfig[runtimeMode].description}
      resetAction={
        runtimeMode !== DEFAULT_UNIFIED_SETTINGS.defaultRuntimeMode ? (
          <SettingResetButton
            label="default permissions"
            onClick={() =>
              updateSettings({ defaultRuntimeMode: DEFAULT_UNIFIED_SETTINGS.defaultRuntimeMode })
            }
          />
        ) : null
      }
      control={
        <Select
          value={runtimeMode}
          onValueChange={(value) => {
            const next = runtimeModeOptions.find((mode) => mode === value);
            if (next) updateSettings({ defaultRuntimeMode: next });
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-48" aria-label="Default permissions">
            <SelectValue>
              <span className="flex items-center gap-1.5">
                <Icon className="size-3.5" />
                {runtimeModeConfig[runtimeMode].label}
              </span>
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {runtimeModeOptions.map((mode) => {
              const ModeIcon = runtimeModeConfig[mode].icon;
              return (
                <SelectItem hideIndicator key={mode} value={mode}>
                  <span className="flex items-center gap-1.5">
                    <ModeIcon className="size-3.5" />
                    {runtimeModeConfig[mode].label}
                  </span>
                </SelectItem>
              );
            })}
          </SelectPopup>
        </Select>
      }
    />
  );
}

const WORKTREE_SUBMODULES_LABELS: Record<WorktreeSubmodules, string> = {
  recursive: "Recursive",
  "top-level": "Top level only",
  none: "Skip",
};
const WORKTREE_SUBMODULES_OPTIONS = ["recursive", "top-level", "none"] as const;

/** How new worktrees populate git submodules; projects' t3.json can override it. */
function WorktreeSubmodulesRow() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const effective = resolveProjectSettings(settings, null, null, null).settings.worktreeSubmodules;
  return (
    <SettingsRow
      {...searchableSetting("worktree-submodules")}
      serverScoped
      settingKeys={["worktreeSubmodules"]}
      description="How new worktrees populate git submodules. A project's t3.json can override it."
      resetAction={
        settings.worktreeSubmodules !== null ? (
          <SettingResetButton
            label="worktree submodules"
            onClick={() => updateSettings({ worktreeSubmodules: null })}
          />
        ) : null
      }
      control={
        <Select
          value={effective}
          onValueChange={(value) => {
            const next = WORKTREE_SUBMODULES_OPTIONS.find((option) => option === value);
            if (next) updateSettings({ worktreeSubmodules: next });
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-44" aria-label="Worktree submodules">
            <SelectValue>{effective ? WORKTREE_SUBMODULES_LABELS[effective] : null}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {WORKTREE_SUBMODULES_OPTIONS.map((option) => (
              <SelectItem hideIndicator key={option} value={option}>
                {WORKTREE_SUBMODULES_LABELS[option]}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}

/** Resume interrupted threads once the server comes back. */
function ContinueThreadsRow() {
  const enabled = useScopedSettings((settings) => settings.continueThreadsAfterServerUpdate);
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      {...searchableSetting("continue-threads-after-restart")}
      serverScoped
      settingKeys={["continueThreadsAfterServerUpdate"]}
      description="Automatically resume interrupted threads after an update, crash, or machine restart."
      resetAction={
        enabled !== DEFAULT_UNIFIED_SETTINGS.continueThreadsAfterServerUpdate ? (
          <SettingResetButton
            label="continue threads after restarts"
            onClick={() =>
              updateSettings({
                continueThreadsAfterServerUpdate:
                  DEFAULT_UNIFIED_SETTINGS.continueThreadsAfterServerUpdate,
              })
            }
          />
        ) : null
      }
      control={
        <ScopedSwitch
          settingKeys={["continueThreadsAfterServerUpdate"]}
          checked={enabled}
          onCheckedChange={(checked) =>
            updateSettings({ continueThreadsAfterServerUpdate: Boolean(checked) })
          }
          aria-label="Continue threads after restarts"
        />
      }
    />
  );
}

/** A client-setting select row; `options` lists values in display order. */
function ClientSelectRow<
  K extends "chatWidth" | "effortDisplay" | "diffLayout" | "diffColorScheme",
>({
  settingKey,
  id,
  title,
  description,
  options,
  ariaLabel,
}: {
  settingKey: K;
  id: string;
  title: string;
  description: string;
  options: ReadonlyArray<readonly [UnifiedSettings[K], string]>;
  ariaLabel: string;
}) {
  const value = useClientSettings((settings) => settings[settingKey]);
  const updateSettings = useUpdateClientSettings();
  const defaultValue = DEFAULT_UNIFIED_SETTINGS[settingKey];
  return (
    <SettingsRow
      id={id}
      title={title}
      description={description}
      resetAction={
        value !== defaultValue ? (
          <SettingResetButton
            label={title.toLowerCase()}
            onClick={() => updateSettings({ [settingKey]: defaultValue })}
          />
        ) : null
      }
      control={
        <Select
          value={value}
          onValueChange={(next) => {
            const match = options.find(([option]) => option === next);
            if (match) updateSettings({ [settingKey]: match[0] });
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-44" aria-label={ariaLabel}>
            <SelectValue>{options.find(([option]) => option === value)?.[1]}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {options.map(([option, label]) => (
              <SelectItem hideIndicator key={option} value={option}>
                {label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}

/** Whether review and pull request diffs open with every file folded. */
function DiffFilesCollapsedRow() {
  const collapsed = useClientSettings((settings) => settings.diffFilesCollapsed);
  const updateSettings = useUpdateClientSettings();
  return (
    <SettingsRow
      {...searchableSetting("diff-files-collapsed")}
      description="Whether files in a diff start expanded or collapsed."
      resetAction={
        collapsed !== DEFAULT_UNIFIED_SETTINGS.diffFilesCollapsed ? (
          <SettingResetButton
            label="default diff file state"
            onClick={() =>
              updateSettings({ diffFilesCollapsed: DEFAULT_UNIFIED_SETTINGS.diffFilesCollapsed })
            }
          />
        ) : null
      }
      control={
        <Select
          value={collapsed ? "collapsed" : "expanded"}
          onValueChange={(next) => {
            if (next === "collapsed" || next === "expanded")
              updateSettings({ diffFilesCollapsed: next === "collapsed" });
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-44" aria-label="Default diff file state">
            <SelectValue>{collapsed ? "Collapsed" : "Expanded"}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            <SelectItem hideIndicator value="expanded">
              Expanded
            </SelectItem>
            <SelectItem hideIndicator value="collapsed">
              Collapsed
            </SelectItem>
          </SelectPopup>
        </Select>
      }
    />
  );
}

const SEND_SHORTCUT_LABELS: Record<SendShortcut, string> = {
  enter: "Enter",
  "mod-enter-multiline": `${isMacPlatform(typeof navigator === "undefined" ? "" : navigator.platform) ? "⌘" : "Ctrl"}+Enter for multiline`,
  "mod-enter": `${isMacPlatform(typeof navigator === "undefined" ? "" : navigator.platform) ? "⌘" : "Ctrl"}+Enter`,
};

/** When Enter sends a prompt and when it inserts a new line. */
function SendShortcutRow() {
  const sendShortcut = useClientSettings((settings) => settings.sendShortcut);
  const updateSettings = useUpdateClientSettings();
  return (
    <SettingsRow
      {...searchableSetting("send-shortcut")}
      description="Choose when Enter sends a prompt or inserts a new line. Shift+Enter always inserts a new line."
      resetAction={
        sendShortcut !== DEFAULT_UNIFIED_SETTINGS.sendShortcut ? (
          <SettingResetButton
            label="send shortcut"
            onClick={() => updateSettings({ sendShortcut: DEFAULT_UNIFIED_SETTINGS.sendShortcut })}
          />
        ) : null
      }
      control={
        <Select
          value={sendShortcut}
          onValueChange={(value) => {
            if (value === "enter" || value === "mod-enter-multiline" || value === "mod-enter") {
              updateSettings({ sendShortcut: value });
            }
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-56" aria-label="Send shortcut">
            <SelectValue>{SEND_SHORTCUT_LABELS[sendShortcut]}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {(["enter", "mod-enter-multiline", "mod-enter"] as const).map((value) => (
              <SelectItem hideIndicator key={value} value={value}>
                {SEND_SHORTCUT_LABELS[value]}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}

/** Whether skills also appear in the / command menu; they always appear under $. */
function SkillsInSlashMenuRow() {
  const show = useClientSettings((settings) => settings.showSkillsInSlashMenu);
  const updateSettings = useUpdateClientSettings();
  return (
    <SettingsRow
      {...searchableSetting("skills-in-slash-menu")}
      description="Also include skills in the / command menu. Skills always appear when you type $."
      resetAction={
        show !== DEFAULT_UNIFIED_SETTINGS.showSkillsInSlashMenu ? (
          <SettingResetButton
            label="skills in slash menu"
            onClick={() =>
              updateSettings({
                showSkillsInSlashMenu: DEFAULT_UNIFIED_SETTINGS.showSkillsInSlashMenu,
              })
            }
          />
        ) : null
      }
      control={
        <Switch
          checked={show}
          onCheckedChange={(checked) => updateSettings({ showSkillsInSlashMenu: Boolean(checked) })}
          aria-label="Show skills in slash menu"
        />
      }
    />
  );
}

/** A boolean switch row for one client or scoped server setting. */
function SwitchSettingRow({
  id,
  title,
  description,
  checked,
  defaultChecked,
  onChange,
  settingKeys,
}: {
  id: string;
  title: string;
  description: string;
  checked: boolean;
  defaultChecked: boolean;
  onChange: (checked: boolean) => void;
  /** Server keys this row edits through the page scope; omit for client settings. */
  settingKeys?: readonly (keyof ServerSettings)[];
}) {
  return (
    <SettingsRow
      id={id}
      title={title}
      description={description}
      {...(settingKeys ? { serverScoped: true, settingKeys } : {})}
      resetAction={
        checked !== defaultChecked ? (
          <SettingResetButton
            label={title.toLowerCase()}
            onClick={() => onChange(defaultChecked)}
          />
        ) : null
      }
      control={
        <Switch
          checked={checked}
          onCheckedChange={(next) => onChange(Boolean(next))}
          aria-label={title}
        />
      }
    />
  );
}

function UnpinConfirmationRow() {
  const confirm = useClientSettings((settings) => settings.confirmThreadUnpin);
  const updateSettings = useUpdateClientSettings();
  return (
    <SwitchSettingRow
      {...searchableSetting("unpin-confirmation")}
      description="Ask before unpinning a thread."
      checked={confirm}
      defaultChecked={DEFAULT_UNIFIED_SETTINGS.confirmThreadUnpin}
      onChange={(confirmThreadUnpin) => updateSettings({ confirmThreadUnpin })}
    />
  );
}

function KeepAwakeRow() {
  const keepAwake = useScopedSettings((settings) => settings.keepAwakeWhileAgentsWork);
  const updateSettings = useUpdateScopedSettings();
  return (
    <SwitchSettingRow
      {...searchableSetting("keep-awake")}
      settingKeys={["keepAwakeWhileAgentsWork"]}
      description="Keep this computer from sleeping while agents are working. The display can still turn off."
      checked={keepAwake}
      defaultChecked={DEFAULT_UNIFIED_SETTINGS.keepAwakeWhileAgentsWork}
      onChange={(keepAwakeWhileAgentsWork) => updateSettings({ keepAwakeWhileAgentsWork })}
    />
  );
}

function GhqCloneLayoutRow() {
  const ghq = useScopedSettings((settings) => settings.ghqCloneLayout);
  const updateSettings = useUpdateScopedSettings();
  return (
    <SwitchSettingRow
      {...searchableSetting("ghq-clone-layout")}
      settingKeys={["ghqCloneLayout"]}
      description="Clone repositories into host/owner/repo folders below the starting folder, like ghq."
      checked={ghq}
      defaultChecked={DEFAULT_UNIFIED_SETTINGS.ghqCloneLayout}
      onChange={(ghqCloneLayout) => updateSettings({ ghqCloneLayout })}
    />
  );
}

/** Pull request links open in the app's pull requests page instead of on GitHub. */
function PullRequestLinksInAppRow() {
  const openInApp = useClientSettings((settings) => settings.pullRequestLinksOpenInApp);
  const updateSettings = useUpdateClientSettings();
  return (
    <SwitchSettingRow
      {...searchableSetting("pull-request-links-in-app")}
      description="Open pull request links for your projects in Test Rig. Cmd-click (Ctrl-click) still opens GitHub."
      checked={openInApp}
      defaultChecked={DEFAULT_UNIFIED_SETTINGS.pullRequestLinksOpenInApp}
      onChange={(pullRequestLinksOpenInApp) => updateSettings({ pullRequestLinksOpenInApp })}
    />
  );
}

export function GeneralSettingsPanel() {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const lastEnabledProjectGroupingMode = useRef<SidebarProjectGroupingMode>(
    readLastEnabledProjectGroupingMode(),
  );

  return (
    <SettingsPageContainer>
      <SettingsSection title="Sidebar">
        <SettingsRow
          {...searchableSetting("project-grouping")}
          description="Combine matching repositories across environments."
          resetAction={
            settings.sidebarProjectGroupingMode !==
            DEFAULT_UNIFIED_SETTINGS.sidebarProjectGroupingMode ? (
              <SettingResetButton
                label="project grouping"
                onClick={() =>
                  updateSettings({
                    sidebarProjectGroupingMode: DEFAULT_UNIFIED_SETTINGS.sidebarProjectGroupingMode,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={isProjectGroupingEnabled(settings.sidebarProjectGroupingMode)}
              onCheckedChange={(checked) => {
                if (!checked && settings.sidebarProjectGroupingMode !== "separate") {
                  lastEnabledProjectGroupingMode.current = settings.sidebarProjectGroupingMode;
                  rememberEnabledProjectGroupingMode(settings.sidebarProjectGroupingMode);
                }
                updateSettings({
                  sidebarProjectGroupingMode: projectGroupingModeFromToggle(
                    checked,
                    lastEnabledProjectGroupingMode.current,
                  ),
                });
              }}
              aria-label="Project grouping"
            />
          }
        />
        <ProjectOrderRow />
        <SidebarWorkingShelfRow />
      </SettingsSection>
      <SettingsSection title="Confirmations">
        <SettingsRow
          {...searchableSetting("archive-confirmation")}
          description="Require a second click on the inline archive action before a thread is archived."
          resetAction={
            settings.confirmThreadArchive !== DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive ? (
              <SettingResetButton
                label="archive confirmation"
                onClick={() =>
                  updateSettings({
                    confirmThreadArchive: DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmThreadArchive}
              onCheckedChange={(checked) =>
                updateSettings({ confirmThreadArchive: Boolean(checked) })
              }
              aria-label="Confirm thread archiving"
            />
          }
        />
        <SettingsRow
          {...searchableSetting("delete-confirmation")}
          description="Ask before deleting a thread and its chat history."
          resetAction={
            settings.confirmThreadDelete !== DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete ? (
              <SettingResetButton
                label="delete confirmation"
                onClick={() =>
                  updateSettings({
                    confirmThreadDelete: DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmThreadDelete}
              onCheckedChange={(checked) =>
                updateSettings({ confirmThreadDelete: Boolean(checked) })
              }
              aria-label="Confirm thread deletion"
            />
          }
        />
        <UnpinConfirmationRow />
      </SettingsSection>
      <SettingsSection title="Display">
        <SettingsRow
          {...searchableSetting("time-format")}
          description="System default follows your browser or OS clock preference."
          resetAction={
            settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat ? (
              <SettingResetButton
                label="time format"
                onClick={() =>
                  updateSettings({
                    timestampFormat: DEFAULT_UNIFIED_SETTINGS.timestampFormat,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.timestampFormat}
              onValueChange={(value) => {
                if (value === "locale" || value === "12-hour" || value === "24-hour") {
                  updateSettings({ timestampFormat: value });
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-40" aria-label="Timestamp format">
                <SelectValue>{TIMESTAMP_FORMAT_LABELS[settings.timestampFormat]}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="locale">
                  {TIMESTAMP_FORMAT_LABELS.locale}
                </SelectItem>
                <SelectItem hideIndicator value="12-hour">
                  {TIMESTAMP_FORMAT_LABELS["12-hour"]}
                </SelectItem>
                <SelectItem hideIndicator value="24-hour">
                  {TIMESTAMP_FORMAT_LABELS["24-hour"]}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

export function ChatSettingsPanel() {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();

  return (
    <SettingsPageContainer>
      <SettingsSection title="Composer">
        <SendShortcutRow />
        <AdvancedSettings targetIds={[searchableSetting("skills-in-slash-menu").id]}>
          <SkillsInSlashMenuRow />
        </AdvancedSettings>
      </SettingsSection>
      <SettingsSection title="Activity">
        <SettingsRow
          {...searchableSetting("tool-call-visibility")}
          description="Reduce commands, edits, searches, and tool calls in the conversation. Hide successful keeps running and failed calls. Zen also hides the agent's in-between messages and shows only final answers. Errors, approvals, questions, and agent interactions remain visible. This preference applies to this device."
          resetAction={
            settings.toolCallVisibility !== DEFAULT_UNIFIED_SETTINGS.toolCallVisibility ? (
              <SettingResetButton
                label="tool calls in chat"
                onClick={() =>
                  updateSettings({
                    toolCallVisibility: DEFAULT_UNIFIED_SETTINGS.toolCallVisibility,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.toolCallVisibility}
              onValueChange={(value) => {
                if (isToolCallVisibility(value)) updateSettings({ toolCallVisibility: value });
              }}
            >
              <SelectTrigger className="w-full sm:w-40" aria-label="Tool calls in chat">
                <SelectValue>
                  {TOOL_CALL_VISIBILITY_LABELS[settings.toolCallVisibility]}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {ToolCallVisibility.literals.map((value) => (
                  <SelectItem key={value} value={value}>
                    {TOOL_CALL_VISIBILITY_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

export function DiffsSettingsPanel() {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();

  return (
    <SettingsPageContainer>
      <SettingsSection title="Diffs">
        <ClientSelectRow
          settingKey="diffLayout"
          {...searchableSetting("diff-layout")}
          description="Show changes stacked in one column or side by side."
          ariaLabel="Diff layout"
          options={[
            ["stacked", "Stacked"],
            ["split", "Split"],
          ]}
        />
        <SettingsRow
          {...searchableSetting("hide-whitespace-changes")}
          description="Set whether the diff panel ignores whitespace-only edits by default."
          resetAction={
            settings.diffIgnoreWhitespace !== DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace ? (
              <SettingResetButton
                label="diff whitespace changes"
                onClick={() =>
                  updateSettings({
                    diffIgnoreWhitespace: DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.diffIgnoreWhitespace}
              onCheckedChange={(checked) =>
                updateSettings({ diffIgnoreWhitespace: Boolean(checked) })
              }
              aria-label="Hide whitespace changes by default"
            />
          }
        />
        <DiffFilesCollapsedRow />
        <ClientSelectRow
          settingKey="diffColorScheme"
          {...searchableSetting("diff-color-scheme")}
          description="Colors for added and removed lines. Blue and orange are easier to tell apart for some color vision."
          ariaLabel="Diff colors"
          options={[
            ["red-green", "Red & green"],
            ["blue-orange", "Blue & orange"],
          ]}
        />
      </SettingsSection>
      <SettingsSection title="Pull requests">
        <PullRequestLinksInAppRow />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

export function ThreadsSettingsPanel() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const serverProviders = useScopedServerProviders();
  const textGenerationModelSelection = resolveAppModelSelectionState(settings, serverProviders);
  const textGenInstanceId = textGenerationModelSelection.instanceId;
  const textGenModel = textGenerationModelSelection.model;
  const textGenModelOptions = textGenerationModelSelection.options;
  const textGenerationModelInstanceEntries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(deriveProviderInstanceEntries(serverProviders), settings),
  );
  const textGenInstanceEntry = textGenerationModelInstanceEntries.find(
    (entry) => entry.instanceId === textGenInstanceId,
  );
  const textGenProvider: ProviderDriverKind =
    textGenInstanceEntry?.driverKind ?? DEFAULT_DRIVER_KIND;
  const textGenerationModelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    serverProviders,
    textGenInstanceId,
    textGenModel,
  );
  const isTextGenerationModelDirty = !Equal.equals(
    settings.textGenerationModelSelection ?? null,
    DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection ?? null,
  );

  return (
    <SettingsPageContainer>
      <SettingsSection title="New projects">
        <SettingsRow
          {...searchableSetting("add-project-starts-in")}
          serverScoped
          settingKeys={["addProjectBaseDirectory"]}
          description='Leave empty to use "~/" when the Add Project browser opens.'
          resetAction={
            settings.addProjectBaseDirectory !==
            DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory ? (
              <SettingResetButton
                label="add project base directory"
                onClick={() =>
                  updateSettings({
                    addProjectBaseDirectory: DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory,
                  })
                }
              />
            ) : null
          }
          control={
            <DraftInput
              className="w-full sm:w-72"
              value={settings.addProjectBaseDirectory}
              onCommit={(next) => updateSettings({ addProjectBaseDirectory: next })}
              placeholder="~/"
              spellCheck={false}
              aria-label="Add project base directory"
            />
          }
        />
        <GhqCloneLayoutRow />
      </SettingsSection>
      <SettingsSection title="New threads">
        <DefaultModelRow />
        <DefaultPermissionsRow />
        <NewThreadWorkspaceRow />
      </SettingsSection>
      <SettingsSection title="Snooze">
        <SnoozePresetsRow />
      </SettingsSection>
      <SettingsSection title="Usage limits">
        <SettingsRow
          {...searchableSetting("auto-resume-limited-threads")}
          serverScoped
          settingKeys={["autoResumeLimitedThreads"]}
          description="Automatically schedule continuation after a provider reports a usage-limit reset time. Off by default. Cancel an already scheduled continuation in its chat."
          resetAction={
            settings.autoResumeLimitedThreads ? (
              <SettingResetButton
                label="Auto-resume limited threads"
                onClick={() => updateSettings({ autoResumeLimitedThreads: false })}
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.autoResumeLimitedThreads}
              onCheckedChange={(checked) =>
                updateSettings({ autoResumeLimitedThreads: Boolean(checked) })
              }
              aria-label="Auto-resume limited threads"
            />
          }
        />
        <SettingsRow
          {...searchableSetting("snooze-limited-threads")}
          serverScoped
          settingKeys={["snoozeLimitedThreads"]}
          description="Snooze usage-limited chats until the reported reset time. Off by default and independent of auto-resume; snoozing alone never sends a message."
          resetAction={
            settings.snoozeLimitedThreads ? (
              <SettingResetButton
                label="Snooze limited threads"
                onClick={() => updateSettings({ snoozeLimitedThreads: false })}
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.snoozeLimitedThreads}
              onCheckedChange={(checked) =>
                updateSettings({ snoozeLimitedThreads: Boolean(checked) })
              }
              aria-label="Snooze limited threads"
            />
          }
        />
      </SettingsSection>
      <SettingsSection title="Auto-settle">
        <AutoSettleRows />
      </SettingsSection>
      <SettingsSection title="Text generation">
        <SettingsRow
          {...searchableSetting("text-generation-model")}
          serverScoped
          settingKeys={["textGenerationModelSelection"]}
          description="Default model for generated text like thread titles and source control content. Source control settings can override it with a dedicated source control writer model."
          resetAction={
            isTextGenerationModelDirty ? (
              <SettingResetButton
                label="text generation model"
                onClick={() =>
                  updateSettings({
                    textGenerationModelSelection:
                      DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
                  })
                }
              />
            ) : null
          }
          control={
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <ProviderModelPicker
                activeInstanceId={textGenInstanceId}
                model={textGenModel}
                lockedProvider={null}
                instanceEntries={textGenerationModelInstanceEntries}
                modelOptionsByInstance={textGenerationModelOptionsByInstance}
                triggerVariant="outline"
                triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                onInstanceModelChange={(instanceId, model) => {
                  updateSettings({
                    textGenerationModelSelection: resolveAppModelSelectionState(
                      {
                        ...settings,
                        textGenerationModelSelection: createModelSelection(instanceId, model),
                      },
                      serverProviders,
                    ),
                  });
                }}
              />
              <TraitsPicker
                provider={textGenProvider}
                models={
                  // Use the exact instance's models (rather than the
                  // first-kind-match) so a custom text-gen instance like
                  // `codex_personal` gets its own model list, not the
                  // default Codex one.
                  textGenInstanceEntry?.models ?? []
                }
                model={textGenModel}
                prompt=""
                onPromptChange={() => {}}
                modelOptions={textGenModelOptions}
                allowPromptInjectedEffort={false}
                triggerVariant="outline"
                triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                onModelOptionsChange={(nextOptions) => {
                  updateSettings({
                    textGenerationModelSelection: resolveAppModelSelectionState(
                      {
                        ...settings,
                        textGenerationModelSelection: createModelSelection(
                          textGenInstanceId,
                          textGenModel,
                          nextOptions,
                        ),
                      },
                      serverProviders,
                    ),
                  });
                }}
              />
            </div>
          }
        />
        <AdvancedSettings
          targetIds={[
            searchableSetting("thread-title-instructions").id,
            searchableSetting("response-streaming").id,
          ]}
        >
          <ThreadTitleInstructionsSettings />
          <SettingsRow
            {...searchableSetting("response-streaming")}
            serverScoped
            settingKeys={["responseStreamingMode"]}
            description={RESPONSE_STREAMING_MODE_DESCRIPTIONS[settings.responseStreamingMode]}
            resetAction={
              settings.responseStreamingMode !== DEFAULT_UNIFIED_SETTINGS.responseStreamingMode ? (
                <SettingResetButton
                  label="response streaming"
                  onClick={() =>
                    updateSettings({
                      responseStreamingMode: DEFAULT_UNIFIED_SETTINGS.responseStreamingMode,
                    })
                  }
                />
              ) : null
            }
            control={
              <Select
                value={settings.responseStreamingMode}
                onValueChange={(value) => {
                  if (value === "turn" || value === "paragraph") {
                    updateSettings({ responseStreamingMode: value });
                  }
                }}
              >
                <SelectTrigger size="sm" className="w-full sm:w-56" aria-label="Response streaming">
                  <SelectValue>
                    {RESPONSE_STREAMING_MODE_LABELS[settings.responseStreamingMode]}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem hideIndicator value="turn">
                    {RESPONSE_STREAMING_MODE_LABELS.turn}
                  </SelectItem>
                  <SelectItem hideIndicator value="paragraph">
                    {RESPONSE_STREAMING_MODE_LABELS.paragraph}
                  </SelectItem>
                </SelectPopup>
              </Select>
            }
          />
        </AdvancedSettings>
      </SettingsSection>
    </SettingsPageContainer>
  );
}

export function WorktreesSettingsPanel() {
  return (
    <SettingsPageContainer>
      <SettingsSection title="Creation">
        <WorktreesDirectoryRow />
        <StartFromOriginRow />
        <AdvancedSettings targetIds={[searchableSetting("worktree-submodules").id]}>
          <WorktreeSubmodulesRow />
        </AdvancedSettings>
      </SettingsSection>
      <SettingsSection title="Branches">
        <BranchNamingSection />
      </SettingsSection>
      <WorktreeCleanupSection />
    </SettingsPageContainer>
  );
}

/** New worktrees start from the remote branch instead of the local one. */
function StartFromOriginRow() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      {...searchableSetting("start-from-origin")}
      serverScoped
      settingKeys={["newWorktreesStartFromOrigin"]}
      description="Base new worktrees on the latest matching branch on the remote instead of your local branch."
      resetAction={
        settings.newWorktreesStartFromOrigin !==
        DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin ? (
          <SettingResetButton
            label="new worktrees start from remote"
            onClick={() =>
              updateSettings({
                newWorktreesStartFromOrigin: DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin,
              })
            }
          />
        ) : null
      }
      control={
        <Switch
          checked={settings.newWorktreesStartFromOrigin}
          onCheckedChange={(checked) =>
            updateSettings({ newWorktreesStartFromOrigin: Boolean(checked) })
          }
          aria-label="Start new worktrees from the remote branch"
        />
      }
    />
  );
}

export function MaintenanceSettingsPanel() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const [backgroundActivityDialogOpen, setBackgroundActivityDialogOpen] = useState(false);
  const observability = useAtomValue(primaryServerObservabilityAtom);
  const diagnosticsDescription = formatDiagnosticsDescription({
    localTracingEnabled: observability?.localTracingEnabled ?? false,
    otlpTracesEnabled: observability?.otlpTracesEnabled ?? false,
    otlpTracesUrl: observability?.otlpTracesUrl,
    otlpMetricsEnabled: observability?.otlpMetricsEnabled ?? false,
    otlpMetricsUrl: observability?.otlpMetricsUrl,
  });
  const resolvedBackgroundActivity = resolveServerBackgroundActivitySettings(settings);
  const activeBackgroundActivityProfile = resolvedBackgroundActivity.profile;
  const backgroundActivityProfileOption = resolveBackgroundActivityProfileOption(settings);
  const backgroundActivityDescription =
    backgroundActivityProfileOption === "advanced"
      ? `${ADVANCED_BACKGROUND_ACTIVITY_DESCRIPTION} Current shared policy: ${
          BACKGROUND_ACTIVITY_PROFILE_LABELS[activeBackgroundActivityProfile]
        }.`
      : BACKGROUND_ACTIVITY_PROFILE_DESCRIPTIONS[resolvedBackgroundActivity.profile];
  const canResetBackgroundActivity = !Equal.equals(
    settings.backgroundActivity,
    DEFAULT_UNIFIED_SETTINGS.backgroundActivity,
  );

  return (
    <SettingsPageContainer>
      <SettingsSection title="Restarts">
        <ContinueThreadsRow />
      </SettingsSection>

      <SettingsSection title="Background activity">
        <SettingsRow
          id={searchableSetting("background-activity").id}
          serverScoped
          settingKeys={["backgroundActivity"]}
          title={
            <span className="inline-flex items-center gap-1.5">
              Background activity
              <PolicyTooltip>
                This shared policy gates background work such as Git refreshes and provider health
                probes after their individual intervals elapse.
              </PolicyTooltip>
            </span>
          }
          description={backgroundActivityDescription}
          resetAction={
            canResetBackgroundActivity ? (
              <SettingResetButton
                label="background activity"
                onClick={() => updateSettings(resetBackgroundActivitySettings())}
              />
            ) : null
          }
          control={
            <>
              <Select
                value={backgroundActivityProfileOption}
                onValueChange={(value) => {
                  if (value === "advanced") {
                    setBackgroundActivityDialogOpen(true);
                    return;
                  }
                  if (
                    value === "balanced" ||
                    value === "performance" ||
                    value === "battery-saver"
                  ) {
                    updateSettings(backgroundActivityProfileSettings(value));
                  }
                }}
              >
                <SelectTrigger className="w-full sm:w-40" aria-label="Background activity profile">
                  <SelectValue>
                    {BACKGROUND_ACTIVITY_PROFILE_OPTION_LABELS[backgroundActivityProfileOption]}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem hideIndicator value="balanced">
                    {BACKGROUND_ACTIVITY_PROFILE_LABELS.balanced}
                  </SelectItem>
                  <SelectItem hideIndicator value="performance">
                    {BACKGROUND_ACTIVITY_PROFILE_LABELS.performance}
                  </SelectItem>
                  <SelectItem hideIndicator value="battery-saver">
                    {BACKGROUND_ACTIVITY_PROFILE_LABELS["battery-saver"]}
                  </SelectItem>
                  <SelectItem hideIndicator value="advanced">
                    {BACKGROUND_ACTIVITY_PROFILE_OPTION_LABELS.advanced}
                  </SelectItem>
                </SelectPopup>
              </Select>
              {backgroundActivityProfileOption === "advanced" ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        size="icon-sm"
                        variant="outline"
                        aria-label="Configure advanced background activity"
                        onClick={() => setBackgroundActivityDialogOpen(true)}
                      >
                        <SettingsIcon className="size-4" />
                      </Button>
                    }
                  />
                  <TooltipPopup side="top">Configure background activity</TooltipPopup>
                </Tooltip>
              ) : null}
              <BackgroundActivityAdvancedDialog
                open={backgroundActivityDialogOpen}
                onOpenChange={setBackgroundActivityDialogOpen}
              />
            </>
          }
        />
        <KeepAwakeRow />
      </SettingsSection>
      <StorageCleanupSections />
      <SettingsSection title="Diagnostics">
        <SettingsRow
          {...searchableSetting("diagnostics")}
          description={diagnosticsDescription}
          control={
            <Button render={<Link to="/settings/diagnostics" />} size="xs" variant="outline">
              View diagnostics
            </Button>
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

export function AboutSettingsPanel() {
  return (
    <SettingsPageContainer>
      <SettingsSection id={searchableSetting("version").id} title="App">
        <AboutVersionSection />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

export function ArchivedThreadsPanel() {
  const projects = useProjects();
  const pendingActions = useRef(new Set<string>());
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(() => new Set());
  const { unarchiveThread, confirmAndDeleteThread } = useThreadActions();
  const environmentIds = useMemo(
    () => [...new Set(projects.map((project) => project.environmentId))],
    [projects],
  );
  const {
    snapshots: archivedSnapshots,
    error: archiveError,
    isLoading: isLoadingArchive,
    refresh: refreshArchivedThreads,
  } = useArchivedThreadSnapshots(environmentIds);

  const archivedGroups = useMemo(() => {
    const projectsByEnvironmentAndId = new Map(
      archivedSnapshots.flatMap(({ environmentId, snapshot }) =>
        snapshot.projects.map(
          (project) =>
            [
              `${environmentId}:${project.id}`,
              {
                id: project.id,
                environmentId,
                name: project.title,
                cwd: project.workspaceRoot,
              },
            ] as const,
        ),
      ),
    );
    const threads = archivedSnapshots.flatMap(({ environmentId, snapshot }) =>
      snapshot.threads.map((thread) => presentThreadShell(environmentId, thread)),
    );

    const archivedProjects = Array.from(projectsByEnvironmentAndId.values());
    const groups: Array<{
      readonly project: (typeof archivedProjects)[number];
      readonly threads: Array<(typeof threads)[number]>;
    }> = [];
    for (const project of archivedProjects) {
      const projectThreads: Array<(typeof threads)[number]> = [];
      for (const thread of threads) {
        if (thread.projectId === project.id && thread.environmentId === project.environmentId) {
          projectThreads.push(thread);
        }
      }
      if (projectThreads.length > 0) {
        groups.push({
          project,
          threads: projectThreads.toSorted((left, right) => {
            const leftKey = left.archivedAt ?? left.createdAt;
            const rightKey = right.archivedAt ?? right.createdAt;
            return rightKey.localeCompare(leftKey) || right.id.localeCompare(left.id);
          }),
        });
      }
    }
    return groups;
  }, [archivedSnapshots]);

  type ArchivedThread = (typeof archivedGroups)[number]["threads"][number];
  const handleThreadAction = async (action: "unarchive" | "delete", thread: ArchivedThread) => {
    const target = scopeThreadRef(thread.environmentId, thread.id);
    const key = `${thread.environmentId}:${thread.id}`;
    if (pendingActions.current.has(key)) return;
    pendingActions.current.add(key);
    setPendingKeys(new Set(pendingActions.current));
    const settled = await settlePromise(async () => {
      const result = await (action === "unarchive"
        ? unarchiveThread(target)
        : confirmAndDeleteThread(target, thread.title));
      if (result._tag === "Success") refreshArchivedThreads();
      return result;
    }).finally(() => {
      pendingActions.current.delete(key);
      setPendingKeys(new Set(pendingActions.current));
    });
    const result = settled._tag === "Failure" ? settled : settled.value;
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: `Failed to ${action} thread`,
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    }
  };
  const handleArchivedThreadContextMenu = async (
    thread: ArchivedThread,
    position: { x: number; y: number },
  ) => {
    const clicked = await readLocalApi()?.contextMenu.show(
      [
        { id: "unarchive", label: "Unarchive" },
        { id: "delete", label: "Delete", destructive: true },
      ],
      position,
    );
    if (clicked === "unarchive" || clicked === "delete") await handleThreadAction(clicked, thread);
  };

  return (
    <SettingsPageContainer>
      {archivedGroups.length === 0 ? (
        <SettingsSection
          id={isLoadingArchive ? undefined : searchableSetting("archive").id}
          title={searchableSetting("archive").title}
        >
          <SettingsRow
            title={
              <span className="inline-flex items-center gap-2">
                {isLoadingArchive ? (
                  <LoaderIcon className="size-3.5 animate-spin text-muted-foreground" />
                ) : (
                  <ArchiveIcon className="size-3.5 text-muted-foreground" />
                )}
                {isLoadingArchive
                  ? "Loading archived threads"
                  : archiveError
                    ? "Could not load archived threads"
                    : "No archived threads"}
              </span>
            }
            description={
              isLoadingArchive
                ? "Checking connected environments."
                : (archiveError ?? "Archived threads will appear here.")
            }
          />
        </SettingsSection>
      ) : (
        archivedGroups.map(({ project, threads: projectThreads }, index) => (
          <SettingsSection
            key={project.id}
            id={index === 0 ? searchableSetting("archive").id : undefined}
            title={project.name}
            icon={<ProjectFavicon environmentId={project.environmentId} cwd={project.cwd} />}
          >
            {projectThreads.map((thread) => (
              <SettingsRow
                key={thread.id}
                onContextMenu={(event) => {
                  event.preventDefault();
                  void (async () => {
                    const result = await settlePromise(() =>
                      handleArchivedThreadContextMenu(thread, {
                        x: event.clientX,
                        y: event.clientY,
                      }),
                    );
                    if (result._tag === "Failure") {
                      const error = squashAtomCommandFailure(result);
                      toastManager.add(
                        stackedThreadToast({
                          type: "error",
                          title: "Archived thread action failed",
                          description:
                            error instanceof Error ? error.message : "An error occurred.",
                        }),
                      );
                    }
                  })();
                }}
                title={thread.title}
                description={
                  <>
                    Archived {formatRelativeTimeLabel(thread.archivedAt ?? thread.createdAt)}
                    {" \u00b7 Created "}
                    {formatRelativeTimeLabel(thread.createdAt)}
                  </>
                }
                control={
                  <div className="flex shrink-0 items-center gap-2">
                    {(["unarchive", "delete"] as const).map((action) => (
                      <Button
                        key={action}
                        type="button"
                        size="sm"
                        variant={action === "delete" ? "destructive-outline" : "outline"}
                        aria-label={`${action === "delete" ? "Delete" : "Unarchive"} ${thread.title}`}
                        disabled={pendingKeys.has(`${thread.environmentId}:${thread.id}`)}
                        onClick={() => void handleThreadAction(action, thread)}
                      >
                        {action === "delete" ? (
                          <Trash2Icon className="size-3.5" />
                        ) : (
                          <ArchiveX className="size-3.5" />
                        )}
                        {action === "delete" ? "Delete" : "Unarchive"}
                      </Button>
                    ))}
                  </div>
                }
              />
            ))}
          </SettingsSection>
        ))
      )}
    </SettingsPageContainer>
  );
}
