import { DEFAULT_SERVER_SETTINGS, ServerSettings } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import {
  materializeMcpServerSecrets,
  mcpServerSecretNames,
  planMcpServerSecrets,
  redactMcpServerSecrets,
} from "./mcpServerSecrets.ts";

const decodeServerSettings = Schema.decodeUnknownSync(ServerSettings);

describe("MCP server secrets", () => {
  it("stores each server's sensitive values separately and removes them with the server", () => {
    const server = (value: string) => ({
      transport: {
        type: "http",
        url: "https://example.test",
        headers: [{ name: "X-Credential", value }],
      },
    });
    const next = decodeServerSettings({
      mcpServers: { first: server("one"), second: server("two") },
    });
    const plan = planMcpServerSecrets(DEFAULT_SERVER_SETTINGS, next);
    const names = mcpServerSecretNames(plan.settings);
    expect(new Set(names).size).toBe(2);
    const values = new Map(
      plan.changes.flatMap((change) =>
        change.kind === "write" ? [[change.secretName, change.value] as const] : [],
      ),
    );
    const materialized = materializeMcpServerSecrets(plan.settings, values);
    expect(
      [materialized.mcpServers.first, materialized.mcpServers.second].map((entry) =>
        entry?.transport.type === "http"
          ? entry.transport.headers.map((variable) => variable.value)
          : [],
      ),
    ).toEqual([["one"], ["two"]]);
    expect(redactMcpServerSecrets(materialized)).toEqual(plan.settings);
    expect(
      planMcpServerSecrets(plan.settings, redactMcpServerSecrets(materialized)).changes,
    ).toEqual([]);
    const { second, ...remaining } = plan.settings.mcpServers;
    const secondName = mcpServerSecretNames({
      ...plan.settings,
      mcpServers: { second: second! },
    })[0];
    expect(
      planMcpServerSecrets(plan.settings, { ...plan.settings, mcpServers: remaining }).changes,
    ).toEqual([{ kind: "remove", secretName: secondName }]);
  });
});
