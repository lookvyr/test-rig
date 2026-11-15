import { createFileRoute } from "@tanstack/react-router";

import { ConnectionsSettings } from "../components/settings/ConnectionsSettings";

function SettingsEnvironmentsRoute() {
  return <ConnectionsSettings view="environments" />;
}

export const Route = createFileRoute("/_chat/settings/connections")({
  component: SettingsEnvironmentsRoute,
});
