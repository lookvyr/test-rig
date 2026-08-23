# Remote Access

Use this when you want to connect to a Test Rig server from another device such as a phone, tablet, or separate desktop app.

## Quick Pairing for a Running Server

If a server is already running on this machine, mint a fresh pairing token and QR code without restarting anything:

```bash
node apps/server/dist/bin.mjs pair
```

The source-built CLI finds the running server, issues a one-time pairing token,
and prints the pairing URL as a QR code you can scan from another device. Build
it first with `vp run --filter t3 build`.

If the server is only bound to loopback, the printed URL is not reachable from another device.
Restart the server with a `--host` address the other device can reach, then run `test-rig pair` again.
Use `--ttl` to change the token lifetime and `--base-dir` to target a specific data directory.

If no server is running, start one from the same checkout as shown below.

## Recommended Setup

Use a trusted private LAN or explicitly configured private network between your devices.

That gives you:

- a stable address to connect to
- transport security at the network layer
- less exposure than opening the server to the public internet

## Enabling Network Access

The two supported source-build paths are exposing the desktop app's backend or
running a headless server from the CLI. The inherited desktop-managed SSH path
is documented separately below because it still depends on npm publication.

### Option 1: Desktop App

If you are already running the desktop app and want to make it reachable from other devices:

1. Open **Settings** → **Connections**.
2. Under **This environment**, toggle **Network access** on. This will restart the app and run the backend on all network interfaces.
3. The settings panel will show the default reachable endpoint, with a `+N` control when more endpoints are available. Expand it to inspect alternatives such as loopback, LAN, or custom HTTPS endpoints.
4. Use **Create Link** to generate a pairing link you can share with another device.

The default endpoint controls the QR code and primary copy action for pairing links. You can change it from the expanded endpoint list. The preference is stored by endpoint type, so choosing the local LAN endpoint survives normal IP address changes when you move between networks.

When no user default is saved, the app uses the built-in LAN endpoint for pairing links when
available. You can set another endpoint as the default from the expanded endpoint list.

- HTTPS/WSS-compatible endpoints work from clients that can reach them.
- Non-loopback HTTP endpoints are useful for direct LAN pairing.
- Loopback-only endpoints are not useful for another device unless that device is the same machine.

If the copied link points directly at `http://192.168.x.y:3773`, open it from a client that can reach
that LAN address.

### Option 2: Headless Server (CLI)

Use this when you want to run the server without a GUI, for example on a remote machine over SSH.

Build and run the server from the checkout:

```bash
vp run --filter t3 build
node apps/server/dist/bin.mjs serve --host 0.0.0.0
```

`test-rig serve` starts the server without opening a browser and prints:

- a connection string
- a pairing token
- a pairing URL
- a QR code for the pairing URL

From there, connect from another device in either of these ways:

- scan the QR code on your phone
- in the desktop app, enter the full pairing URL
- in the desktop app, enter the host and token separately

Use `node apps/server/dist/bin.mjs serve --help` for the full flag reference. It
supports the same general startup options as the normal server command,
including an optional `cwd` argument.

Once paired, add projects normally: open the Command Palette and choose **Add Project**, then pick
the environment the project lives on. Every saved environment is offered, not only the local one.

### Option 3: Desktop-Managed SSH Launch

The inherited SSH launcher installs a versioned Test Rig npm package on the
remote machine. Test Rig no longer publishes that package, so this flow is not
part of the supported source-build path. Direct LAN or explicitly configured
remote connections remain available for a server you build and start yourself.

The UI and runtime are retained temporarily while the separate SSH/remote
boundary is audited. Invoking this flow may contact the npm registry.

On a Linux host, you can keep a source-built server running after logout using
your own process supervisor. Test Rig does not include inherited
package-backed service installation, management, or update commands.

## How Pairing Works

The remote device does not need a long-lived secret up front.

Instead:

1. `test-rig serve` issues a one-time owner pairing token.
2. The remote device exchanges that token with the server.
3. The server creates an authenticated session for that device.

After pairing, future access is session-based. You do not need to keep reusing the original token unless you are pairing a new device.

## Managing Access Later

Use `test-rig auth` to manage access after the initial pairing flow.

Typical uses:

- issue additional pairing credentials
- inspect active sessions
- revoke old pairing links or sessions

Use `test-rig auth --help` and the nested subcommand help pages for the full reference.

## Security Notes

- Treat pairing URLs and pairing tokens like passwords.
- Prefer binding `--host` to a trusted private address instead of exposing the server broadly.
- Anyone with a valid pairing credential can create a session until that credential expires or is revoked.
- Pairing links keep the credential in the URL hash, but it can still be exposed through browser
  history, screenshots, logs, or copy/paste.
- Use `test-rig auth` to revoke credentials or sessions you no longer trust.
