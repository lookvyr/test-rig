import { McpToolSummary, type McpServerConfig, type McpServerTransport } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { writeFileStringAtomically } from "../atomicWrite.ts";

/**
 * The last tool list each MCP server reported, so its page can show tools while no
 * session has it attached. An entry belongs to one URL or command: a session still
 * running an older target never overwrites it, and changing the target drops it.
 */
const Entry = Schema.Struct({ target: Schema.String, tools: Schema.Array(McpToolSummary) });
const HistoryFile = Schema.Record(Schema.String, Entry);
const decodeHistory = Schema.decodeUnknownEffect(Schema.fromJsonString(HistoryFile));
const encodeHistory = Schema.encodeEffect(Schema.fromJsonString(HistoryFile));

type ToolList = ReadonlyArray<McpToolSummary>;
const history = new Map<string, typeof Entry.Type>();
// Reports since the last read, by server then target; committed against current settings.
const reported = new Map<string, Map<string, ToolList>>();
let dirty = false;

const target = (transport: McpServerTransport) =>
  transport.type === "http" ? transport.url : [transport.command, ...transport.args].join("\0");

const sameTools = (left: ToolList, right: ToolList) =>
  left.length === right.length &&
  left.every(
    (tool, index) =>
      tool.name === right[index]!.name && tool.description === right[index]!.description,
  );

/** Note a connected session's tools; the next read keeps them if its target is current. */
export function rememberMcpTools(name: string, transport: McpServerTransport, tools: ToolList) {
  if (tools.length === 0) return;
  const byTarget = reported.get(name) ?? new Map<string, ToolList>();
  byTarget.set(
    target(transport),
    [...tools].sort((left, right) => left.name.localeCompare(right.name)),
  );
  reported.set(name, byTarget);
}

/**
 * Tools for servers still configured with the target they were seen on. Drops an entry
 * only when its server now points elsewhere; a server missing from settings is left out.
 */
export function rememberedMcpTools(
  servers: Readonly<Record<string, McpServerConfig>>,
  serverName?: string,
): Record<string, ToolList> {
  for (const [name, byTarget] of reported) {
    const config = servers[name];
    if (!config) continue;
    const current = target(config.transport);
    const tools = byTarget.get(current);
    const previous = history.get(name);
    if (tools && !(previous?.target === current && sameTools(previous.tools, tools))) {
      history.set(name, { target: current, tools });
      dirty = true;
    }
  }
  reported.clear();
  const result: Record<string, ToolList> = {};
  for (const [name, entry] of history) {
    const config = servers[name];
    if (!config) continue;
    if (target(config.transport) !== entry.target) {
      history.delete(name);
      dirty = true;
    } else if (serverName === undefined || name === serverName) result[name] = entry.tools;
  }
  return result;
}

const historyPath = Effect.fn(function* (stateDir: string) {
  const path = yield* Path.Path;
  return path.join(stateDir, "mcp-tools.json");
});

/** Merge the saved history; callers run it once per process. A bad file adds nothing. */
export const loadMcpToolHistory = Effect.fn("McpToolHistory.load")(function* (stateDir: string) {
  const fs = yield* FileSystem.FileSystem;
  const saved = yield* fs.readFileString(yield* historyPath(stateDir)).pipe(
    Effect.flatMap(decodeHistory),
    Effect.orElseSucceed(() => ({})),
  );
  for (const [name, entry] of Object.entries(saved))
    if (!history.has(name)) history.set(name, entry);
});

/** Write the history when it changed since the last save. */
export const saveMcpToolHistory = Effect.fn("McpToolHistory.save")(function* (stateDir: string) {
  if (!dirty) return;
  dirty = false;
  yield* encodeHistory(Object.fromEntries(history)).pipe(
    Effect.flatMap((contents) =>
      Effect.flatMap(historyPath(stateDir), (filePath) =>
        writeFileStringAtomically({ filePath, contents }),
      ),
    ),
    Effect.catch(() =>
      Effect.sync(() => {
        dirty = true;
      }),
    ),
  );
});

/** Clears process state between tests. */
export function resetMcpToolHistory() {
  history.clear();
  reported.clear();
  dirty = false;
}
