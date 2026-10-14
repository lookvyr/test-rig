# Tools and skills

Open **Settings → Tools** to manage MCP servers and your Test Rig skill library.
Choose an environment and either **All projects** or a specific project. The
project choices exclude **No project**. Tools belong to that environment,
including when you connect from another device.

A repository has one Tools entry across its linked worktrees. Availability applies
to its current and future worktrees, even if you added a worktree separately.
Separate clones and environments keep independent settings.

If a registered workspace is missing or unreadable, expand **Unavailable projects**
in Tools to see its name and folder. Other projects stay available. Its saved settings and skill assignments are
preserved. Restore access to the folder and choose **Retry unavailable projects**
to bring it back into the selector.

## MCP servers

Choose **Add server** and enter a URL with optional headers, or a command with
arguments and environment variables. **Import JSON** opens a separate panel for a
single server configuration from common provider formats. **Use configuration**
fills the connection fields without changing your availability choices. Header and environment
values are secret by default; saved secrets are not shown again in the editor.

The server's availability controls which providers can use it. All-project
servers are inherited by projects. A project can override a server or turn it
off; resetting the override restores the all-project setting. Editing an
inherited connection's transport requires reentering its secrets.

Configuration changes apply to new or restarted agent sessions. **Configured**
means the server is saved but no active session has reported a connection. Open a
server's **Connections** tab to inspect each active session. Its action menu
offers reconnect and sign-in when the provider supports them. Codex's reload action
reloads its provider MCP configuration, rather than just one server.

This list manages servers added through Test Rig. Servers configured directly in
a provider continue to work through that provider; Test Rig does not list or edit
their configuration here. Turning off a Test Rig server does not turn off a
separately configured native server.

## Skill library

Choose **New skill** to write reusable instructions in the full-page Markdown
editor. The formatting toolbar inserts Markdown; Preview renders it, and Split
shows source and preview together on a wide screen.

Save a skill without assigning it to keep it in your library for later. In
Availability, choose all projects or selected projects and select the providers
that can use it. Turning a skill off for one project preserves its assignments
elsewhere. Editing a library skill updates its one shared copy.
A brief toast confirms when a skill is saved or copied into the library.

Assigned skills appear in the selected provider's `$` picker. Test Rig also gives
new or restarted agent sessions a catalogue of those skills and their file
locations. It does not install copies in the provider's global skill folders.
Restart existing sessions after changing availability, names, or the catalogue.
An agent that rereads a skill's file can see instruction edits immediately.

For a selected project, expand the discovered skills section to inspect skills
provided by the repository or provider. These sources are read-only here.
When providers discover the same file through symlinks, it appears once with
each provider listed. Separate files remain separate even when their names match.
**Copy to library** creates a separate, initially unassigned copy, including its
supporting files. It leaves the original intact and does not merge skills that
share a name. Provider-specific hooks or tool restrictions in copied metadata
are not enforced by the Test Rig catalogue.

Availability controls what Test Rig offers to an agent. It does not prevent an
agent with filesystem access from reading other files.
