import { createFileRoute } from "@tanstack/react-router";

import { ThreadsSettingsPanel } from "../components/settings/SettingsPanels";

export const Route = createFileRoute("/_chat/settings/threads")({
  validateSearch: (search: Record<string, unknown>): { project?: string } =>
    typeof search.project === "string" && search.project.length > 0
      ? { project: search.project }
      : {},
  component: ThreadsSettingsPanel,
});
