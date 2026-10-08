# October 7 pretrial verification

Baseline: `2642a6124` on `codex/orchestration-v2`. Thirteen selected changes were
implemented by GPT-6.1 Sol agents, individually reviewed for correctness and
simplification by Astra agents, then integrated and exercised by the primary
agent. [Port inventory](upstream-ports.md#october-7-pretrial-batch).

## Live verification

The web renderer ran against an isolated temporary home with a consistent copy
of historical state and a disposable Git repository. Live state was not written.

- Composer: rapid alphabet entry after palette dismissal and after README file
  mention insertion preserved the input and caret. README lookup returned results.
- Codex: normal turns and two concurrent app-owned children started successfully.
  Child cards remained visible after the parent's response and through a follow-up;
  a stable repeat finished both children with their expected results.
- Claude: a native background child ran a shell command after its parent replied.
  The parent accepted a follow-up; the child completed and retained its finished
  command in its own transcript. A fresh chat stopped during startup and accepted
  a new prompt that completed successfully.
- OpenCode: switching the stopped-and-resumed Claude chat to Big Pickle produced
  a visible context handoff and completed the expected response.
- Palette: 300 disposable history fixtures produced 23 mounted options while
  search advertised all 300. End reached the final result; Home, ArrowDown and
  Enter opened the expected second result.
- Git: worktree checks distinguished ignored-only content from hidden nonignored
  untracked files. A repository with 5,001 untracked files stayed responsive and
  reported dirty status without building unbounded branch details. Removing the
  fixture files refreshed the review panel to zero changes.
- Polling: actual WebSocket requests used `includeRemote: false` for passive
  sidebar rows. The active workspace retained its status subscription and client
  activity scope; navigation away released that subscription.
- Images: a real Codex browser snapshot with `includeImage=true, save=false`
  produced a working thumbnail and expanded signed preview. Its stored item was
  50,361 bytes; the wire item was 1,052 bytes, retaining an image marker without
  base64. This check exposed and led to a fix for Codex dropping image content
  when structured metadata was also present.

An earlier child run was interrupted by development source-watch restarts while
agents were still editing. The final child run was repeated after source freeze.

## Automated scope and limits

The final combined run passed all 945 tests across 18 files: provider adapters, provider session manager,
replay fixtures, ingestion and wire projection, signed assets, Git status/removal,
workspace indexing, palette logic/search, timeline logic and activity reporting.
The affected server, web, contracts, shared and client-runtime packages pass
typechecking. Scoped lint has no errors; existing warnings outside changed lines
remain. New warnings were resolved or locally explained where signed image index
is the stable asset identity.

The precise initialization, interrupted-start, credential, unload/resume and
idle-timer races are verified with controlled regression tests. The 30-minute idle
deadline and workspace scan timeout were not reproduced by waiting in the UI.
OpenCode's interruption races are covered by adapter tests; its normal startup
and provider handoff were exercised live. The shared web renderer and environment-aware asset/RPC contracts were
tested; a separate packaged Electron launch and remote network deployment were
not part of this pass. No repository-wide checks were run.
