# Remote Access

Use this when you want to connect to a Sightseer server from another device such as a phone, tablet, or separate desktop app.

## Quick Pairing for a Running Server

If a server is already running on this machine, mint a fresh pairing token and QR code without restarting anything:

```bash
npx @lookvyr/sightseer pair
```

`sightseer pair` finds the running server (the shared `~/.sightseer` install, or the current worktree's dev server when run inside one), issues a one-time pairing token, and prints the pairing URL as a QR code you can scan from your phone.

If the server is only bound to loopback, the printed URL is not reachable from another device.
Restart the server with a `--host` address the other device can reach, then run `sightseer pair` again.
Use `--ttl` to change the token lifetime and `--base-dir` to target a specific data directory.

If no server is running, `sightseer pair` says so and points you at `npx @lookvyr/sightseer serve`.

## Recommended Setup

Use a trusted private LAN or explicitly configured private network between your devices.

That gives you:

- a stable address to connect to
- transport security at the network layer
- less exposure than opening the server to the public internet

## Enabling Network Access

There are three ways to reach your server from another device: expose the desktop app's backend,
run a headless server from the CLI, or have the desktop app launch Sightseer over SSH.

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

In the mobile app's **Add Environment** form, a numeric IP address without a scheme uses HTTP. Include `https://` explicitly when the backend is served over HTTPS.

### Option 2: Headless Server (CLI)

Use this when you want to run the server without a GUI, for example on a remote machine over SSH.

Run the server with `sightseer serve`.

```bash
npx @lookvyr/sightseer serve --host 0.0.0.0
```

`sightseer serve` starts the server without opening a browser and prints:

- a connection string
- a pairing token
- a pairing URL
- a QR code for the pairing URL

From there, connect from another device in either of these ways:

- scan the QR code on your phone
- in the desktop app, enter the full pairing URL
- in the desktop app, enter the host and token separately

Use `sightseer serve --help` for the full flag reference. It supports the same general startup options as the normal server command, including an optional `cwd` argument.

Once paired, add projects normally: open the Command Palette and choose **Add Project**, then pick
the environment the project lives on. Every saved environment is offered, not only the local one.

### Option 3: Desktop-Managed SSH Launch

Use this when you want the desktop app to start or reuse Sightseer on another machine over SSH.

1. Open **Settings** → **Connections**.
2. Under **Remote Environments**, choose **Add environment**.
3. Select the SSH launch flow.
4. Enter the SSH target, such as `user@example.com`.
5. Confirm the launch. The desktop app probes the host, starts or reuses a remote Sightseer server, opens a local port forward, and saves the environment.

After setup, the renderer connects to a local forwarded HTTP/WebSocket endpoint. The remote host still owns the actual Sightseer server, projects, files, git state, terminals, and provider sessions.

SSH launch is a desktop feature because it needs local process and SSH access. Once the environment is paired and saved, it uses the same environment list and connection model as direct LAN or custom HTTPS environments.

#### SSH Launch Troubleshooting

The desktop SSH launcher connects with a non-interactive `sh` session, writes a small launcher script under `~/.sightseer/ssh-launch/<host-key>/`, starts or reuses a remote Sightseer server, and forwards the remote loopback port back to your desktop.

The remote host must have a compatible Node.js runtime. Sightseer uses the server package's `engines.node` requirement:

```text
^22.16 || ^23.11 || >=24.10
```

During SSH launch, Sightseer first checks whether `node` is on `PATH`. If it is missing, the launcher
looks in the usual install directories and tries to activate a version manager if it finds one
(Volta, asdf, mise, fnm, nodenv, nvm). That covers most setups, but a version manager that only
initializes from an interactive shell profile will not be picked up.

If launch fails with `node: command not found`, a port-scan failure, or a message that the remote Node version does not satisfy the required range, SSH into the host and check the same non-interactive shell path Sightseer uses:

```bash
ssh user@example.com 'sh -lc "command -v node && node --version"'
```

If that does not print a compatible Node version, configure your version manager for non-interactive shells or install a compatible Node binary in one of the searched locations. For example, with nvm you may need a default alias:

```bash
nvm alias default 24
```

With mise, asdf, fnm, or nodenv, make sure the tool's shim directory is installed and resolves to a Node version satisfying the range above without an interactive shell.

If reconnecting after an app update fails, retry the SSH launch once. The launcher compares its generated runner script, stops stale launcher-managed remote servers, clears the SSH launch PID/port state, and starts a fresh remote server. You should not normally need to delete `~/.sightseer/ssh-launch` or kill `sightseer` processes manually.

## Updating a Remote Server

When the Sightseer web or desktop app and a remote server use different versions, a warning appears in
the conversation and in **Settings** → **Connections**. Follow the action shown there: Sightseer may
be able to update and reconnect the server for you, or it may ask you to update the desktop app or
run a copied command on the server machine.

Finish active work before updating because the server restarts briefly. For step-by-step guidance,
see [Keeping Sightseer in Sync](./updating.md).

On a Linux host, you can keep the server running after logout and manage it independently of the
connection method. See [Running Sightseer in the Background](./background-service.md).

## How Pairing Works

The remote device does not need a long-lived secret up front.

Instead:

1. `sightseer serve` issues a one-time owner pairing token.
2. The remote device exchanges that token with the server.
3. The server creates an authenticated session for that device.

After pairing, future access is session-based. You do not need to keep reusing the original token unless you are pairing a new device.

## Managing Access Later

Use `sightseer auth` to manage access after the initial pairing flow.

Typical uses:

- issue additional pairing credentials
- inspect active sessions
- revoke old pairing links or sessions

Use `sightseer auth --help` and the nested subcommand help pages for the full reference.

## Security Notes

- Treat pairing URLs and pairing tokens like passwords.
- Prefer binding `--host` to a trusted private address instead of exposing the server broadly.
- Anyone with a valid pairing credential can create a session until that credential expires or is revoked.
- Pairing links keep the credential in the URL hash, but it can still be exposed through browser
  history, screenshots, logs, or copy/paste.
- Use `sightseer auth` to revoke credentials or sessions you no longer trust.
