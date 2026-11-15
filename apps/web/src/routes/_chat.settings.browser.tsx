import { createFileRoute } from "@tanstack/react-router";

import { BrowserSettingsPanel } from "../components/settings/BrowserProfilesSettings";

export const Route = createFileRoute("/_chat/settings/browser")({
  component: BrowserSettingsPanel,
});
