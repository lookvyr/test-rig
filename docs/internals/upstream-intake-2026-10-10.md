# October 10 upstream reliability and interaction intake

Adapted five upstream improvements on `codex/orchestration-v2`, starting from
`1ba9963ca2143f5c4f29e402ce26b2b1414d61b4`. The local checkout was clean and
GitHub reported the same branch head before edits. The October 9 intake remains
intact; no upstream package reorganization or observer migration was imported.

| Upstream                                                 | Size | Outcome                                                                                                                                                                                                                                                             |
| -------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#17344](https://github.com/pingdotgg/t3code/pull/17344) | S    | Adapted to `pullRequest/gitHubPullRequestJson.ts`. Pending duplicate check runs outrank completed runs in either input order, including queued runs without a start time. Once all finish, newest completion still wins.                                            |
| [#17181](https://github.com/pingdotgg/t3code/pull/17181) | M    | Ported worker fairness: return a dirty key to the queue tail atomically after each batch, on success or failure. Pending writes continue coalescing and drain waits for the final batch.                                                                            |
| [#17843](https://github.com/pingdotgg/t3code/pull/17843) | M    | Added optional project scoping to SQL and memory shell snapshots; project thread listing requests active rows directly. Ancestors still load by ID regardless of project/archive state. Snapshot decoding stays outside the read transaction.                       |
| [#17637](https://github.com/pingdotgg/t3code/pull/17637) | M    | Adapted the typing guard to the rich composer, main chat and temporary side chats. Only actual edits reset the idle timer. Send retains steering semantics, including pointer submission during a hold; no interactive message queue was added.                     |
| [#17659](https://github.com/pingdotgg/t3code/pull/17659) | M    | Adapted to the existing pointer/animation-frame handler. Drag frames update only sidebar gap/container widths; the wrapper variable commits on release. Cancellation and window resizing restore bounded widths. Existing ChatCanvas `flushSync` remains unchanged. |

No item required a product-boundary change. Local-first state, provider adapters,
Review, temporary side-chat ownership, and recursive Stop behavior are retained.
The upstream CI deduplication limitation remains: a pending duplicate can hide a
failed duplicate until all finish; independently identifying workflow events
would require a separate change to GitHub run identity.

## Verification

macOS, Node 24.18.1, shared web renderer:

- 398 focused tests passed across 23 files: 265 backend/projection/terminal/watch
  and lifecycle tests, 28 MCP service/toolkit tests, 101 web tests, and 4 worker
  tests. These include drain/latest-write and terminal shutdown/clear/restart,
  SQL/memory project isolation with archived cross-project fork ancestry,
  decode-outside-transaction regressions, and typing-guard timer/scope cleanup.
- Typechecks passed for server, web, and shared packages. Scoped lint has no
  errors (existing-file warnings remain). Formatting and diff whitespace checks
  pass. No repository-wide checks were run.
- A separate simplification/correctness review found two edge cases: cursor-only
  changes resetting the typing timer, and cancelling a drag after narrowing the
  window restoring an oversized baseline. Both were fixed and re-reviewed.
- Real Codex nonblocking questions retained their independent answer controls.
  Real Claude blocking questions remained held during continuous typing, appeared
  after idle, and restored the draft after selection. Pointer Send during a hold
  produced a steering message and left the question unanswered. Stop cleared a
  pending question. A supervised Claude file-write approval was held during
  typing, then approved successfully with the draft restored.
- Two temporary side chats coexisted with the main chat. A repeated blocking
  question in a side chat was confirmed hidden during typing and visible
  immediately after focus moved to the main composer.
- Browser measurement during a 256px-to-431px drag showed the wrapper variable
  stayed at 256px while only gap/container widths changed. Releasing committed
  the width. Narrowing to 900px and collapsing mid-drag restored a bounded 260px
  width and removed temporary styles. Repeated drags preserved Review diffs,
  multiline drafts, terminal input/output and an interactive local preview.
  The 760px layout retained the draft and terminal without document overflow.
- Browser console: no errors; two Legend List estimated-item-size performance
  warnings appeared during conversation activity. They were not a correctness
  failure and the list implementation was not changed.

The local 27-second demo is an annotated, sampled screen recording of the actual
app. It shows question hold/release, restored drafts, steering, resize behavior,
side-chat blur release, Review/terminal, preview interaction and the narrow view.
It is saved with the task deliverables, not committed as a binary source asset.

Not verified: packaged/native Electron, Windows, Linux, remote/tunnel connections,
OpenCode live provider execution, or an extended persistence/performance soak.
Upstream benchmark figures are not TestRig measurements. The fork deliberately
excludes inherited CI workflows; remote check availability is verified after push.
