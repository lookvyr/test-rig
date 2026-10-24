# October 24 search, approval feedback, and compaction follow-up

This follow-up adapts three upstream changes to Test Rig's retained web/desktop
and provider boundaries. It completes the deferred items from the
[earlier intake](./upstream-intake-2026-10-24.md).

## Indexed message search

Upstream [#24343](https://github.com/pingdotgg/t3code/pull/24343) supplies the
indexed-search design. Migration 046 adds a contentless SQLite FTS5 trigram index
with backfill and insert/update/delete triggers. Completed user-authored messages
and assistant text are eligible; temporary side chats, subagents, and generated
notices stay out. Offline database maintenance rebuilds the rowid-based index
after VACUUM. Unsupported SQLite builds use a bounded scan fallback.

Cmd+K keeps Test Rig's existing title ranking, action mode, file picker, and
project-content search. Message matches appear separately under **In messages**,
with multiword proximity ranking, excerpts, and a Find jump to the matched
message. Threads already listed above are deduplicated by environment and thread
identity. Upstream's remembered selections and opening-frequency ranking are
outside this adaptation.

## Claude approval feedback

Upstream [#23657](https://github.com/pingdotgg/t3code/pull/23657) routes feedback
through the original approval response and Claude callback. Only a pending
request advertising feedback support accepts nonempty text with a decline.
Feedback is recorded in conversation history without dispatching a new parent
turn; other approvals remain pending.

Test Rig's ordinary composer is disabled during approvals. A request-keyed text
field in the shared approval panel provides the response without consuming the
normal draft, attachments, or context. Main and side-chat composers share it.
Codex and OpenCode retain their existing approval behavior.

## Compaction presentation

Upstream [#24334](https://github.com/pingdotgg/t3code/pull/24334) replaces duplicate
prompt/working/divider rows with one compaction status. Optional reasons travel
with the dispatched message and user item. The Claude adapter tracks one item
through its lifecycle, retains failure details, and omits synthetic command
echoes. Provider-initiated mid-turn compactions retain their own divider.

Test Rig has no upstream completion-notification dispatcher, so unused silent-run
flags and notification plumbing were omitted. This change does not alter unread
or attention state. The fork also has no compact-on-return message queue; no
interactive queue was added. Compatible on-return metadata is recognized for
presentation, including answered Claude resume questions.

## Verification

Separate agents reviewed search and each Claude behavior for correctness and
simplification. Focused tests cover index backfill/synchronization/maintenance,
message matching and navigation, approval ownership and draft preservation, and
compaction lifecycle and timeline states. No repository-wide checks were run.

The primary agent used an isolated running app to verify:

- A real native Claude child received denial feedback through its pending Bash
  approval, acknowledged it, and did not create the requested probe file. The
  parent continued its existing run; its ordinary unsent draft survived.
- Real manual Claude compactions showed one live divider and then token-count
  results, with no extra command bubble or synthetic assistant reply.
- Synthetic automatic-success and failure fixtures displayed the reasoned
  completion divider and visible failure reason, respectively.
- Multiword and accent-insensitive searches found an older message in a
  42-turn synthetic history. Selection loaded that message and opened Find;
  Escape closed Find. Action-only search, file search, and project-content
  search retained their separate entry points.
- A duplicate thread appearing in both result sections was fixed and retested.
- A multiword substring result opened Find at the rendered identifier in the
  historical message after the review fix; accented words likewise opened with
  their original spelling.

The fixtures test UI presentation, not real automatic-compaction timer behavior.
Dispatch and lifecycle semantics have deterministic service/adapter tests.
All three reviews finished without remaining findings. Scoped web, desktop,
contracts, client-runtime, and shared typechecks passed. Server typechecking
reports only the four pre-existing diagnostics in unchanged `AppMcpOAuth.ts`
and `AppMcpOAuth.test.ts`.

The web app exercises the shared desktop renderer; this batch changes no desktop
shell code. Real remote connections, a packaged desktop build, and the idle timer
waiting for a real 200,000-token Claude session were not exercised. Environment
identity, exact approval ownership, index maintenance, and idle dispatch have
focused automated coverage.
