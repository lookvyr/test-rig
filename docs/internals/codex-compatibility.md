# Maintaining Codex compatibility

The minimum supported Codex CLI is **0.156.0**; the last tested CLI is **0.156.1**.
The minimum reflects the history and `thread/revert` protocol used by Test Rig. It is not a
promise that all later versions will work. Newer versions are allowed without a warning merely
because they are newer. Unknown version strings retain ready status with explanatory guidance;
older versions report an error through the existing provider status surface. Authentication
errors take precedence.

This policy is local. Provider checks do not fetch a compatibility manifest or query a registry.
Keep provider-specific compatibility work in the Codex adapter, runtime, or protocol package.

## Updating the protocol

1. Choose an explicit Codex release and resolve its immutable source commit. Update
   `UPSTREAM_REF` and its release comment in
   `packages/effect-codex-app-server/scripts/generate.ts`.
2. Run `node_modules/.bin/vp run --filter effect-codex-app-server generate`. Generation explicitly
   downloads schemas from the pinned Codex source. Review method additions/removals, optional
   parameters, enum values, and fields that affect behavior. Do not edit generated files manually.
3. Adapt runtime calls and notification/request handling. Schema decoding alone does not prove
   Test Rig acts on a new field. Check provider events, orchestration, and main/side chat consumers.
4. Run focused protocol, Codex runtime, adapter, and provider tests, plus package-scoped typechecks
   for changed packages. Add a regression for each incompatible behavior discovered.
5. Run the checks below with the actual target CLI before updating the last-tested version here
   and in `docs/user/providers-codex.md`. Change the minimum only when the implementation requires
   a newer protocol, including `MINIMUM_CODEX_VERSION` in `CodexProvider.ts` and its focused tests.

## Focused maintenance checks

Use an isolated Test Rig home and a disposable repository via the `test-t3-app` skill. Never start
a test server against the live application database. Record the CLI version, generated source
commit, commands run, and any behavior the installed model could not exercise.

From the repository root, run the isolated CLI smoke probe:

```bash
node_modules/.bin/vp run --filter effect-codex-app-server probe
node_modules/.bin/vp run --filter effect-codex-app-server probe --run-turns
```

The first command checks initialization and model discovery. The second explicitly adds two
model turns, streamed text/tools, paginated history, revert, and resume. It uses a temporary
Codex home and workspace, copying `auth.json` from `CODEX_HOME` (or the default Codex home).
For keychain-only authentication, supply a source Codex home containing `auth.json`; the probe
does not read the keychain or copy user configuration and integrations.
Set `CODEX_BIN` or `CODEX_MODEL` to check a particular executable or model. Model turns use the
configured provider account. Neither command replaces the question and multi-agent checks below.

| Surface                  | Evidence to collect                                                                                                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schemas                  | Decode representative history and notification payloads, multi-agent tool/status enums, and optional request parameters. Check local diagnostics on malformed payloads.                   |
| Start/resume             | Start a thread, stream a turn with a tool, stop and resume its session, then complete another turn. Confirm model discovery and authentication still work.                                |
| History/revert           | Read a history spanning multiple pages. Edit an earlier turn, verify the correct boundary is retained, and continue. Preserve a useful error for legacy history that Codex cannot revert. |
| Blocking questions       | Answer and cancel questions in main and side chat; confirm Stop remains available and drafts survive cancellation.                                                                        |
| Nonblocking questions    | Verify work and composer input remain available while a question is pending, answers reach Codex, and cancellation/expiry clears it. Exercise both question mechanisms when available.    |
| Multi-agent interruption | Decode and display collaboration activity including follow-up, messages, and interruption. Interrupt a child task and confirm history/resume still decode.                                |

The shared renderer covers web and desktop UI. Add a desktop smoke check when changing shell or
IPC behavior. Deterministic protocol/runtime tests should cover model-dependent cases that cannot
be reliably requested from a live agent; record that limitation instead of treating startup as
complete compatibility proof.
