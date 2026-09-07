# Pull request workspace implementation plan

The approved design preserves the thread inbox and adds a global Pull requests
entry above Settings. A central queue covers saved projects. Selecting a pull
request opens Summary, Code, and Timeline in an inspector; a linked conversation
can show the same inspector alongside the existing Diff and Files surfaces.

## Scope and seams

- GitHub first, through the environment's existing GitHub CLI credentials and
  typed RPC transport. The server checks the source-control integration gate
  before discovery or network access. Other providers show an explicit unsupported
  state. Each environment resolves its own project paths and credentials.
- Read on opening the workspace and explicit refresh. No polling, background
  synchronization, posting reviews, merging, or automatic agent turns.
- Queue filters: project, open/closed/merged/all, authored/review requested/all,
  and text search. Bounded results show when more items exist. Loading, empty,
  disabled, missing authentication, unavailable projects, and partial failures
  remain distinguishable.
- Details include description, checks, review/comment timeline, and changed files.
  Missing or truncated patches remain visible as limitations. Inline local notes
  retain file, side, line, and head revision so a later revision cannot silently
  change their meaning.
- Local notes, selected context, editable instructions, and queue state use the
  existing client persistence approach, scoped by environment and canonical PR
  identity. They survive navigation and restart on that client; they are not
  published to GitHub or synchronized between devices.
- Global preparation offers a new worktree conversation or an existing regular
  thread. The destination is a tentative form choice until the explicit handoff
  succeeds. Side threads are excluded. A failed handoff preserves the existing
  association and all drafts; an unavailable destination never creates a
  replacement conversation implicitly.
- A globally linked PR offers Open conversation and a secondary Change
  conversation action. Opening the saved conversation only navigates, preserving
  composer text, attachments, and model. New worktree preparation reuses existing
  machinery and only runs after that explicit choice.
- Inside a linked thread, the inspector has no destination picker or draft
  preparation. Add to message puts selected comments and local notes into that
  thread's current composer, with the PR reference and revision. Further
  instructions belong in the composer; follow-ups do not repeat the full PR
  description. Adding the same context twice does not duplicate it. Nothing is
  sent automatically. Side chat controls do not change the PR association.
- Both sidebar versions and Settings expose the entry point. The command palette
  offers the same action. Shared web rendering supplies desktop and browser UI;
  existing responsive panel behavior handles narrow windows.

## Risks and verification

Focused backend tests cover disabled-provider behavior with zero external calls,
CLI decoding, filters, and detailed responses. Client tests cover note isolation,
revision handling, persistence, preserving unsent text, and duplicate handoff.
Scoped typechecks/lint and the desktop build verify shared contracts and surfaces.

The primary agent reviews delegated changes and performs one integrated computer
use pass: enter from conversation and Settings; filter/select/refresh; inspect
checks, code, and timeline; add/remove notes; prepare a draft; return to the queue;
reopen linked details; verify unsent context after restart and narrow layout.
The linked-review regression pass verifies that both global handoff choices
still work, changing or cancelling a destination leaves the current link intact,
side threads are absent, and Add to message preserves the active thread and
composer while leaving the inspector mounted. Reopening a linked conversation
must not append context or prepare a worktree. Closed PRs retain this workflow.
Test PRs may be created only in the Test Rig origin repository, from isolated test
branches, with synthetic content and no unrelated local commits. No feature PR or
main push is part of this implementation.
