# Sidebar

Sidebar V2 is enabled by default in web and desktop builds. It shows a flat thread list,
with active work shown as cards and settled threads as compact rows.

To use the original sidebar, turn off **Sidebar V2** in **Settings → Beta**. Test Rig remembers
your choice across restarts. An existing explicit choice to use the original sidebar is preserved.

## Agent conversations

When a provider starts a subagent, open its conversation from the parent thread's
agent activity. Subagent conversations stay out of the main sidebar; independent
threads and forks remain visible. The child shows its messages, tools, model, effort, and current
status, with a link back to its parent. Provider-owned child conversations show
status controls in place of a composer; answer their approvals and questions in
the parent. Completed agents stay completed when a late completion update arrives.

You can still open temporary side chats from a completed Codex or Claude turn.
See [Side chats](./side-chats.md) for how their context and lifetime work.
