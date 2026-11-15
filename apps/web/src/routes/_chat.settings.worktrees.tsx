import { createFileRoute } from "@tanstack/react-router";

import { WorktreesSettingsPanel } from "../components/settings/SettingsPanels";

export const Route = createFileRoute("/_chat/settings/worktrees")({
  component: WorktreesSettingsPanel,
});
