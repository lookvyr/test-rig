import { createFileRoute } from "@tanstack/react-router";
import { ToolsSettings } from "../components/settings/ToolsSettings";

export const Route = createFileRoute("/_chat/settings/tools")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { project?: string; environmentId?: string; skill?: string; tab?: string } => ({
    ...(typeof search.project === "string" && search.project ? { project: search.project } : {}),
    ...(typeof search.environmentId === "string" && search.environmentId
      ? { environmentId: search.environmentId }
      : {}),
    ...(typeof search.skill === "string" && search.skill ? { skill: search.skill } : {}),
    ...(search.tab === "availability" ? { tab: "availability" } : {}),
  }),
  component: ToolsSettings,
});
