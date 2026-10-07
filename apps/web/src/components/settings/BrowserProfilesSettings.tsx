import { randomUUID } from "~/lib/utils";
import { useState } from "react";
import {
  BROWSER_PROFILE_MAX_COUNT,
  BROWSER_PROFILE_NAME_MAX_LENGTH,
  DEFAULT_BROWSER_PROFILE_ID,
  resolveBrowserProfiles,
} from "@t3tools/contracts";
import { useClientSettings, useUpdateClientSettings } from "~/hooks/useSettings";
import { isElectron } from "~/env";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SettingsSection } from "./settingsLayout";

/** Named desktop cookie profiles; removing a name keeps existing tabs signed in. */
export function BrowserProfilesSettings() {
  const settings = useClientSettings();
  const update = useUpdateClientSettings();
  const [name, setName] = useState("");
  const profiles = resolveBrowserProfiles(settings.browserProfiles);
  const defaultId =
    profiles.find(
      (profile) => profile.id === settings.browserDefaultProfileId && profile.kind === "persistent",
    )?.id ?? DEFAULT_BROWSER_PROFILE_ID;
  if (!isElectron) return null;
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
