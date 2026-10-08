# OpenCode

Test Rig requires OpenCode 2. OpenCode 1 executables are rejected with a version
error. Set **Binary path** on the provider instance if the OpenCode 2 executable
is not on the server's `PATH`, then refresh provider status.

Models, agents, skills, and commands come from the selected OpenCode server
and the current chat’s repository or worktree. Switching chats updates the
composer’s workspace inventory without restarting Test Rig.
The plan agent limits edits to its plan locations. Switching back to the default
interaction mode restores the build agent unless you selected another agent.
Session approval grants apply to that session only.

Test Rig can launch its own local OpenCode server or connect to a configured
server URL and password. Stopping Test Rig does not stop an external server.
Login and provider configuration belong on the machine running that server.

Existing OpenCode 1 conversations remain readable, but their native sessions cannot
be resumed through OpenCode 2. Start a new conversation to continue work. Test Rig
does not automatically upgrade an OpenCode-owned database.

Structured plan/todo artifacts, MCP integration, and opening native subagents as
separate forked chats are unavailable in this integration. Ordinary plan-agent
conversation still works. Unsupported question forms fail explicitly instead of
submitting guessed answers.
