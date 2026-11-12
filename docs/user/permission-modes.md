# Permission Modes

A permission mode controls how much the agent does on its own and when it stops to ask you.

The mode is set per thread. Open the model button in the composer and choose a mode under
**Permissions** at the bottom of the picker. A new thread also names its mode in the strip below
the composer. When a thread's mode differs from your default, the composer shows a permissions
button next to the model button; on narrow windows it appears as an icon, and the **More composer
controls** menu also lists every mode. Changing the mode in one thread does not change any other
thread. New Claude and Codex threads start in **Auto**, even
when created from a thread using another mode. You can pick a
different mode before sending; that choice stays selected if you change providers in the draft.
Existing threads keep their saved mode.

If **New thread** reuses a draft from another view, it keeps the draft's text and resets the
permission selection to the new thread's starting mode. A draft you are already editing keeps
your selection.

## The Modes

**Supervised**: ask before commands and file changes. The agent pauses and shows you what it
wants to run or edit, and waits for approval. Work outside the workspace is restricted.

**Auto-accept edits**: auto-approve edits, ask before other actions. File changes go through
without prompting; commands and anything else still stop for approval.

**Auto**: routine actions proceed without you; risky ones still ask. How this is enforced depends
on the provider: Codex delegates routine approvals to an AI reviewer, Claude uses its own auto
permission mode.

**Full access**: allow commands and edits without prompts. The agent runs
unattended until it finishes or asks a question of its own.

Approvals appear in the conversation, right after the tool call that is waiting
on them, marked **Waiting for approval**. An approval with no matching tool call
in view, such as one from an agent the conversation started, appears at the end
of the conversation. If you are following the end of the conversation, a new
approval scrolls into view. Choose **Approve** or **Decline** to continue.
**More** shows the other choices supported by that request, such as cancelling
the turn or remembering permission for the session. Some providers also support
persistent approval; that choice appears only when offered by the provider.

The composer stays available while an approval waits. Sending a message declines
the approvals shown in the conversation and sends your message to redirect the
agent; the placeholder reads **Send a message to decline and redirect the
agent**. If your message changed, another approval arrived, or an approval is
already being answered while the decline is sent, the message is not sent and
stays in the composer so you can send it again.

When a Claude approval supports feedback, the placeholder reads **Send feedback
to decline this request**. Sending then declines that request and delivers your
text to the agent that asked, including a subagent, instead of starting a new
message. Other pending approvals stay pending. Feedback accepts text only; remove
attachments and added context before sending it.

## Choosing a Mode

Use **Full access** for work in a worktree or a sandbox you can throw away.

Use **Supervised** on a repository where an unwanted command is expensive, or the first time you
run an unfamiliar task.

**Auto-accept edits** suits refactors where the edits are the point and you only care about the
shell commands.

## Provider Behavior

Each provider maps these modes onto its own approval and sandbox settings. Codex, for example,
translates the mode into its approval policy and sandbox level, so **Supervised** runs the CLI
with prompting enabled and a restricted workspace while **Full access** disables both. The
labels above describe what you get; the exact per-provider translation is internal and may
change.
