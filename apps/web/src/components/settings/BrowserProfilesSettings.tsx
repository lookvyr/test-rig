import { randomUUID } from "~/lib/utils";
import { useState } from "react";
import {
  BROWSER_CUSTOM_SEARCH_URL_MAX_LENGTH,
  BrowserSearchEngine,
  BROWSER_PROFILE_MAX_COUNT,
  BROWSER_PROFILE_NAME_MAX_LENGTH,
  DEFAULT_BROWSER_PROFILE_ID,
  resolveBrowserProfiles,
} from "@t3tools/contracts";
import { isValidSearchUrlTemplate } from "@t3tools/shared/preview";
import * as Schema from "effect/Schema";
import { useClientSettings, useUpdateClientSettings } from "~/hooks/useSettings";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SettingsSection } from "./settingsLayout";

/** Named browser cookie profiles; removing a name keeps existing tabs signed in. */
export function BrowserProfilesSettings() {
  const settings = useClientSettings();
  const update = useUpdateClientSettings();
  const [name, setName] = useState("");
  const profiles = resolveBrowserProfiles(settings.browserProfiles);
  const defaultId =
    profiles.find(
      (profile) => profile.id === settings.browserDefaultProfileId && profile.kind === "persistent",
    )?.id ?? DEFAULT_BROWSER_PROFILE_ID;
  return (
    <SettingsSection id="browser-profiles" title="Browser profiles">
      <p className="text-sm text-muted-foreground">
        Keep separate cookies and logins for each profile. Incognito uses temporary storage.
      </p>
      <div className="flex items-center gap-3">
        <label htmlFor="browser-default-profile" className="text-sm">
          New tabs use
        </label>
        <select
          id="browser-default-profile"
          className="rounded border bg-background px-2 py-1 text-sm"
          value={defaultId}
          onChange={(event) => update({ browserDefaultProfileId: event.target.value })}
        >
          {profiles
            .filter((profile) => profile.kind === "persistent")
            .map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
        </select>
      </div>
      {settings.browserProfiles
        .filter((profile) => !["default", "incognito"].includes(profile.id))
        .map((profile) => (
          <div key={profile.id} className="flex items-center gap-2">
            <Input
              aria-label="Browser profile name"
              defaultValue={profile.name}
              maxLength={BROWSER_PROFILE_NAME_MAX_LENGTH}
              onBlur={(event) => {
                const nextName = event.target.value.trim();
                if (!nextName) {
                  event.target.value = profile.name;
                  return;
                }
                update({
                  browserProfiles: settings.browserProfiles.map((item) =>
                    item.id === profile.id ? { ...item, name: nextName } : item,
                  ),
                });
              }}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                update({
                  browserProfiles: settings.browserProfiles.filter(
                    (item) => item.id !== profile.id,
                  ),
                  ...(defaultId === profile.id
                    ? { browserDefaultProfileId: DEFAULT_BROWSER_PROFILE_ID }
                    : {}),
                })
              }
            >
              Remove
            </Button>
          </div>
        ))}
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const nextName = name.trim();
          if (!nextName || settings.browserProfiles.length >= BROWSER_PROFILE_MAX_COUNT) return;
          update({
            browserProfiles: [
              ...settings.browserProfiles,
              { id: randomUUID(), name: nextName, kind: "persistent" },
            ],
          });
          setName("");
        }}
      >
        <Input
          aria-label="New browser profile name"
          placeholder="Work or Personal"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={BROWSER_PROFILE_NAME_MAX_LENGTH}
        />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={!name.trim() || settings.browserProfiles.length >= BROWSER_PROFILE_MAX_COUNT}
        >
          Add profile
        </Button>
      </form>
    </SettingsSection>
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
const isSearchEngine = Schema.is(BrowserSearchEngine);

/** Where address-bar search terms go; a query is sent only when submitted. */
export function BrowserSearchSettings() {
  const settings = useClientSettings();
  const update = useUpdateClientSettings();
  const custom = settings.browserCustomSearchUrl;
  const customInvalid =
    settings.browserSearchEngine === "custom" && !isValidSearchUrlTemplate(custom.trim());
  return (
    <SettingsSection id="browser-search" title="Browser search">
      <div className="flex items-center gap-3">
        <label htmlFor="browser-search-engine" className="text-sm">
          Search with
        </label>
        <select
          id="browser-search-engine"
          className="rounded border bg-background px-2 py-1 text-sm"
          value={settings.browserSearchEngine}
          onChange={(event) => {
            if (isSearchEngine(event.target.value))
              update({ browserSearchEngine: event.target.value });
          }}
        >
          {Object.entries(SEARCH_ENGINE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {settings.browserSearchEngine === "custom" ? (
        <div className="flex flex-col gap-1">
          <Input
            aria-label="Custom search URL"
            placeholder="https://search.example/?q=%s"
            maxLength={BROWSER_CUSTOM_SEARCH_URL_MAX_LENGTH}
            value={custom}
            onChange={(event) => update({ browserCustomSearchUrl: event.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            {customInvalid
              ? "Enter an http or https address with %s where the search terms go. Until then, searches use DuckDuckGo."
              : "%s is replaced with the search terms."}
          </p>
        </div>
      ) : null}
    </SettingsSection>
  );
}
