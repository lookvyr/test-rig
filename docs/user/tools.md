# Tools and skills

Open **Settings → Tools** to manage MCP servers and your Test Rig skill library.
Each server and skill is configured once, in one list, and then pointed at the
projects and providers it applies to. If more than one environment is connected,
choose one at the top; tools belong to that environment, including when you
connect from another device.

Each row shows a status dot (hover it for the state), the providers that can use
the tool, how many projects it reaches, and an on/off switch. A tool that is off
keeps its settings but reaches no sessions.
Click the count to pick projects. **New projects** at the bottom of that list
decides whether projects you add later get the tool too. Click anywhere else on a
row to open the tool's page.

The filter button narrows the list to the tools that reach one project or one
provider. An active filter shows as a chip; clear it with its **×**. Filtering
never changes where a tool applies.

A repository appears once, covering its linked worktrees, even if you added a
worktree separately. Separate clones and environments keep independent settings.
Chats started without a project appear as **Scratch chats**.
If a registered workspace is missing or unreadable, expand **Unavailable
projects** to see it. Its existing access is kept while you edit other projects.

## MCP servers

Choose **Add server** and enter a URL with optional headers, or a command with
arguments and environment variables. **Import JSON** fills the connection fields
from a single server configuration in common provider formats. Header and
environment values are secret by default; saved secrets are not shown again.

On a server's page, the connection fields save with **Save**; **Discard** drops
your edits. Projects, providers, and the on/off switch save as soon as you change
them. Changes apply to new or restarted agent sessions.

The page also lists the server's tools, as last reported by a running session.
Tools appear after a chat has used the server and stay listed after it ends,
including across restarts, until you change the server's URL or command. If the
server failed to connect, **Retry** reconnects its active sessions. **Sessions** shows each active session, with reconnect when the
provider supports it. Codex's reload action reloads its whole provider MCP
configuration.

When an HTTP server needs OAuth, its row shows **Sign in**, which opens the
server's page and starts sign-in. You can also use **Account → Sign in** there.
Complete authorization in your browser, return to Tools, and choose **Refresh**
to see **Signed in**. This sign-in is shared by Codex and Claude in the same
environment and does not require an active conversation.
Servers without authentication work while signed out.

OAuth servers must support discovery and dynamic client registration, as
Atlassian's remote MCP server does. Servers that require you to supply a
pre-registered OAuth client ID are not supported by shared sign-in yet.

Sign-in also works in desktop and remote browser connections. If the browser
cannot reach the callback page after authorization, copy its full address from
the address bar and paste it into **Sign-in callback URL**, then choose
**Complete sign-in**. Tokens stay with the environment that owns the server.
Expired credentials show **Sign-in expired**; choose **Sign in** to authorize
again. **Sign out** removes the saved sign-in for that server.
Configurations using the same server URL share this account, including across
projects and worktrees. A configured Authorization header takes precedence over
shared sign-in. After signing in, reconnect a failed active session or start a
new conversation to load its tools.

This list manages servers added through Test Rig. Servers configured directly in
a provider continue to work through that provider; Test Rig does not list or edit
their configuration here. Turning off a Test Rig server does not turn off a
separately configured native server.

## Skills

Choose **New skill** to write reusable instructions in the Markdown editor. The
formatting toolbar inserts Markdown; Preview renders it, and Split shows source
and preview together on a wide screen. Name, description, and instructions save
with **Save**; the on/off switch, projects, and providers save as soon as you
change them. Editing a
library skill updates its one shared copy.

Assigned skills appear in the selected provider's `$` picker. Test Rig also gives
new or restarted agent sessions a catalogue of those skills and their file
locations. It does not install copies in the provider's global skill folders.
Restart existing sessions after changing availability, names, or the catalogue.
An agent that rereads a skill's file can see instruction edits immediately.

While the list is filtered to one project, expand **Found outside Test Rig** to
inspect skills provided by the repository or provider. These sources are read-only here.
When providers discover the same file through symlinks, it appears once with
each provider listed. Separate files remain separate even when their names match.
**Copy to library** creates a separate copy for that project, including its
supporting files. It leaves the original intact and does not merge skills that
share a name. Provider-specific hooks or tool restrictions in copied metadata
are not enforced by the Test Rig catalogue.

Availability controls what Test Rig offers to an agent. It does not prevent an
agent with filesystem access from reading other files.
