import * as Schema from "effect/Schema";
import { ProjectId, ProviderSessionId, ThreadId } from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";
import { McpServerProvider } from "./mcpServers.ts";

export const McpRuntimeState = Schema.Literals([
  "connected",
  "connecting",
  "needs-auth",
  "failed",
  "disconnected",
  "disabled",
  "unsupported",
  "unknown",
]);
export type McpRuntimeState = typeof McpRuntimeState.Type;
export const McpRuntimeStatus = Schema.Struct({
  serverName: Schema.String,
  runtimeName: Schema.String,
  projectId: Schema.NullOr(ProjectId),
  threadId: ThreadId,
  providerSessionId: ProviderSessionId,
  providerInstanceId: ProviderInstanceId,
  provider: McpServerProvider,
  state: McpRuntimeState,
  toolCount: Schema.NullOr(Schema.Number),
  authStatus: Schema.NullOr(Schema.String),
  reconnectSupported: Schema.Boolean,
  authenticateSupported: Schema.Boolean,
  error: Schema.NullOr(Schema.String),
});
export type McpRuntimeStatus = typeof McpRuntimeStatus.Type;
export const ListMcpRuntimeStatusesInput = Schema.Struct({
  projectId: Schema.optionalKey(ProjectId),
  serverName: Schema.optionalKey(Schema.String),
});
export type ListMcpRuntimeStatusesInput = typeof ListMcpRuntimeStatusesInput.Type;
export const McpRuntimeOperationInput = Schema.Struct({
  threadId: ThreadId,
  serverName: Schema.String,
});
export type McpRuntimeOperationInput = typeof McpRuntimeOperationInput.Type;
export const McpRuntimeAuthenticateResult = Schema.Struct({
  authorizationUrl: Schema.NullOr(Schema.String),
});
export type McpRuntimeAuthenticateResult = typeof McpRuntimeAuthenticateResult.Type;

export const ListMcpRuntimeStatusesResult = Schema.Struct({
  statuses: Schema.Array(McpRuntimeStatus),
});
export type ListMcpRuntimeStatusesResult = typeof ListMcpRuntimeStatusesResult.Type;

/** Authentication belongs to the saved HTTP server, independently of provider sessions. */
export const McpOAuthServerInput = Schema.Struct({
  serverName: Schema.String,
  projectId: Schema.optionalKey(ProjectId),
});
export type McpOAuthServerInput = typeof McpOAuthServerInput.Type;
export const McpOAuthBeginInput = Schema.Struct({
  ...McpOAuthServerInput.fields,
  callbackUrl: Schema.String,
});
export type McpOAuthBeginInput = typeof McpOAuthBeginInput.Type;
export const McpOAuthState = Schema.Literals(["signed-out", "signed-in", "expired"]);
export type McpOAuthState = typeof McpOAuthState.Type;
export const McpOAuthStatus = Schema.Struct({
  serverName: Schema.String,
  projectId: Schema.NullOr(ProjectId),
  state: McpOAuthState,
  error: Schema.NullOr(Schema.String),
});
export type McpOAuthStatus = typeof McpOAuthStatus.Type;
export const ListMcpOAuthStatusesResult = Schema.Struct({
  statuses: Schema.Array(McpOAuthStatus),
});
export type ListMcpOAuthStatusesResult = typeof ListMcpOAuthStatusesResult.Type;
export const McpOAuthBeginResult = Schema.Struct({
  flowId: Schema.NullOr(Schema.String),
  authorizationUrl: Schema.NullOr(Schema.String),
});
export type McpOAuthBeginResult = typeof McpOAuthBeginResult.Type;
export const McpOAuthCompleteInput = Schema.Struct({
  flowId: Schema.String,
  callbackUrl: Schema.String,
});
export type McpOAuthCompleteInput = typeof McpOAuthCompleteInput.Type;
export class McpRuntimeError extends Schema.TaggedError<McpRuntimeError>()("McpRuntimeError", {
  operation: Schema.String,
  message: Schema.String,
}) {}
