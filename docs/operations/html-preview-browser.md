# HTML preview browser

`html_preview` runs on the Test Rig server and needs no connected renderer. It lazily installs a pinned Chrome for Testing headless shell under `<Test Rig home>/tools/chrome-headless-shell/<platform>/<version>`. Download size and SHA-256 must match before extraction and atomic publication. Installs belong to the server scope, so a tool timeout does not restart the download.

Each preview uses a temporary profile and CDP pipes. At most two previews run concurrently. A capture times out after 20 seconds, limits screenshots to 4,000 pixels tall, and bounds console output. The tool returns the PNG as MCP image content alongside height and console metadata. Publishing with `html_render` never installs Chromium. When it is already installed, publication measures the page at nine widths (320–1,144 pixels) using one browser with up to three pages at a time. Measurement shares the two-browser concurrency limit with previews and falls back to publishing without measurements after six seconds or on failure.

## Linux setup

Sandboxing stays enabled by default. When the host needs shared libraries or an AppArmor exception for user namespaces, the tool error supplies a setup command using the current source or bundled server entry point and its resolved Test Rig home. Run that command on the server host. Without root, setup reports the required changes and prints a sudo command. With root, it applies the AppArmor profile and installs missing Debian/Ubuntu libraries through apt.

For a source checkout, the command is equivalent to:

```sh
sudo node apps/server/src/bin.ts browser setup --base-dir /absolute/path/to/test-rig-home
```

A container that cannot provide Chromium's sandbox may explicitly set `TEST_RIG_SERVER_BROWSER_SANDBOX=0` in the server environment. This disables the browser's process sandbox; Test Rig never applies this opt-out automatically. Prefer a host with sandbox support.

Preview pages have no saved cookies or logins. A local SOCKS proxy permits public destinations and rejects the host's interfaces and private networks, including addresses resolved through DNS. Local files are unavailable to the page; supported local images are embedded before launch. On hosts requiring an outbound HTTP proxy, external preview resources may be unavailable; self-contained HTML works without external requests.

Server-owned interactive browser tabs reuse this installer and host setup. They
use Playwright with persistent profiles under
`<Test Rig state directory>/server-browser/profiles`. Agent tabs use the default
profile that connected clients report (or the profile the agent names); only
Incognito, and agent tabs opened before any client reports profiles, use isolated
temporary contexts. Unlike HTML previews, interactive tabs can reach
the environment's localhost and private network services. They do not use the
HTML preview's public-network-only proxy.

The authenticated `/api/preview-stream` routes carry frames, input, downloads,
and uploads. Reverse proxies must forward WebSocket upgrades on
`/api/preview-stream/ws` as well as `/ws`. Read scope permits viewing; operate
scope is required for input and uploads. Remote bearer clients mint a fresh
ticket for each file transfer.

Web client disconnects leave browser pages running. A server restart ends open
pages but preserves human profile storage. The stream has no audio, native
context menu, or DevTools.

## Desktop browser host

The server owns every browser tab and drives all agent automation with
Playwright. When the desktop app launched the server, it passes two extra file
descriptors in the bootstrap envelope: fd 6 carries desktop events (tab attached,
detached, and Chrome DevTools Protocol messages) to the server, and fd 7 carries
commands back. A new tab waits up to ten seconds for the desktop to mount its
`<webview>`; the desktop then shares that webview's debugger through a CDP relay,
and the server connects Playwright to it over a loopback WebSocket with a random
path. A tab the desktop does not attach in time runs in the server's headless
Chromium and is marked `headless`, so every client streams it. A server the
desktop did not launch, including the WSL backend, has no relay and always runs
tabs headless.

The relay is local only. Its messages, including private values entered with
`preview_type_secret`, are not logged by the desktop or the server.

## Port discovery

The browser lists listeners owned by processes that a thread's terminals or
agents started; it never sends HTTP or TLS to those ports. Claude agents run with
`TEST_RIG_THREAD_ID=<environment id>/<thread id>` in their environment so servers
they start stay attributed to the thread after the agent exits. A listener marked
by another Test Rig environment on the same machine is neither listed nor
stoppable here. **Stop** signals a listed server's process
group, never the Test Rig server, an agent CLI, or a terminal shell, and requires
terminal operate scope. Set `TEST_RIG_PORT_DISCOVERY=0` in the server environment
to turn listener discovery off.
