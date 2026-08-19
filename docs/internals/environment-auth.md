# Environment Authentication Profile

> For maintainers. Using Sightseer? See [docs/user](../user/).

Sightseer's environment server uses scoped local credentials for browser and explicitly paired
clients. It has no account provider, hosted control plane, relay issuer, or proof-of-possession token
flow.

## Authorization Model

A session carries zero or more OAuth-style scope strings:

| Scope                   | Permission                                                               |
| ----------------------- | ------------------------------------------------------------------------ |
| `orchestration:read`    | Read snapshots, status, events, configuration, and filesystem/VCS state. |
| `orchestration:operate` | Dispatch user operations and mutate environment-side workspace state.    |
| `terminal:operate`      | Create, attach, input, resize, clear, restart, and terminate terminals.  |
| `review:write`          | Read review diff previews used to compose review feedback.               |
| `access:read`           | Inspect pairing links and client sessions.                               |
| `access:write`          | Create or revoke pairing links and client sessions.                      |

Ordinary pairing links grant the four client-operation scopes. Desktop and command-line
administrative bootstrap credentials additionally grant `access:read` and `access:write`.

## Authentication Flows

`POST /api/auth/browser-session` consumes a one-time bootstrap credential and creates an HTTP-only
browser session cookie. The response does not expose the session secret to browser JavaScript.

Non-browser clients exchange a one-time bootstrap credential at `POST /oauth/token`. The response
is an OAuth-shaped bearer token with a 30-day default lifetime. Requested scopes must be a subset
of the bootstrap grant.

`POST /api/auth/websocket-ticket` accepts an authenticated browser or bearer session and returns a
short-lived, single-purpose WebSocket ticket. The client appends only that ticket to the socket URL;
each RPC method still enforces its required scope.

Historical records whose method is `dpop-access-token`, or which carry a proof-key thumbprint,
remain decodable so old state can be inspected safely. Authentication rejects them. They are not
advertised, refreshed, or converted to bearer sessions.

## Standards Alignment

- Bearer access tokens use the `Authorization: Bearer` scheme from RFC 6750.
- Token exchange uses the request and response vocabulary from RFC 8693.
- Scope values follow the space-delimited capability model from RFC 6749.

This is not a general-purpose OAuth authorization server. Bootstrap token types, browser cookies,
and WebSocket tickets are product-specific adapters around Sightseer's local session model.

## Upgrade Behavior

Migration `031_AuthAuthorizationScopes` is a hard cutover from role-bearing auth records to scoped
records. It deletes existing pairing links and sessions while leaving non-authentication environment
state unchanged. Upgraded clients must pair again.
