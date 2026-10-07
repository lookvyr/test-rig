# HTML preview browser

`html_preview` runs on the Test Rig server and needs no connected renderer. It lazily installs a pinned Chrome for Testing headless shell under `<Test Rig home>/tools/chrome-headless-shell/<platform>/<version>`. Download size and SHA-256 must match before extraction and atomic publication. Installs belong to the server scope, so a tool timeout does not restart the download.

Each preview uses a temporary profile and CDP pipes. At most two previews run concurrently. A capture times out after 20 seconds, limits screenshots to 4,000 pixels tall, and bounds console output. The tool returns the PNG as MCP image content alongside height and console metadata. Publishing with `html_render` does not launch or install Chromium.

## Linux setup

Sandboxing stays enabled by default. When the host needs shared libraries or an AppArmor exception for user namespaces, the tool error supplies a setup command using the current source or bundled server entry point and its resolved Test Rig home. Run that command on the server host. Without root, setup reports the required changes and prints a sudo command. With root, it applies the AppArmor profile and installs missing Debian/Ubuntu libraries through apt.

For a source checkout, the command is equivalent to:

```sh
sudo node apps/server/src/bin.ts browser setup --base-dir /absolute/path/to/test-rig-home
```

A container that cannot provide Chromium's sandbox may explicitly set `TEST_RIG_SERVER_BROWSER_SANDBOX=0` in the server environment. This disables the browser's process sandbox; Test Rig never applies this opt-out automatically. Prefer a host with sandbox support.

Preview pages have no saved cookies or logins. A local SOCKS proxy permits public destinations and rejects the host's interfaces and private networks, including addresses resolved through DNS. Local files are unavailable to the page; supported local images are embedded before launch. On hosts requiring an outbound HTTP proxy, external preview resources may be unavailable; self-contained HTML works without external requests.

Server-owned interactive browser tabs reuse this installer and host setup. They
use Playwright with persistent human profiles under
`<Test Rig state directory>/server-browser/profiles`; agent sessions and Incognito
use isolated temporary contexts. Unlike HTML previews, interactive tabs can reach
the environment's localhost and private network services. They do not use the
HTML preview's public-network-only proxy.

The authenticated `/api/preview-stream` routes carry frames, input, downloads,
and uploads. Reverse proxies must forward WebSocket upgrades on
`/api/preview-stream/ws` as well as `/ws`. Read scope permits viewing; operate
scope is required for input and uploads. Remote bearer clients mint a fresh
ticket for each file transfer.

Web client disconnects leave browser pages running. A server restart ends open
pages but preserves human profile storage. Agent automation prefers an available
native desktop host; otherwise it uses the server browser, keeping that assignment
for the provider session. The stream has no audio, native context menu, or DevTools.
