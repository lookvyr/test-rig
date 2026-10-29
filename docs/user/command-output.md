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
