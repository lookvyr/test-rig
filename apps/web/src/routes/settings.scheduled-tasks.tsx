import { createFileRoute } from "@tanstack/react-router";
import { ScheduledTasksSettings } from "../components/settings/ScheduledTasksSettings";
import { validateScheduledTasksSearch } from "../components/settings/scheduledTasksSettings.logic";

export const Route = createFileRoute("/settings/scheduled-tasks")({
  validateSearch: validateScheduledTasksSearch,
  component: SettingsScheduledTasksRoute,
});

function SettingsScheduledTasksRoute() {
  return <ScheduledTasksSettings {...Route.useSearch()} />;
}
