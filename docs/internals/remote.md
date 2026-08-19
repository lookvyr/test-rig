# Remote Architecture

> For maintainers. Using Sightseer? See [remote access](../user/remote-access.md).

A client talks directly to one Sightseer server over HTTP and WebSocket. The server owns providers,
projects, threads, terminals, Git, and filesystem operations; the connection layer only decides how
the client reaches that server.

## Connection targets

[`connection/model.ts`][model] defines the active target taxonomy:

| Target                    | Used for                                                               |
| ------------------------- | ---------------------------------------------------------------------- |
| `PrimaryConnectionTarget` | The platform-managed local server (desktop backend or CLI-served web). |
| `BearerConnectionTarget`  | A manually paired direct HTTP/WebSocket endpoint.                      |
| `SshConnectionTarget`     | A desktop-managed SSH environment.                                     |

Bearer and SSH targets are persisted; primary is platform-managed. Historical relay targets remain
decodable at the storage boundary only and are discarded during catalog migration.

## Pairing and advertised endpoints

Pairing links point directly at the server and carry their one-time token in the URL hash:

```text
https://machine.example.test/pair#token=PAIRCODE
```

The client exchanges the token with that origin, strips it from browser history, and stores the
resulting bearer credential locally. There is no hosted pairing router or proxy.

Desktop may advertise candidate endpoint pairs with reachability hints. Clients treat
them as hints, not proof. The connection attempt determines whether an endpoint works from the
current device.

## Direct and SSH access

Direct access uses `ws://` or `wss://` paired as a bearer target. Transport security and network
reachability remain the operator's responsibility.

Desktop-managed SSH discovers SSH targets, launches or reuses a remote Sightseer server, forwards a
local port, and returns ordinary HTTP/WebSocket endpoints. The renderer then connects through the
same runtime as any other target. Disconnect closes the tunnel and stops only a server the launcher
started.

## Security model

Remote-capable servers require explicit authentication. A client presents its bearer credential to
`POST /api/auth/websocket-ticket` and places only the returned short-lived ticket on the socket URL.
Each RPC method separately checks its required scope. Historical DPoP and relay credentials fail
closed; they are not alternate connection paths.

[model]: ../../packages/client-runtime/src/connection/model.ts
