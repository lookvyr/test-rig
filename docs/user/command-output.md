# Command output

Command rows start collapsed. Expand a row to see its output while it runs. Collapse
it to stop receiving updates. There is no global streaming setting.

The output panel scrolls within a fixed maximum height. It follows new output until
you scroll upward; scroll back to the bottom to resume following. Long or noisy
commands show a bounded tail with an “Earlier output not shown” label. The final
output remains available when you reopen the row. A disconnected stream shows an
error alongside any output already received; collapse and reopen to retry.

Codex supplies live command output directly. Its live preview can omit initial
output that the provider supplies only with the final result. Claude support is
best effort: when
Claude Code announces a foreground Bash task and writes its temporary task file,
Test Rig tails that file. This is a private Claude Code layout and can change; if
the file is missing, inaccessible, or the command never announces a task, output
appears when the tool finishes. Background Claude tasks use their existing task
lifecycle rather than this foreground preview.

Older Test Rig servers continue to show final output through the existing detail
request.

Raw command chunks are transient. They bypass orchestration event storage and the
thread stream. Each expanded panel receives a normalized, bounded snapshot at most
four times per second. The server retains a bounded set of live and recently
finished tails; this preview is not an output archive.

## Quieter conversations

In **Settings → General → Tool calls in chat**, choose **Show all**, **Hide successful**, **Hide all**, or **Zen**. Hide successful keeps calls visible while they run and retains failures. Hide all removes ordinary tool calls from the conversation and shows **Thinking** while the agent works. Errors, approvals, questions, secret requests, and agent interactions remain available. This display preference is saved on this device and does not delete history. Switch back to Show all to see the full activity.

**Zen** also hides the agent's in-between messages, so each turn shows your message and the agent's last reply, which appears when the turn ends. While the agent works, the live row shows the latest line it wrote or thought. If you steer while the agent is answering, the reply it gave to your steer stays too. Find shows the in-between messages while it is open, and a citation always shows the message it points to. Approvals still wait in the composer. Answered questions, compactions, and errors always show; failed tool calls do not.
