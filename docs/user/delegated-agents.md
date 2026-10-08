# Delegated agents

Ask the agent in a conversation to delegate a focused task, such as a code review
or investigation. Test Rig can run app-owned delegated agents using Codex,
Claude, or OpenCode, including a different provider or model from the parent.
Provider-native subagents are a separate workflow and follow their provider's
context and workspace behavior.

## Workspace

App-owned delegated agents use the parent's current checkout, including its
branch, worktree, and uncommitted changes. Edits made by either agent are visible
to the other immediately. Delegation does not create an isolated worktree or
provide a workspace selector. Give parallel agents distinct files or tasks when
they will edit the same checkout.

For isolated implementation, explicitly ask for a separate conversation in a
new or existing worktree. That creates an independent top-level conversation,
not a delegated child. A new worktree starts from the selected Git base;
uncommitted edits are not copied into it.

## Context and results

App-owned delegated agents start with the task prompt supplied by the parent.
Parent conversation history and attachments are not copied automatically, and
there is no include-history toggle. Ask the parent to include the relevant
requirements, findings, and file locations in that brief.

This controls the child's initial context, not which conversations it can read.
Existing project conversation access still applies. Context attached to the
parent from another project is not automatically granted to the child.

The child starts with the parent's provider and model unless another supported
choice is requested. Permission and interaction modes inherit; a delegated
agent cannot request broader permissions than its parent.

Results return to the parent conversation. Returning findings does not merge
the child's conversation history or perform a Git merge. Shared-checkout edits
are already present; changes made in a separate worktree need a separate Git
integration step.

For a Claude parent, automatic results wait for the current turn to finish so
delivery does not interrupt its tools. You can still explicitly steer the parent
while it works.

Open the child from its task row in the conversation, or from the right panel's
Agents tab. Completed children appear under Previous agents. Inside the child,
use Open parent thread to return to the conversation that delegated the work.

Completion updates identify the child and show its result preview. Open the
update to visit that child. The update keeps its reported outcome and time even
if the child starts more work.

If a child receives a follow-up, it returns to the active agents list. Its status,
elapsed time, and preview follow the new work instead of the original completed
task.

When a parent stops waiting after a timeout, the delegated task can still be
running. Ask the parent to inspect or cancel that task instead of launching a
duplicate. For another app-owned review round, ask the parent to delegate again
with the original brief, prior findings, and any unresolved questions.

When you configure multiple accounts for the same provider, agent hover cards
name the account, and provider-managed subagent status bars show its badge.
Configured account colors also appear in these indicators.
For app-owned children, hover cards also show saved effort and fast speed when
those settings match the child's model and account. Provider-native children
do not inherit these labels from the parent's settings.

## Stopping delegated work

Stopping the parent stops its app-owned delegated children and their delegated
children recursively. It also ends those conversations' pull request watches
and prevents pending delegated results from automatically waking them again.
Independent historical forks are not part of this cancellation tree.

To stop one child, use its Stop button in the Agents tab's Lineage list, open
the child and choose Stop, or ask the parent to cancel that task. The button
appears when you hover or focus an active app-owned child and stays visible on
touch devices. Stopping one child also stops its descendants; the parent and
siblings continue working.

Cancelling an already completed task also stops later work in its child
conversation. Its published result remains available. Provider-native subagents
follow their provider's interruption behavior and do not have this Lineage
shortcut.
