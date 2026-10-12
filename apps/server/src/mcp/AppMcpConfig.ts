import * as NodeCrypto from "node:crypto";
import { mcpServerVariableRecord, type ResolvedMcpServer } from "@t3tools/contracts";

export const appMcpRuntimeName = (name: string, threadId?: string) =>
  threadId === undefined
    ? `tru-${name}`
    : `tru-${NodeCrypto.createHash("sha256").update(threadId).digest("hex").slice(0, 8)}-${name}`;
export function codexAppMcpConfig(servers: ReadonlyArray<ResolvedMcpServer>) {
  return Object.fromEntries(
    servers.map(({ name, transport }) => [
      appMcpRuntimeName(name),
      transport.type === "stdio"
        ? {
            command: transport.command,
            args: [...transport.args],
            env: mcpServerVariableRecord(transport.env),
          }
        : { url: transport.url, http_headers: mcpServerVariableRecord(transport.headers) },
    ]),
  );
}
/** Claude serializes MCP config into argv; put header secrets in the child environment. */
export function claudeAppMcpConfig(servers: ReadonlyArray<ResolvedMcpServer>) {
  const environment: Record<string, string> = {};
  const configs = Object.fromEntries(
    servers.map(({ name, transport }) => {
      const runtimeName = appMcpRuntimeName(name);
      const references = (variables: Readonly<Record<string, string>>) =>
        Object.fromEntries(
          Object.entries(variables).map(([key, value], index) => {
            const envName = `TEST_RIG_MCP_${NodeCrypto.createHash("sha256").update(name).digest("hex").slice(0, 16).toUpperCase()}_${index}`;
            environment[envName] = value;
            return [key, "${" + envName + "}"];
          }),
        );
      if (transport.type === "stdio")
        return [
          runtimeName,
          {
            type: "stdio" as const,
            command: transport.command,
            args: [...transport.args],
            env: references(mcpServerVariableRecord(transport.env)),
          },
        ];
      return [
        runtimeName,
        {
          type: "http" as const,
          url: transport.url,
          headers: references(mcpServerVariableRecord(transport.headers)),
        },
      ];
    }),
  );
  return { configs, environment };
}
