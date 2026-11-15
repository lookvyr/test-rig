/**
 * Sensitive MCP server variables (env values, HTTP headers) live in the
 * secret store, never in settings.json or on the wire.
 *
 * On disk and towards clients a sensitive variable is `{value: "",
 * valueRedacted: true}`. A client that sends that back keeps the stored
 * secret; a new value replaces it. Non-sensitive values remain in settings.
 */
import type { McpServerConfig, McpServerVariable, ServerSettings } from "@t3tools/contracts";

const encode = (value: string) => Buffer.from(value, "utf8").toString("base64url");

/** Deterministic per (server, variable kind, variable name). */
function mcpServerSecretName(input: {
  readonly server: string;
  readonly variableKind: "env" | "header";
  readonly variable: string;
}): string {
  return `mcp-env-${encode(input.server)}-${input.variableKind}-${encode(input.variable)}`;
}

interface VariableSite {
  readonly server: string;
  readonly variableKind: "env" | "header";
  readonly variable: McpServerVariable;
}

function variablesOf(entry: McpServerConfig): {
  readonly kind: "env" | "header";
  readonly variables: ReadonlyArray<McpServerVariable>;
} {
  const transport = entry.transport;
  return transport.type === "stdio"
    ? { kind: "env", variables: transport.env }
    : { kind: "header", variables: transport.headers };
}

function* variableSites(settings: ServerSettings): Generator<VariableSite> {
  for (const [server, entry] of Object.entries(settings.mcpServers)) {
    const variables = variablesOf(entry);
    for (const variable of variables.variables) {
      yield { server, variableKind: variables.kind, variable };
    }
  }
}

const siteSecretName = (site: VariableSite) =>
  mcpServerSecretName({
    server: site.server,
    variableKind: site.variableKind,
    variable: site.variable.name,
  });

/**
 * Rebuild every server in `settings` with `map` applied to each variable.
 */
function mapVariables(
  settings: ServerSettings,
  map: (site: VariableSite) => McpServerVariable,
): ServerSettings {
  const mapEntry = (server: string, entry: McpServerConfig): McpServerConfig => {
    const transport = entry.transport;
    if (transport.type === "stdio") {
      if (transport.env.length === 0) return entry;
      return {
        ...entry,
        transport: {
          ...transport,
          env: transport.env.map((variable) => map({ server, variableKind: "env", variable })),
        },
      };
    }
    if (transport.headers.length === 0) return entry;
    return {
      ...entry,
      transport: {
        ...transport,
        headers: transport.headers.map((variable) =>
          map({ server, variableKind: "header", variable }),
        ),
      },
    };
  };
  const mcpServers = Object.fromEntries(
    Object.entries(settings.mcpServers).map(([server, entry]) => [server, mapEntry(server, entry)]),
  ) as ServerSettings["mcpServers"];
  return { ...settings, mcpServers };
}

/** What a client sees: sensitive values blanked, with a flag that one is stored. */
export function redactMcpServerSecrets(settings: ServerSettings): ServerSettings {
  return mapVariables(settings, ({ variable }) => {
    if (!variable.sensitive) {
      const { valueRedacted: _omit, ...rest } = variable;
      return rest;
    }
    return {
      ...variable,
      value: "",
      ...(variable.value.length > 0 || variable.valueRedacted ? { valueRedacted: true } : {}),
    };
  });
}

export type McpSecretChange =
  | { readonly kind: "write"; readonly secretName: string; readonly value: string }
  | { readonly kind: "copy"; readonly secretName: string; readonly from: string }
  | { readonly kind: "remove"; readonly secretName: string };

/**
 * Plan the secret-store writes for moving from `current` to `next`, and the
 * settings to persist (sensitive values replaced by the redaction flag).
 * A sensitive variable sent back redacted with no value keeps its secret,
 * moved to its new name when `storedAs` says it was renamed, and a value still
 * inline in `current` (hand-edited into settings.json) moves into the store.
 * A value the user typed replaces it; an empty value or a variable that is
 * no longer sensitive (or no longer exists) removes it.
 */
export function planMcpServerSecrets(
  current: ServerSettings,
  next: ServerSettings,
): { readonly settings: ServerSettings; readonly changes: ReadonlyArray<McpSecretChange> } {
  const stored = new Map<string, McpServerVariable>();
  for (const site of variableSites(current)) {
    if (site.variable.sensitive) stored.set(siteSecretName(site), site.variable);
  }
  const changes: McpSecretChange[] = [];
  const kept = new Set<string>();
  const settings = mapVariables(next, (site) => {
    const secretName = siteSecretName(site);
    const { valueRedacted: _omit, storedAs, ...plain } = site.variable;
    if (!plain.sensitive) return plain;
    const redacted = { ...plain, value: "", valueRedacted: true };
    if (plain.value.length > 0) {
      kept.add(secretName);
      changes.push({ kind: "write", secretName, value: plain.value });
      return redacted;
    }
    if (!site.variable.valueRedacted) return plain;
    const from =
      storedAs === undefined
        ? secretName
        : siteSecretName({
            ...site,
            server: storedAs.server,
            variable: { ...plain, name: storedAs.variable },
          });
    const previous = stored.get(from);
    if (previous === undefined) return plain;
    kept.add(secretName);
    if (!previous.valueRedacted && previous.value.length > 0) {
      changes.push({ kind: "write", secretName, value: previous.value });
    } else if (from !== secretName) {
      changes.push({ kind: "copy", secretName, from });
    }
    return redacted;
  });
  for (const secretName of stored.keys()) {
    if (!kept.has(secretName)) changes.push({ kind: "remove", secretName });
  }
  return { settings, changes };
}

/** The secret names whose values `materializeMcpServerSecrets` needs. */
export function mcpServerSecretNames(settings: ServerSettings): ReadonlyArray<string> {
  const names: string[] = [];
  for (const site of variableSites(settings)) {
    if (site.variable.sensitive && site.variable.valueRedacted) names.push(siteSecretName(site));
  }
  return names;
}

/** Settings with stored secret values filled back in, for server-side consumers. */
export function materializeMcpServerSecrets(
  settings: ServerSettings,
  secrets: ReadonlyMap<string, string>,
): ServerSettings {
  if (secrets.size === 0) return settings;
  return mapVariables(settings, (site) => {
    if (!site.variable.sensitive || !site.variable.valueRedacted) return site.variable;
    return { ...site.variable, value: secrets.get(siteSecretName(site)) ?? "" };
  });
}
