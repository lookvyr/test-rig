import { createFileRoute } from "@tanstack/react-router";
import { ToolsSettings } from "../components/settings/ToolsSettings";

const SEARCH_KEYS = ["environmentId", "project", "provider", "server", "skill", "signin"] as const;
type ToolsSearch = Partial<Record<(typeof SEARCH_KEYS)[number], string>>;

/** `project` and `provider` filter the list; `server` and `skill` open one tool's page. */
export const Route = createFileRoute("/_chat/settings/tools")({
  validateSearch: (search: Record<string, unknown>): ToolsSearch =>
    Object.fromEntries(
      SEARCH_KEYS.flatMap((key) => {
        const value = search[key];
        return typeof value === "string" && value ? [[key, value]] : [];
      }),
    ),
  component: ToolsSettings,
});
