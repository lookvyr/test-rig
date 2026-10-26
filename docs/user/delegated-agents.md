# Delegated agents

Ask the agent in a conversation to delegate a focused task, such as a code review
or investigation. Test Rig can run app-owned delegated agents using Codex,
Claude, or OpenCode, including a different provider or model from the parent.
Provider-native subagents are a separate workflow and follow their provider's
context and workspace behavior.

## Questions

A delegated child's question notifies its parent. The parent can answer from your
instructions or ask you for the missing information. If the parent is waiting
for the child, a blocking question ends that wait so it can respond; completion
still delivers the child's result afterward. Questions the child asks while it
continues working also notify the parent. Approval requests still need your
approval.

Answering or dismissing a question cancels a parent notification that has not
started yet. Canceling or interrupting a delegated task dismisses its unanswered
async questions, so answering an old question cannot restart canceled work.

## Workspace

App-owned delegated agents share the parent's current checkout by default,
including its branch, worktree, and uncommitted changes. Edits made by either
agent are visible to the other immediately. Give parallel agents distinct files
or tasks when they will edit the same checkout.

Ask for a delegated agent in its own worktree when the task needs a separate
checkout. It starts from the parent's current local Git commit. Uncommitted
changes are not copied. Project setup runs for a new worktree unless explicitly
skipped; synchronous setup completes before the child starts. A folder without
a Git commit cannot create an isolated child.

Stopping preparation closes its setup terminal and removes the newly created
checkout. Once the child has started, Stop preserves its worktree and edits.
Failed setup preserves the bound checkout for inspection. If cleanup fails, its
path stays attached so you can find it. Repeating an accepted delegation request
returns the same task; a new attempt after failure creates a new delegated task.
A child whose preparation failed or was stopped cannot resume through an ordinary
follow-up, which could otherwise bypass setup or use the shared checkout.

Separate top-level conversations can also use new or existing worktrees when
you ask for an independent conversation.

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

App-owned children start at normal speed, even when the parent uses Fast mode.
Fast mode or another service tier must be explicitly requested for that child.
Other model options, such as reasoning effort, inherit when the model is unchanged.

Results return to the parent conversation. Returning findings does not merge
the child's conversation history or perform a Git merge. Shared-checkout edits
are already present; changes made in a separate worktree need a separate Git
integration step.

For a Claude parent, automatic results wait for the current turn to finish so
delivery does not interrupt its tools. You can still explicitly steer the parent
while it works.

Open the child from its task row in the conversation, or from the right panel's
Agents tab. Thread details also has a compact **Subagents** section with the
agent title, model, status, elapsed time, hover details, and Stop controls. It
shows up to three agents before **Show more** and leaves forks and parent
conversations out. Completed agents stay in place in Thread details; the full
Agents tab groups them under Previous agents. Inside the child,
use Open parent thread to return to the conversation that delegated the work.

Working children remain visible after the parent finishes its response, including
while you send a follow-up. Claude's native background children retain their tool
activity and results as they finish.
When a direct native Codex child finishes after its parent has ended its turn,
its result can automatically resume the parent. A parent already working receives
the result through Codex instead of starting another turn. Stopped parents stay
stopped, and grandchildren report to their own parent.

Delegated children can open and inspect their own integrated browser tabs while
you keep the parent conversation selected, including in the desktop app.
Background subagents can continue using conversation tools after the parent
response ends, while their original provider account still owns the work.
Stopping the work, archiving the conversation, or switching accounts ends that
access.

When automatic continuation after updates is enabled, a restart can resume a
conversation that was waiting on a native subagent, including a command running
inside that subagent. The agent receives the interrupted subagent’s identifier
so it can resume or restart the work. A command running directly in an already
finished conversation does not trigger an automatic continuation.

Completion updates identify the child and show its result preview. Open the
update to visit that child. The update keeps its reported outcome and time even
if the child starts more work.

If a child receives a follow-up, its existing row in Thread details updates to
show the new work. Its status, elapsed time, and preview follow the new run
instead of the original completed task. In the full Agents tab it returns to
the active list.

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

## Follow-ups

Ask the parent to send a follow-up to an existing delegated child when you want
to continue with its conversation history. A new follow-up turn gets its own
tracked task and returns its result to the parent. The original task keeps its
published result. An update that steers a running task stays with that task.
For an independent review round, ask for a new delegated agent.

Agents can read effective snooze state and all linked pull requests through
conversation list and read tools. Snoozed conversations wake when the timer
expires, new work completes or fails, or a question needs attention.

## Claude workflows

When Claude runs a workflow with its Workflow tool, the workflow appears as one
subagent in **Subagents** and **Lineage**, named after the workflow. Expand it to
see each phase with its agents and how long they took; hover an agent for its
model, status and result. Phases appear as the workflow reaches them, and a
finished phase stays collapsed to one line until you open it. **Script** shows the workflow script
Claude ran. Each agent in a workflow has a chat of its own: click its row to
read its prompt, thinking, tool calls and reply. Claude does not stream a
workflow agent's work, so its chat fills in as each progress update arrives.

While a workflow runs, the square button on its row stops it, even after the
turn that launched it has ended; the conversation's turn keeps going. Stopping
the turn, or a turn that fails, also stops the workflows it launched.
