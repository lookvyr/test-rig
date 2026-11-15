import { MoreVertical, PlusIcon } from "lucide-react";
import {
  BROWSER_CUSTOM_SEARCH_URL_MAX_LENGTH,
  BROWSER_RECORDING_FRAME_RATES,
  BrowserSearchEngine,
  DEFAULT_BROWSER_AUTO_SHOW_FLOATING_PREVIEW,
  DEFAULT_BROWSER_LINK_TARGET,
  DEFAULT_BROWSER_RECORDING_FRAME_RATE,
  DEFAULT_BROWSER_VIEWPORT,
  DEFAULT_PREVIEW_APPEARANCE,
  DEFAULT_PREVIEW_ZOOM_FACTOR,
  DEFAULT_SERVER_SETTINGS,
  FILL_PREVIEW_VIEWPORT,
  PREVIEW_VIEWPORT_MAX_AREA,
  PREVIEW_VIEWPORT_MAX_DIMENSION,
  PREVIEW_VIEWPORT_MIN_DIMENSION,
  PREVIEW_ZOOM_LEVELS,
  type PreviewAppearancePreference,
  type PreviewViewportSetting,
  BROWSER_PROFILE_MAX_COUNT,
  BROWSER_PROFILE_NAME_MAX_LENGTH,
  DEFAULT_BROWSER_PROFILE_ID,
  DEFAULT_BROWSER_SEARCH_ENGINE,
  isBuiltInBrowserProfileId,
  resolveBrowserProfiles,
} from "@t3tools/contracts";
import { isValidSearchUrlTemplate } from "@t3tools/shared/preview";
import { PREVIEW_VIEWPORT_PRESETS } from "@t3tools/shared/previewViewport";

import { ScreenRotationIcon } from "~/browser/ScreenRotationIcon";
import {
  useClientSettings,
  usePrimarySettings,
  useUpdateClientSettings,
  useUpdatePrimarySettings,
} from "~/hooks/useSettings";
import { isElectron } from "../../env";
import { cn, randomUUID } from "~/lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { DraftInput } from "../ui/draft-input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { NumberField, NumberFieldGroup, NumberFieldInput } from "../ui/number-field";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Switch } from "../ui/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { AdvancedSettings } from "./AdvancedSettings";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
  SettingsUnavailableGroup,
} from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

/** Named browser cookie profiles; removing a name keeps existing tabs signed in. */
function BrowserProfilesSetting() {
  const userProfiles = useClientSettings((settings) => settings.browserProfiles);
  const defaultProfileId = useClientSettings((settings) => settings.browserDefaultProfileId);
  const update = useUpdateClientSettings();
  const profiles = resolveBrowserProfiles(userProfiles);
  const listedProfiles = profiles.filter((profile) => profile.kind !== "incognito");
  const resolvedDefaultId =
    listedProfiles.find((profile) => profile.id === defaultProfileId)?.id ??
    DEFAULT_BROWSER_PROFILE_ID;
  const atProfileLimit = userProfiles.length >= BROWSER_PROFILE_MAX_COUNT;

  const createProfile = () => {
    if (atProfileLimit) return;
    const taken = new Set(profiles.map((profile) => profile.name));
    let name = "New profile";
    for (let index = 2; taken.has(name); index += 1) name = `New profile ${index}`;
    update({
      browserProfiles: [...userProfiles, { id: randomUUID(), name, kind: "persistent" }],
    });
  };

  return (
    <SettingsRow
      {...searchableSetting("browser-profiles")}
      description="Profiles keep separate cookies and logins. Incognito uses temporary storage."
      control={
        <Button size="sm" variant="outline" disabled={atProfileLimit} onClick={createProfile}>
          <PlusIcon />
          Add profile
        </Button>
      }
    >
      <div className="mt-2 mb-2 overflow-hidden rounded-lg border border-border/60">
        {listedProfiles.map((profile, index) => {
          const builtIn = isBuiltInBrowserProfileId(profile.id);
          const isDefault = profile.id === resolvedDefaultId;
          return (
            <div
              key={profile.id}
              className={cn(
                "flex items-center gap-3 px-3 py-2",
                index > 0 && "border-t border-border/60",
              )}
            >
              <span className="flex min-w-0 flex-1 items-center gap-2">
                {builtIn ? (
                  <span className="truncate text-sm text-foreground">{profile.name}</span>
                ) : (
                  <DraftInput
                    nativeInput
                    size="sm"
                    className="w-full max-w-56"
                    aria-label={`Rename ${profile.name}`}
                    maxLength={BROWSER_PROFILE_NAME_MAX_LENGTH}
                    value={profile.name}
                    onCommit={(next) => {
                      const name = next.trim();
                      if (!name) return;
                      update({
                        browserProfiles: userProfiles.map((item) =>
                          item.id === profile.id ? { ...item, name } : item,
                        ),
                      });
                    }}
                  />
                )}
                {isDefault ? <Badge>Default</Badge> : null}
              </span>
              <Menu>
                <MenuTrigger
                  render={
                    <Button
                      size="icon-xs"
                      variant="ghost-muted"
                      aria-label={`${profile.name} options`}
                    />
                  }
                >
                  <MoreVertical />
                </MenuTrigger>
                <MenuPopup align="end">
                  <MenuItem
                    disabled={isDefault}
                    onClick={() => update({ browserDefaultProfileId: profile.id })}
                  >
                    Set as default
                  </MenuItem>
                  {builtIn ? null : (
                    <MenuItem
                      variant="destructive"
                      onClick={() =>
                        update({
                          browserProfiles: userProfiles.filter((item) => item.id !== profile.id),
                          ...(isDefault
                            ? { browserDefaultProfileId: DEFAULT_BROWSER_PROFILE_ID }
                            : {}),
                        })
                      }
                    >
                      Remove profile
                    </MenuItem>
                  )}
                </MenuPopup>
              </Menu>
            </div>
          );
        })}
      </div>
    </SettingsRow>
  );
}

const FILL_VALUE = "fill";
const RESPONSIVE_VALUE = "responsive";
const RESPONSIVE_SEED_SIZE = { width: 1280, height: 800 } as const;

const NO_GROUPING: Intl.NumberFormatOptions = { useGrouping: false };

const APPEARANCE_LABELS: Readonly<Record<PreviewAppearancePreference, string>> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

const zoomLabel = (zoomFactor: number) => `${Math.round(zoomFactor * 100)}%`;

const viewportSelectValue = (viewport: PreviewViewportSetting): string => {
  if (viewport._tag === "fill") return FILL_VALUE;
  if (
    viewport._tag === "preset" &&
    PREVIEW_VIEWPORT_PRESETS.some((preset) => preset.id === viewport.presetId)
  ) {
    return viewport.presetId;
  }
  return RESPONSIVE_VALUE;
};

/** Inline options lack an items map; bare SelectValue would display the stored fill token. */
const viewportSelectLabel = (viewport: PreviewViewportSetting): string => {
  const value = viewportSelectValue(viewport);
  if (value === FILL_VALUE) return "Fill panel";
  if (value === RESPONSIVE_VALUE) return "Responsive";
  return PREVIEW_VIEWPORT_PRESETS.find((preset) => preset.id === value)?.label ?? "Responsive";
};

const isValidDimension = (value: number) =>
  Number.isInteger(value) &&
  value >= PREVIEW_VIEWPORT_MIN_DIMENSION &&
  value <= PREVIEW_VIEWPORT_MAX_DIMENSION;

const rotateViewport = (
  viewport: Exclude<PreviewViewportSetting, { readonly _tag: "fill" }>,
): PreviewViewportSetting => ({
  ...viewport,
  width: viewport.height,
  height: viewport.width,
});

function BrowserViewportSetting({ disabled }: { readonly disabled: boolean }) {
  const viewport = useClientSettings((settings) => settings.browserDefaultViewport);
  const updateSettings = useUpdateClientSettings();

  const sized = viewport._tag === "fill" ? null : viewport;
  const presentedSize = {
    width: sized?.width ?? RESPONSIVE_SEED_SIZE.width,
    height: sized?.height ?? RESPONSIVE_SEED_SIZE.height,
  };

  const selectViewport = (value: string | null) => {
    if (value === FILL_VALUE) {
      updateSettings({ browserDefaultViewport: FILL_PREVIEW_VIEWPORT });
      return;
    }
    if (value === RESPONSIVE_VALUE) {
      updateSettings({
        browserDefaultViewport: {
          _tag: "freeform",
          width: sized?.width ?? RESPONSIVE_SEED_SIZE.width,
          height: sized?.height ?? RESPONSIVE_SEED_SIZE.height,
        },
      });
      return;
    }
    const preset = PREVIEW_VIEWPORT_PRESETS.find((candidate) => candidate.id === value);
    if (!preset) return;
    updateSettings({
      browserDefaultViewport: {
        _tag: "preset",
        width: preset.width,
        height: preset.height,
        presetId: preset.id,
      },
    });
  };

  // Commit on blur to avoid persisting valid intermediate dimensions and rewriting settings per keystroke.
  const commitDimension = (axis: "width" | "height", value: number | null) => {
    if (value === null || !isValidDimension(value)) return;
    const next = { ...presentedSize, [axis]: value };
    if (next.width * next.height > PREVIEW_VIEWPORT_MAX_AREA) return;
    if (sized && next.width === sized.width && next.height === sized.height) return;
    updateSettings({ browserDefaultViewport: { _tag: "freeform", ...next } });
  };

  return (
    <SettingsRow
      {...searchableSetting("browser-default-viewport")}
      description="Tab size for you and agents. Fill fits the panel; other sizes show the device toolbar."
      resetAction={
        !disabled && viewport._tag !== DEFAULT_BROWSER_VIEWPORT._tag ? (
          <SettingResetButton
            label="default browser viewport"
            onClick={() => updateSettings({ browserDefaultViewport: DEFAULT_BROWSER_VIEWPORT })}
          />
        ) : null
      }
      control={
        <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
          <Select
            value={viewportSelectValue(viewport)}
            onValueChange={selectViewport}
            disabled={disabled}
          >
            <SelectTrigger
              size="sm"
              className="w-full min-w-0 sm:w-44"
              aria-label="Default browser viewport"
            >
              <SelectValue>{viewportSelectLabel(viewport)}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem value={FILL_VALUE}>Fill panel</SelectItem>
              <SelectItem value={RESPONSIVE_VALUE}>Responsive</SelectItem>
              <SelectGroup>
                <SelectGroupLabel>Standard</SelectGroupLabel>
                {PREVIEW_VIEWPORT_PRESETS.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    <span className="flex w-full items-center justify-between gap-5">
                      <span>{preset.label}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {preset.detail}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectPopup>
          </Select>

          {sized ? (
            <div className="flex min-w-0 items-center gap-1">
              <NumberField
                value={presentedSize.width}
                min={PREVIEW_VIEWPORT_MIN_DIMENSION}
                max={PREVIEW_VIEWPORT_MAX_DIMENSION}
                disabled={disabled}
                format={NO_GROUPING}
                size="sm"
                className="w-20"
                onValueCommitted={(value) => commitDimension("width", value)}
              >
                <NumberFieldGroup>
                  <NumberFieldInput aria-label="Default viewport width" />
                </NumberFieldGroup>
              </NumberField>
              <span className="text-xs text-muted-foreground">×</span>
              <NumberField
                value={presentedSize.height}
                min={PREVIEW_VIEWPORT_MIN_DIMENSION}
                max={PREVIEW_VIEWPORT_MAX_DIMENSION}
                disabled={disabled}
                format={NO_GROUPING}
                size="sm"
                className="w-20"
                onValueCommitted={(value) => commitDimension("height", value)}
              >
                <NumberFieldGroup>
                  <NumberFieldInput aria-label="Default viewport height" />
                </NumberFieldGroup>
              </NumberField>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      size="icon-sm"
                      variant="ghost-muted"
                      disabled={disabled}
                      aria-label={`Rotate to ${
                        presentedSize.height >= presentedSize.width ? "landscape" : "portrait"
                      }`}
                      onClick={() =>
                        updateSettings({ browserDefaultViewport: rotateViewport(sized) })
                      }
                    >
                      <ScreenRotationIcon />
                    </Button>
                  }
                />
                <TooltipPopup side="top">Rotate</TooltipPopup>
              </Tooltip>
            </div>
          ) : null}
        </div>
      }
    />
  );
}

function BrowserZoomSetting({ disabled }: { readonly disabled: boolean }) {
  const zoomFactor = useClientSettings((settings) => settings.browserDefaultZoomFactor);
  const updateSettings = useUpdateClientSettings();

  return (
    <SettingsRow
      {...searchableSetting("browser-default-zoom")}
      description="Page zoom applied to new browser tabs."
      resetAction={
        !disabled && zoomFactor !== DEFAULT_PREVIEW_ZOOM_FACTOR ? (
          <SettingResetButton
            label="default browser zoom"
            onClick={() =>
              updateSettings({ browserDefaultZoomFactor: DEFAULT_PREVIEW_ZOOM_FACTOR })
            }
          />
        ) : null
      }
      control={
        <Select
          disabled={disabled}
          value={String(zoomFactor)}
          onValueChange={(value) => {
            const next = PREVIEW_ZOOM_LEVELS.find((level) => String(level) === value);
            if (next !== undefined) updateSettings({ browserDefaultZoomFactor: next });
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-40" aria-label="Default browser zoom">
            <SelectValue>{zoomLabel(zoomFactor)}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {PREVIEW_ZOOM_LEVELS.map((level) => (
              <SelectItem hideIndicator key={level} value={String(level)}>
                {zoomLabel(level)}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}

function BrowserAppearanceSetting({ disabled }: { readonly disabled: boolean }) {
  const appearance = useClientSettings((settings) => settings.browserDefaultAppearance);
  const updateSettings = useUpdateClientSettings();

  return (
    <SettingsRow
      {...searchableSetting("browser-default-appearance")}
      description="The color scheme pages are told to prefer. System follows your OS setting."
      resetAction={
        !disabled && appearance !== DEFAULT_PREVIEW_APPEARANCE ? (
          <SettingResetButton
            label="default browser appearance"
            onClick={() => updateSettings({ browserDefaultAppearance: DEFAULT_PREVIEW_APPEARANCE })}
          />
        ) : null
      }
      control={
        <Select
          disabled={disabled}
          value={appearance}
          onValueChange={(value) => {
            if (value === "system" || value === "light" || value === "dark") {
              updateSettings({ browserDefaultAppearance: value });
            }
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-full sm:w-40"
            aria-label="Default browser appearance"
          >
            <SelectValue>{APPEARANCE_LABELS[appearance]}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {Object.entries(APPEARANCE_LABELS).map(([value, label]) => (
              <SelectItem hideIndicator key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}

function BrowserRecordingInputSettings({ disabled }: { readonly disabled: boolean }) {
  const showKeys = useClientSettings((settings) => settings.browserRecordingShowKeyPresses);
  const showMouse = useClientSettings((settings) => settings.browserRecordingShowMousePresses);
  const updateSettings = useUpdateClientSettings();
  return (
    <>
      <SettingsRow
        {...searchableSetting("browser-recording-key-presses")}
        description="Show pressed keys and shortcuts in new recordings. Password fields are excluded."
        control={
          <Switch
            disabled={disabled}
            checked={showKeys}
            aria-label="Show key presses in recordings"
            onCheckedChange={(checked) =>
              updateSettings({ browserRecordingShowKeyPresses: Boolean(checked) })
            }
          />
        }
      />
      <SettingsRow
        {...searchableSetting("browser-recording-mouse-presses")}
        description="Highlight mouse presses and held buttons in new recordings."
        control={
          <Switch
            disabled={disabled}
            checked={showMouse}
            aria-label="Show mouse presses in recordings"
            onCheckedChange={(checked) =>
              updateSettings({ browserRecordingShowMousePresses: Boolean(checked) })
            }
          />
        }
      />
    </>
  );
}

function BrowserRecordingFrameRateSetting({ disabled }: { readonly disabled: boolean }) {
  const frameRate = useClientSettings((settings) => settings.browserRecordingFrameRate);
  const updateSettings = useUpdateClientSettings();

  return (
    <SettingsRow
      {...searchableSetting("browser-recording-frame-rate")}
      description="Maximum recording rate. 30 fps saves CPU and storage; 60 fps is smoother."
      resetAction={
        !disabled && frameRate !== DEFAULT_BROWSER_RECORDING_FRAME_RATE ? (
          <SettingResetButton
            label="browser recording frame rate"
            onClick={() =>
              updateSettings({ browserRecordingFrameRate: DEFAULT_BROWSER_RECORDING_FRAME_RATE })
            }
          />
        ) : null
      }
      control={
        <Select
          disabled={disabled}
          value={String(frameRate)}
          onValueChange={(value) => {
            const next = BROWSER_RECORDING_FRAME_RATES.find((rate) => String(rate) === value);
            if (next !== undefined) {
              updateSettings({ browserRecordingFrameRate: next });
            }
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-full sm:w-40"
            aria-label="Browser recording frame rate"
          >
            <SelectValue>{frameRate} fps</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {BROWSER_RECORDING_FRAME_RATES.map((rate) => (
              <SelectItem hideIndicator key={rate} value={String(rate)}>
                {rate} fps
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}

function AgentBrowserAccessSetting() {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();

  return (
    <SettingsRow
      {...searchableSetting("agent-browser-access")}
      description="Allow agents to use the shared browser. Applies when an agent session next starts."
      resetAction={
        settings.enableAgentBrowserAccess !== DEFAULT_SERVER_SETTINGS.enableAgentBrowserAccess ? (
          <SettingResetButton
            label="default browser access"
            onClick={() =>
              updateSettings({
                enableAgentBrowserAccess: DEFAULT_SERVER_SETTINGS.enableAgentBrowserAccess,
              })
            }
          />
        ) : null
      }
      control={
        <Switch
          aria-label="Agent browser access"
          checked={settings.enableAgentBrowserAccess}
          onCheckedChange={(enabled) => updateSettings({ enableAgentBrowserAccess: enabled })}
        />
      }
    />
  );
}

function BrowserAutoShowFloatingPreviewSetting({ disabled }: { readonly disabled: boolean }) {
  const autoShow = useClientSettings((settings) => settings.browserAutoShowFloatingPreview);
  const updateSettings = useUpdateClientSettings();

  return (
    <SettingsRow
      {...searchableSetting("browser-auto-show-floating-preview")}
      description="Show the floating preview when an agent opens a browser or device unless the agent says otherwise."
      resetAction={
        !disabled && autoShow !== DEFAULT_BROWSER_AUTO_SHOW_FLOATING_PREVIEW ? (
          <SettingResetButton
            label="auto-show floating preview"
            onClick={() =>
              updateSettings({
                browserAutoShowFloatingPreview: DEFAULT_BROWSER_AUTO_SHOW_FLOATING_PREVIEW,
              })
            }
          />
        ) : null
      }
      control={
        <Switch
          disabled={disabled}
          checked={autoShow}
          onCheckedChange={(checked) =>
            updateSettings({ browserAutoShowFloatingPreview: Boolean(checked) })
          }
          aria-label="Auto-show floating preview"
        />
      }
    />
  );
}

const SEARCH_ENGINE_LABELS: Record<BrowserSearchEngine, string> = {
  duckduckgo: "DuckDuckGo",
  google: "Google",
  bing: "Bing",
  brave: "Brave Search",
  kagi: "Kagi",
  ecosia: "Ecosia",
  custom: "Custom",
};

/** Where address-bar search terms go; a query is sent only when submitted. */
function BrowserSearchEngineSetting() {
  const engine = useClientSettings((settings) => settings.browserSearchEngine);
  const customUrl = useClientSettings((settings) => settings.browserCustomSearchUrl);
  const update = useUpdateClientSettings();

  return (
    <>
      <SettingsRow
        {...searchableSetting("browser-search")}
        description="What the address bar searches when you type something that isn't a URL."
        resetAction={
          engine !== DEFAULT_BROWSER_SEARCH_ENGINE || customUrl !== "" ? (
            <SettingResetButton
              label="search engine"
              onClick={() =>
                update({
                  browserSearchEngine: DEFAULT_BROWSER_SEARCH_ENGINE,
                  browserCustomSearchUrl: "",
                })
              }
            />
          ) : null
        }
        control={
          <Select
            value={engine}
            onValueChange={(value) => {
              const next = BrowserSearchEngine.literals.find((literal) => literal === value);
              if (next !== undefined) update({ browserSearchEngine: next });
            }}
          >
            <SelectTrigger size="sm" className="w-full sm:w-40" aria-label="Search engine">
              <SelectValue>{SEARCH_ENGINE_LABELS[engine]}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {BrowserSearchEngine.literals.map((literal) => (
                <SelectItem hideIndicator key={literal} value={literal}>
                  {SEARCH_ENGINE_LABELS[literal]}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      {engine === "custom" ? (
        <SettingsRow
          title="Custom search URL"
          description="Use %s where the search terms go."
          status={
            isValidSearchUrlTemplate(customUrl.trim())
              ? undefined
              : "Enter an http or https URL containing %s. Searches use DuckDuckGo until then."
          }
          control={
            <DraftInput
              nativeInput
              size="sm"
              className="w-full sm:w-72"
              aria-label="Custom search URL"
              placeholder="https://search.example/?q=%s"
              maxLength={BROWSER_CUSTOM_SEARCH_URL_MAX_LENGTH}
              value={customUrl}
              onCommit={(next) => update({ browserCustomSearchUrl: next.trim() })}
            />
          }
        />
      ) : null}
    </>
  );
}

const LINK_TARGET_LABELS = { system: "System browser", app: "Test Rig" } as const;

/** Where plain clicks on web links in chat open; Cmd/Ctrl-click always uses the system browser. */
function BrowserLinkTargetSetting() {
  const linkTarget = useClientSettings((settings) => settings.browserLinkTarget);
  const update = useUpdateClientSettings();
  return (
    <SettingsRow
      {...searchableSetting("browser-link-target")}
      description="Where links in chat open. Cmd-click (Ctrl-click) always opens your system browser."
      resetAction={
        linkTarget !== DEFAULT_BROWSER_LINK_TARGET ? (
          <SettingResetButton
            label="open links in"
            onClick={() => update({ browserLinkTarget: DEFAULT_BROWSER_LINK_TARGET })}
          />
        ) : null
      }
      control={
        <Select
          value={linkTarget}
          onValueChange={(value) => {
            if (value === "system" || value === "app") update({ browserLinkTarget: value });
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-40" aria-label="Open links in">
            <SelectValue>{LINK_TARGET_LABELS[linkTarget]}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            <SelectItem hideIndicator value="system">
              {LINK_TARGET_LABELS.system}
            </SelectItem>
            <SelectItem hideIndicator value="app">
              {LINK_TARGET_LABELS.app}
            </SelectItem>
          </SelectPopup>
        </Select>
      }
    />
  );
}

export function BrowserSettingsPanel() {
  const desktopOnly = !isElectron;
  const desktopOnlyMessage = desktopOnly ? "Only available in the desktop app." : undefined;

  return (
    <SettingsPageContainer>
      <SettingsSection id="browser-agent-access" title="Agent access">
        <AgentBrowserAccessSetting />
      </SettingsSection>
      <SettingsSection id="browser" title="Browsing">
        <BrowserProfilesSetting />
        <BrowserLinkTargetSetting />
        <SettingsUnavailableGroup message={desktopOnlyMessage}>
          <BrowserAutoShowFloatingPreviewSetting disabled={desktopOnly} />
        </SettingsUnavailableGroup>
        {/* Not desktop-only: web clients search from server-run browser tabs too. */}
        <BrowserSearchEngineSetting />
        <AdvancedSettings
          targetIds={[
            searchableSetting("browser-default-viewport").id,
            searchableSetting("browser-default-zoom").id,
            searchableSetting("browser-default-appearance").id,
          ]}
        >
          <SettingsUnavailableGroup message={desktopOnlyMessage}>
            <BrowserViewportSetting disabled={desktopOnly} />
            <BrowserZoomSetting disabled={desktopOnly} />
            <BrowserAppearanceSetting disabled={desktopOnly} />
          </SettingsUnavailableGroup>
        </AdvancedSettings>
      </SettingsSection>
      <SettingsSection id="browser-recordings" title="Recordings">
        <SettingsUnavailableGroup message={desktopOnlyMessage}>
          <BrowserRecordingFrameRateSetting disabled={desktopOnly} />
          <BrowserRecordingInputSettings disabled={desktopOnly} />
        </SettingsUnavailableGroup>
      </SettingsSection>
    </SettingsPageContainer>
  );
}
