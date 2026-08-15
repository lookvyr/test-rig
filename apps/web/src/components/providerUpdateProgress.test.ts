import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { getProviderUpdateSidebarPillView, isProviderUpdateActive } from "./providerUpdateProgress";

function provider(status: "queued" | "running" | "failed" | "unchanged" | "succeeded") {
  return {
    instanceId: ProviderInstanceId.make("codex"),
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-08-15T00:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    updateState: {
      status,
      startedAt: "2026-08-15T00:01:00.000Z",
      finishedAt: status === "queued" || status === "running" ? null : "2026-08-15T00:02:00.000Z",
      message: status === "unchanged" ? "Could not confirm provider availability." : null,
      output: null,
    },
  } satisfies ServerProvider;
}

describe("provider update progress", () => {
  it("shows progress only for an explicitly running update", () => {
    expect(isProviderUpdateActive(provider("running"))).toBe(true);
    expect(getProviderUpdateSidebarPillView([provider("running")])).toMatchObject({
      tone: "loading",
      title: "Updating Codex",
    });
  });

  it("reports local confirmation failure without claiming the provider is outdated", () => {
    expect(getProviderUpdateSidebarPillView([provider("unchanged")])).toMatchObject({
      tone: "warning",
      title: "Could not confirm Codex",
      description: "Could not confirm provider availability.",
    });
  });

  it("auto-dismisses successful explicit-update feedback", () => {
    expect(getProviderUpdateSidebarPillView([provider("succeeded")])).toMatchObject({
      tone: "success",
      title: "Codex update complete",
      dismissAfterVisibleMs: 3_000,
    });
  });
});
