import { DEFAULT_SERVER_SETTINGS, ProjectId, ServerSettings } from "@t3tools/contracts";
import { ToolsScopeId } from "../../../packages/contracts/src/toolsScope.ts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import {
  materializeMcpServerSecrets,
  mcpServerSecretNames,
  planMcpServerSecrets,
  redactMcpServerSecrets,
} from "./mcpServerSecrets.ts";

const decodeServerSettings = Schema.decodeUnknownSync(ServerSettings);

describe("Tools-scope MCP secret ownership", () => {
  it("keeps global, physical-project and Tools-scope secrets distinct even when owner IDs and server names match", () => {
    const scope = ToolsScopeId.make("project:same-owner");
    const physical = ProjectId.make(scope);
    const server = (value: string) => ({
      transport: {
        type: "http",
        url: "https://example.test",
        headers: [{ name: "X-Credential", value }],
      },
    });
    const next = decodeServerSettings({
      mcpServers: { same: server("global") },
      projectSettingsOverrides: { [physical]: { mcpServers: { same: server("physical") } } },
      toolsScopeMcpServers: { [scope]: { same: server("tools-scope") } },
    });
    const plan = planMcpServerSecrets(DEFAULT_SERVER_SETTINGS, next);
    const names = mcpServerSecretNames(plan.settings);
    expect(new Set(names).size).toBe(3);
    expect(names.filter((name) => name.startsWith("mcp-tools-scope-"))).toHaveLength(1);
    const values = new Map(
      plan.changes.flatMap((change) =>
        change.kind === "write" ? [[change.secretName, change.value] as const] : [],
      ),
    );
    const materialized = materializeMcpServerSecrets(plan.settings, values);
    const materializedEntries = [
      materialized.mcpServers.same,
      materialized.projectSettingsOverrides[physical]?.mcpServers?.same,
      materialized.toolsScopeMcpServers[scope]?.same,
    ];
    expect(
      materializedEntries.map((entry) =>
        entry?.transport?.type === "http"
          ? entry.transport.headers.map((variable) => variable.value)
          : [],
      ),
    ).toEqual([["global"], ["physical"], ["tools-scope"]]);
    expect(redactMcpServerSecrets(materialized)).toEqual(plan.settings);
    const roundTrip = planMcpServerSecrets(plan.settings, redactMcpServerSecrets(materialized));
    expect(roundTrip.changes).toEqual([]);
    const deleted = planMcpServerSecrets(plan.settings, {
      ...plan.settings,
      toolsScopeMcpServers: {},
    });
    expect(deleted.changes).toEqual([
      { kind: "remove", secretName: names.find((name) => name.startsWith("mcp-tools-scope-")) },
    ]);
  });
});
