import type {
  ListMcpRuntimeStatusesInput,
  McpRuntimeAuthenticateResult,
  McpRuntimeOperationInput,
  McpRuntimeState,
  McpRuntimeStatus,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { McpRuntimeError } from "@t3tools/contracts";

export { McpRuntimeError as ProviderMcpRuntimeError } from "@t3tools/contracts";
export interface ProviderMcpConnection {
  readonly state: McpRuntimeState;
  readonly toolCount?: number | null;
  readonly authStatus?: string | null;
  readonly authenticateSupported?: boolean;
  readonly reconnectSupported?: boolean;
}
export interface ProviderMcpRuntime {
  readonly identity: Pick<
    McpRuntimeStatus,
    "threadId" | "projectId" | "provider" | "providerSessionId" | "providerInstanceId"
  >;
  readonly servers: ReadonlyArray<{ readonly name: string; readonly runtimeName: string }>;
  readonly inventory?: Effect.Effect<ReadonlyMap<string, ProviderMcpConnection>, McpRuntimeError>;
  readonly status: (runtimeName: string) => Effect.Effect<ProviderMcpConnection, McpRuntimeError>;
  readonly reconnect?: (runtimeName: string) => Effect.Effect<void, McpRuntimeError>;
  readonly authenticate?: (
    runtimeName: string,
  ) => Effect.Effect<McpRuntimeAuthenticateResult, McpRuntimeError>;
}
export const providerMcpRequestError = () =>
  new McpRuntimeError({ operation: "provider", message: "The provider MCP request failed." });
const runtimes = new Map<ThreadId, ProviderMcpRuntime>();
/** The disposer only removes its own registration, so closing an old query preserves its replacement. */
export function registerProviderMcpRuntime(runtime: ProviderMcpRuntime): () => void {
  runtimes.set(runtime.identity.threadId, runtime);
  return () => {
    if (runtimes.get(runtime.identity.threadId) === runtime)
      runtimes.delete(runtime.identity.threadId);
  };
}
export function normalizeMcpRuntimeState(state: string | null | undefined): McpRuntimeState {
  switch (state) {
    case "connected":
      return "connected";
    case "pending":
    case "starting":
      return "connecting";
    case "needs-auth":
    case "needs_auth":
    case "authenticationRequired":
      return "needs-auth";
    case "failed":
      return "failed";
    case "disabled":
      return "disabled";
    case "notStarted":
    case "cancelled":
      return "disconnected";
    default:
      return "unknown";
  }
}
export const listMcpRuntimeStatuses = Effect.fn("ProviderMcpRuntime.list")(function* (
  input: ListMcpRuntimeStatusesInput = {},
) {
  const selected = [...runtimes.values()].filter(
    (runtime) =>
      (input.projectId === undefined || runtime.identity.projectId === input.projectId) &&
      runtime.servers.some(
        (server) => input.serverName === undefined || server.name === input.serverName,
      ),
  );
  const results = yield* Effect.forEach(
    selected,
    (runtime) =>
      Effect.gen(function* () {
        const inventory =
          runtime.inventory === undefined
            ? undefined
            : yield* runtime.inventory.pipe(Effect.timeout("10 seconds"), Effect.result);
        const statuses = yield* Effect.forEach(
          runtime.servers.filter(
            (server) => input.serverName === undefined || server.name === input.serverName,
          ),
          (server) => {
            const status =
              inventory === undefined
                ? runtime.status(server.runtimeName)
                : inventory._tag === "Success"
                  ? Effect.succeed(
                      inventory.success.get(server.runtimeName) ?? { state: "unknown" as const },
                    )
                  : Effect.fail(providerMcpRequestError());
            return status.pipe(
              Effect.timeout("10 seconds"),
              Effect.map(
                (connection) =>
                  ({
                    ...runtime.identity,
                    serverName: server.name,
                    runtimeName: server.runtimeName,
                    state: connection.state,
                    toolCount: connection.toolCount ?? null,
                    authStatus: connection.authStatus ?? null,
                    reconnectSupported:
                      runtime.reconnect !== undefined && connection.reconnectSupported !== false,
                    authenticateSupported:
                      runtime.authenticate !== undefined &&
                      connection.authenticateSupported === true,
                    error: null,
                  }) satisfies McpRuntimeStatus,
              ),
              Effect.catch(() =>
                Effect.succeed({
                  ...runtime.identity,
                  serverName: server.name,
                  runtimeName: server.runtimeName,
                  state: "unknown" as const,
                  toolCount: null,
                  authStatus: null,
                  reconnectSupported: false,
                  authenticateSupported: false,
                  error: "The provider could not report this MCP server's status.",
                } satisfies McpRuntimeStatus),
              ),
            );
          },
          { concurrency: 4 },
        );
        return { runtime, statuses };
      }),
    { concurrency: 4 },
  );
  // A provider may close while its inventory request is in flight.
  return results.flatMap(({ runtime, statuses }) =>
    runtimes.get(runtime.identity.threadId) === runtime ? statuses : [],
  );
});
const resolveOperation = (input: McpRuntimeOperationInput) =>
  Effect.sync(() => {
    const runtime = runtimes.get(input.threadId);
    const server = runtime?.servers.find((server) => server.name === input.serverName);
    return runtime && server ? { runtime, server } : undefined;
  });
export const reconnectMcpServer = Effect.fn("ProviderMcpRuntime.reconnect")(function* (
  input: McpRuntimeOperationInput,
) {
  const entry = yield* resolveOperation(input);
  if (!entry?.runtime.reconnect)
    return yield* new McpRuntimeError({
      operation: "runtime",
      message: "This active provider session does not support reconnecting this server.",
    });
  const connection = yield* entry.runtime
    .status(entry.server.runtimeName)
    .pipe(Effect.timeout("10 seconds"), Effect.mapError(providerMcpRequestError));
  if (connection.reconnectSupported === false)
    return yield* new McpRuntimeError({
      operation: "runtime",
      message: "This MCP server was not registered with the provider.",
    });
  yield* entry.runtime.reconnect(entry.server.runtimeName).pipe(
    Effect.timeout("15 seconds"),
    Effect.mapError(
      () =>
        new McpRuntimeError({
          operation: "runtime",
          message: "The provider could not reconnect this MCP server.",
        }),
    ),
  );
});
export const authenticateMcpServer = Effect.fn("ProviderMcpRuntime.authenticate")(function* (
  input: McpRuntimeOperationInput,
) {
  const entry = yield* resolveOperation(input);
  if (!entry?.runtime.authenticate)
    return yield* new McpRuntimeError({
      operation: "runtime",
      message: "This active provider session does not support authenticating this server.",
    });
  const connection = yield* entry.runtime.status(entry.server.runtimeName).pipe(
    Effect.timeout("10 seconds"),
    Effect.mapError(
      () =>
        new McpRuntimeError({
          operation: "runtime",
          message: "The provider could not report this MCP server's authentication capability.",
        }),
    ),
  );
  if (!connection.authenticateSupported)
    return yield* new McpRuntimeError({
      operation: "runtime",
      message: "This server does not support provider-managed authentication.",
    });
  const result = yield* entry.runtime.authenticate(entry.server.runtimeName).pipe(
    Effect.timeout("15 seconds"),
    Effect.mapError(
      () =>
        new McpRuntimeError({
          operation: "runtime",
          message: "The provider could not start authentication for this MCP server.",
        }),
    ),
  );
  if (result.authorizationUrl === null) return result;
  const url = yield* Effect.try({
    try: () => new URL(result.authorizationUrl!),
    catch: () =>
      new McpRuntimeError({
        operation: "runtime",
        message: "The provider returned an invalid authorization URL.",
      }),
  });
  if (!["http:", "https:"].includes(url.protocol))
    return yield* new McpRuntimeError({
      operation: "runtime",
      message: "The provider returned an unsupported authorization URL.",
    });
  return result;
});
