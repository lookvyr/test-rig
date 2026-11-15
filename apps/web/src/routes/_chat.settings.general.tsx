import { createFileRoute } from "@tanstack/react-router";

import { GeneralSettingsPanel } from "../components/settings/SettingsPanels";

export const Route = createFileRoute("/_chat/settings/general")({
  component: GeneralSettingsPanel,
});
