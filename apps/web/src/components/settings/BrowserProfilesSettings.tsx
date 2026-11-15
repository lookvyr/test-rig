import { MoreVertical, PlusIcon } from "lucide-react";
import {
  BROWSER_CUSTOM_SEARCH_URL_MAX_LENGTH,
  BrowserSearchEngine,
  BROWSER_PROFILE_MAX_COUNT,
  BROWSER_PROFILE_NAME_MAX_LENGTH,
  DEFAULT_BROWSER_PROFILE_ID,
  DEFAULT_BROWSER_SEARCH_ENGINE,
  isBuiltInBrowserProfileId,
  resolveBrowserProfiles,
} from "@t3tools/contracts";
import { isValidSearchUrlTemplate } from "@t3tools/shared/preview";

import { useClientSettings, useUpdateClientSettings } from "~/hooks/useSettings";
import { cn, randomUUID } from "~/lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { DraftInput } from "../ui/draft-input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
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

export function BrowserSettingsPanel() {
  return (
    <SettingsPageContainer>
      <SettingsSection id="browser" title="Browsing">
        <BrowserProfilesSetting />
        <BrowserSearchEngineSetting />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
