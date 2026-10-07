import {
  DEFAULT_BROWSER_PROFILE_ID,
  resolveBrowserProfiles,
  type BrowserProfile,
} from "@t3tools/contracts";
import { getClientSettings, useClientSettings } from "~/hooks/useSettings";

/** Built-ins and named cookie profiles available in this desktop client. */
export function useBrowserProfiles(): ReadonlyArray<BrowserProfile> {
  return useClientSettings((settings) => resolveBrowserProfiles(settings.browserProfiles));
}

/** Existing tabs keep their profile even after its name is removed from Settings. */
export function browserDefaultOpenProfileId(): string {
  const settings = getClientSettings();
  const profiles = resolveBrowserProfiles(settings.browserProfiles);
  return (
    profiles.find(
      (profile) => profile.id === settings.browserDefaultProfileId && profile.kind === "persistent",
    )?.id ?? DEFAULT_BROWSER_PROFILE_ID
  );
}
