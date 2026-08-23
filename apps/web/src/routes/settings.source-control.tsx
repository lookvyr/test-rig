import { EnvironmentId } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { SourceControlSettingsPanel } from "../components/settings/SourceControlSettings";

function SettingsSourceControlRoute() {
  const search = Route.useSearch();
  return (
    <SourceControlSettingsPanel
      {...(search.environmentId === undefined
        ? {}
        : { environmentId: EnvironmentId.make(search.environmentId) })}
    />
  );
}

export const Route = createFileRoute("/settings/source-control")({
  validateSearch: (search: Record<string, unknown>) => ({
    environmentId:
      typeof search.environmentId === "string" && search.environmentId.length > 0
        ? search.environmentId
        : undefined,
  }),
  component: SettingsSourceControlRoute,
});
