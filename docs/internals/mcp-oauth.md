# Shared MCP OAuth

Test Rig owns OAuth for HTTP MCP servers configured in Settings → Tools.
`AppMcpOAuth` uses the MCP SDK for discovery, dynamic client registration,
authorization-code PKCE, and refresh. Credentials live in `ServerSecretStore`,
keyed by the canonical upstream URL within the environment. Provider names,
projects, worktrees, and thread IDs do not affect account identity.

`AppMcpAuth` resolves the saved configuration for the requested Tools scope before
starting or clearing authentication. Its RPC methods work without an active
provider session. Browser authorization returns to `/oauth/mcp/callback`; the
callback uses a short-lived, one-shot state and the server-held PKCE verifier.
If a remote browser cannot reach that address, the authenticated client can
forward the full callback URL through the completion RPC. Tokens never pass
through the browser RPC response.

`AppMcpConfig.appMcpProviderServers` projects HTTP entries into local proxy URLs
with the existing provider-scoped bearer credential. The original upstream
configuration remains in `McpProviderSession`. `AppMcpProxy` resolves the target
from that authenticated session and forwards HTTP MCP requests and response
streams. Stdio entries are unchanged. An explicit upstream Authorization header
takes precedence over shared OAuth.

The proxy loads credentials for each request and refreshes lazily. Requests for
one endpoint serialize credential mutations, including callback completion and
sign-out, so a concurrent refresh cannot restore a signed-out account. Access
token expiry with a usable refresh token remains signed in; rejected refresh
credentials or expired credentials without refresh support require sign-in.
Upstream authentication failures become a Test Rig sign-in requirement rather
than triggering a provider's independent OAuth flow against the proxy.

`ProviderMcpRuntime` combines provider connection status with shared auth state.
It suppresses native HTTP authentication and prevents reconnect while sign-in is
required. Once authentication succeeds, reconnect is available for failed
sessions. Configuration changes still apply to new or restarted provider sessions.

Shared OAuth currently requires dynamic client registration. Pre-registered
client configuration, provider-native credential import, and upstream token
revocation are not implemented. Sign-out clears Test Rig's stored credential and
pending authorization attempts for the endpoint.
