# Workspace and panel UX parity audit

Compared Test Rig `2cd9bf400cefedd19206b09ff4f8d880a176d915` in `/Users/smills/REPOS/test-rig` with published nightly `.20261006.2735`, source `fd1c3386c`, in `/private/tmp/t3-upstream-audit-20261006/nightly`. Read AGENTS.md and FORK.md. This is a source audit and narrow baseline-test pass; the primary agent owns live testing. No app, server, provider, production state, or Linear mutation was performed here.

Paths below are relative to the corresponding checkout. Deliberate Test Rig features (rich drafts, explicit PR association, Review scopes/staging, Side chat, removed checkpoint restore) are preserved in recommendations.

## High-confidence actionable differences

### W0 — P1: macOS desktop build is blocked by case-insensitive settings module resolution

**Live evidence from primary agent:** Original-checkout `dev:desktop` build failed with missing ProjectSettingsScope/useProjectSettingsScope exports. The primary agent changed the two component imports to explicit `./ProjectSettingsScope.tsx` only in disposable `/private/tmp/testrig-live-parity-86ipk174/source` to continue the audit, without changing original source.

**Independent owning-source/filesystem proof:** `settings/BranchNamingSettings.tsx:8` and `settings/SourceControlWritingSettings.tsx:2` import extensionless `./ProjectSettingsScope`. Two modules differ only by base-name case and suffix: component `ProjectSettingsScope.tsx` and pure helper `projectSettingsScope.ts`. On this macOS filesystem `fs.stat('ProjectSettingsScope.ts')` and `fs.stat('projectSettingsScope.ts')` return the same inode **14512642** (helper), while `ProjectSettingsScope.tsx` is inode **14512634** (component). The helper lacks both component exports; the `.tsx` file exports ProjectSettingsScope at line 96 and useProjectSettingsScope at line 167. Extensionless `.ts` resolution therefore selects the helper before reaching `.tsx`. `BranchNamingSettings.test.tsx:16` mocks the ambiguous specifier, so its passing tests do not prove real build linkage.

**Minimal durable correction:** Rename the pure helper to `projectSettingsScope.logic.ts`, updating its imports in `ProjectSettingsScope.tsx:28` and `projectSettingsScope.test.ts:11`. Keep component name and extensionless component consumer imports. Explicit `.tsx` imports are a valid short unblock, but leave this misleading same-base-name collision available to future imports. Avoid resolver-order configuration changes: they would affect unrelated modules and do not remove the collision.

**Validation:** Targeted web build on supported macOS filesystem, helper test plus BranchNamingSettings test, and a real unmocked component resolution/export check. This outranks visual parity findings because the primary desktop surface cannot launch. **Confidence: confirmed live blocker plus independently verified filesystem mechanism.**

### W1 — “New project” does not create a new project from a name

**User transition:** Sidebar “New project” or draft hero “New project” opens the existing Add project source chooser. Test Rig offers “Local folder”, “Git URL”, and enabled source-host clone paths. Nightly also has a real “New project” flow: type a name, see its directory preview, create local folder/README/icon/Git repository and first commit, optionally publish a private GitHub repository, and land in a draft.

**Evidence:** Test Rig `components/chat/DraftHeroHeadline.tsx:130,257`, `components/SidebarV2.tsx:3047`, `components/CommandPalette.tsx:1205,1537`. Nightly `components/CommandPalette.tsx:871,1612–1630,2052,2527,2822,3465`, `hooks/useNewProject.ts:24–32,95–166`. Test Rig has no `useNewProject`, project createNew operation, or newProjectsRoot owning contract/server path (search across apps/web, apps/server, packages/contracts).

**Expected correction:** Port the local create-from-name vertical flow and truthful naming. Optional publish must remain explicit and respect source-host toggles. No automatic network publish is implied.

**Live proof:** Open both sidebar plus and command palette. Type an unused name without supplying a path. Nightly should show where it goes and create it; Test Rig currently has no equivalent name step. Also verify a failure leaves the name and destination reviewable/retryable. **Confidence: high.**

### W2 — New-draft/default transitions do not apply resolved project defaults

**User transition:** Set project B's default model/runtime/workspace mode differently from global sticky settings or the currently viewed project A, then create a B draft or change a draft target A → B. Nightly resolves target environment + project overrides (and t3.json workspace fallback), applies project defaults over sticky state, and retains an explicitly chosen composer model when retargeting. Test Rig's new-thread handler reads primaryServerSettings.defaultThreadEnvMode/newWorktreesStartFromOrigin, applies sticky state, then only carries the previous selection. Its hero retarget changes workspace context without refreshing the model/default snapshot. Test Rig also lacks the `modelSelectionExplicit` tracking used by nightly to distinguish a deliberate pick from an automatic default.

**Evidence:** Test Rig `hooks/useHandleNewThread.ts:273–304`, `components/chat/DraftHeroHeadline.tsx:109–127`, `composerDraftStore.ts:2303–2364` (retarget mutates thread context only), `composerDraftStore.ts:2565` (sticky state separately owns model map). Nightly `hooks/useHandleNewThread.ts:127–163,403–426`, `components/chat/DraftHeroHeadline.tsx:209–242`, `lib/chatThreadActions.ts:59–69`. Test Rig ChatView builds a local thread from project default (`ChatView.tsx:1412–1420`), so with _no sticky selection_ some defaults can appear correct; the sticky/default and explicit-pick cases expose the difference.

**Expected correction:** Use the resolved target-project settings at draft creation and retargeting, track explicit model selection, retain prompt/attachments/rich content, and preserve the existing terminal workspace lock. Do not indiscriminately overwrite a user-picked model.

**Live proof:** Use project A/B with different model/runtime/workspace defaults; create new B from A, switch a blank untouched draft to B, and repeat after a manual model selection. Include a target with project overrides. **Confidence: high source asymmetry, visible outcomes require live confirmation.**

### W3 — Files cannot browse ignored/large trees despite a partial contract port

**User transition:** Open Files, expand an ignored/generated folder, or search for a path outside the first indexed 25,000 entries. Nightly lazily loads immediate actual filesystem children per directory and uses server search for the query. Test Rig loads a bounded recursive indexed list and filters that list locally. Its optional `directoryPath` contract field is present, but the owning server ignores it; this is not merely an unwired UI feature. The tree does not show the list's `truncated` flag.

**Evidence:** Test Rig `components/files/FileBrowserPanel.tsx:115–127`, `components/files/projectFilesQueryState.ts:32–34,124–138`, `packages/contracts/src/project.ts:283–293`, `apps/server/src/workspace/WorkspaceEntries.ts:275–288` (unconditional index.list), `WorkspaceSearchIndex.ts:27,429–442` (25,000 cap). Nightly `components/files/FileBrowserPanel.tsx:111–137`, `components/files/useDirectoryEntries.ts:9–88` (directoryPath request, bounded four concurrent requests), `components/files/FileBrowserPanel.tsx:535–545` (search truncation hint).

**Expected correction:** Complete the per-directory server behavior and lazy client tree as a coherent port, keep server path search, and display truncation/retry state. Preserve Test Rig mention drags and editable file surfaces.

**Live proof:** In a disposable repo with an ignored generated directory, find/open an actual file inside it. Repeat a search for a known deep path in a tree >25,000 entries. Verify refreshing a previously loaded directory preserves expansion/selection. **Confidence: high.**

### W4 — Open Files and Review lag until a turn finishes

**User transition:** Keep Files or Review open while an agent tool modifies files during a long turn, or while a terminal changes files with the application continuously focused. Nightly feeds workspaceMutationId into tree/file/diff refresh. Test Rig refreshes editable file/tree on `useOnTurnCompleted`; Review has completed-turn and window-focus refresh. There is no equivalent mutation hook. Images are excluded from Test Rig's file.refresh path and lack nightly's workspace-revision URL, so rewriting an already-open image may stay stale even after a completed turn.

**Evidence:** Test Rig `components/files/FilePreviewPanel.tsx:135–169,772–779`, `components/DiffPanel.tsx:768–780`; nightly `hooks/useWorkspaceMutationRefresh.ts:10–34`, `components/files/FilePreviewPanel.tsx:140–142,1050,1311`, `components/files/FileBrowserPanel.tsx` mutation hook and `components/DiffPanel.tsx` mutation hook.

**Expected correction:** Refresh once per workspace mutation and active resource; postpone refresh while local editable saves are pending, then catch up. Invalidate media revision without discarding local edits or scroll position.

**Live proof:** Open a text file and Review before a long-running agent turn; modify the file then continue work in that turn. Changes should appear before completion. Repeat an image overwrite. Repeat terminal modification; confirm expected workspace events before claiming every external write must update. **Confidence: high for missing mutation handling; medium for precise image cache outcome.**

### W5 — Files error/retry and media/table states are missing

**User transition:** Open audio/video/CSV/TSV in Files, or recover from a failed directory request. Nightly supplies audio/video players and a rendered CSV/TSV table/source toggle; Test Rig classifies only images specially, otherwise tries text/Markdown/browser-document handling. Nightly tree errors remain visible and clickable (“Click to retry”); Test Rig renders an error only when entries data is null, hides refresh failures with stale data, and offers no inline retry action.

**Evidence:** Test Rig `components/files/FilePreviewPanel.tsx:772,747–1066` and `FileBrowserPanel.tsx:420` initial-data-only error branch. Nightly `FilePreviewPanel.tsx:233,287,940–943,986,1199–1226,1261–1270`, `FileBrowserPanel.tsx:523–545`.

**Expected correction:** Add native media/table surfaces and corresponding source toggle, and retain error with cached data plus retry. Rendered CSV/TSV should not interfere with line-reveal/source mode. **Confidence: high.**

### W6 — Right-panel launcher loses keyboard access and Review naming consistency

**User transition:** With empty right panel visible and focus outside a typing field, nightly letter shortcuts B/T/F/D open Browser/Terminal/Files/Diff; arrow/Enter navigation also works. Test Rig presents clickable rows without that launcher behavior. Test Rig empty state calls its adapted diff surface “Review”, while the add-surface menu still calls it “Diff”. Existing global diff.toggle is separate from the launcher shortcuts.

**Evidence:** Test Rig `components/RightPanelTabs.tsx:101–209,493–498`; nightly `RightPanelTabs.tsx:246–270,315–443,895`. Review launcher label Test Rig line 143; + menu “Diff” line 497.

**Expected correction:** Restore accessible keyboard launcher behavior with typing/dialog guards and use the Test Rig “Review” name consistently. Keep Agents/Side chat and explicit PR entries.

**Live proof:** Open empty panel, blur composer, press F; repeat with focus in a composer (letter must type). Open + menu and compare Review name. **Confidence: high.**

### W7 — Panel tab overflow has fewer navigation affordances

**User transition:** Open many file/browser/terminal surfaces on a narrow window. Nightly supplies explicit “Scroll tabs left”/“Scroll tabs right” controls and maps vertical wheel deltas onto horizontal overflow. Test Rig has only ScrollArea, with no overflow buttons or wheel mapping. Test Rig **does** scroll an active tab into view (`RightPanelTabs.tsx:378–380`); this is not a missing active-tab-reveal finding.

**Evidence:** Nightly `RightPanelTabs.tsx:798,1013–1054,1306–1346`; Test Rig `RightPanelTabs.tsx:378–403` and full component lacks corresponding handlers/controls.

**Expected correction:** Port overflow navigation around Test Rig's surfaces. **Live proof:** Open 8+ tabs and verify rightmost tab/+ remain discoverable using a normal mouse wheel and buttons; repeat browser tab close/close others/to right/all. **Confidence: high source difference.**

### W8 — Browser profile and tab audio UI are absent

**User transition:** Add Browser in a named cookie profile or mute a sounding tab. Nightly +Browser menu exposes profile submenu, preview requests carry profileId, and tab context menu/icon supports Mute tab/Unmute tab. Test Rig only calls onAddBrowser and has no matching profile/audio lifecycle/contract. Browser import/profile capabilities therefore require a vertical port rather than showing a button over nonexistent runtime.

**Evidence:** Test Rig `RightPanelTabs.tsx:102–120,462–472`, `apps/desktop/src/preview/Manager.ts` has no profile/audio method, `apps/web/src/browser/browserDefaults.ts` absent. Nightly `RightPanelTabs.tsx:119,219–229,933,1129–1161,1239–1288`, `browser/browserDefaults.ts:39–63`, `packages/contracts/src/preview.ts:205,229,290`.

**Expected correction:** Port named browser profile/cookie partition and audio overlay/IPC support with launcher/context affordances. Test Rig identity/partition isolation remains mandatory. **Live proof:** Desktop only: two profiles with separate login/cookies; play sound then mute/unmute tab; web unavailable reason remains truthful. **Confidence: high.**

### W9 — Blank terminal right click lacks Paste; terminal close lacks confirmation

**User transition:** Right-click blank terminal space and choose Paste. Nightly explicitly offers Paste through terminal clipboard/write protocol, since a canvas is not an editable browser target. Test Rig returns from handleContextMenu without an action when there is no selection/link; selected menu has only Add to chat/Copy. Closing via drawer ×/menu currently invokes onCloseTerminal directly rather than nightly's confirmation (so long-running processes can close immediately).

**Evidence:** Test Rig `ThreadTerminalDrawer.tsx:528–537,718–744,1374,1509,1579`; nightly `ThreadTerminalDrawer.tsx:266–281,621–691,1280–1286`. Test Rig source tree has no confirmTerminalClose helper. Existing keyboard paste is a separate path and not claimed broken.

**Expected correction:** Port terminal-owned Paste context action and consistent close confirmation across drawer, right-panel tab, keybinding/menus, without duplicating accelerator paste. **Live proof:** Desktop and web blank terminal context menu, selected context menu, clipboard paste exactly once, Cancel-close leaves subprocess/terminal intact, confirm-close closes intended terminal. **Confidence: high.**

### W10 — Details panel has no shortcut or adaptive density

**User transition:** Toggle thread details with a keybinding or keep it readable on short/narrow windows/mini-player overlap. Nightly has threadPanel.toggle in the shared keybinding contract and key handler, stores presentation-specific visibility, and progressively folds full → compact → essential controls. Test Rig has a portal-mounted mouse toggle, separate hiddenByThread store for inline visibility, ephemeral popoverOpen, and renders all rows inside a scroll viewport without density folding. The resized details-card layout _itself_ is tested and appears deliberate, so overlap bugs require live proof rather than inference.

**Evidence:** Test Rig `components/chat/ThreadDetailsCard.tsx:40–46,97–127`, `ThreadDetailsPanel.tsx:61–130`, `components/chat/PanelLayoutControls.tsx:9–19`; nightly `packages/contracts/src/keybindings.ts:69`, `ChatView.tsx:7881,10872`, `ThreadDetailsCard.tsx:17–26,55–95,137`, `ThreadDetailsPanel.tsx:115–238`.

**Expected correction:** Preserve existing persistent controls tree, add shared toggle command/label, and decide parity presentation/visibility behavior explicitly. Adaptive density should preserve access to controls via popover. **Live proof:** Details toggle keyboard/palette entry, same thread navigation/remount, width/height shrinking and browser mini-player overlap, returning to wider layout. **Confidence: high for missing command/density, medium for visibility UX consequences.**

### W11 — Desktop View zoom targets the browser guest when it is focused

**User transition:** Focus embedded Browser, use native View → Zoom In/Out/Actual Size. Test Rig uses Electron zoom roles that operate on focused webContents; nightly routes zoomMain so main application UI still zooms when an embedded guest has focus. Test Rig also retains only native editMenu, omitting nightly's explicit “Paste as Text” menu path.

**Evidence:** Test Rig `apps/desktop/src/window/DesktopApplicationMenu.ts:113–128`; nightly same file `54–59,132–152,212–215,235–253` (comment explains focused guest role issue). Test Rig has no zoomMain or paste-as-text owning path.

**Expected correction:** Own main-window zoom and route native menu Paste as Text without duplicate accelerator paste; keep Test Rig's excluded update menu/feed absent. **Live proof:** Focus Browser then native View menu zoom; main UI should resize. Native Edit menu Paste as Text into rich draft should insert plain content exactly once. **Confidence: high source defect mechanism; live check needed.**

## Preserved or separately scoped behavior

- WorktreeSetupCard is essentially identical to nightly, aside from icon/motion style: stages, Details, Open terminal, Work locally, Cancel remain. Test Rig's work-locally implementation intentionally retains failed run history and resends in same durable thread (`ChatView.tsx:2181–2248,2689–2742`); nightly returns to a draft. This is not classified as a defect without live evidence. Check first-send preparation, cancel/local recovery, asynchronous setup, and stale-owner navigation once in primary live pass.
- Test Rig scratch drafts add terminal-safe retarget lock/retry (`hooks/useScratchDraftWorkspace.ts`, `DraftHeroHeadline.tsx:52–69`, `ChatView.tsx:6208–6240`). Preserve it when porting defaults; it protects existing running terminals. Test Retry after filesystem failure and terminal close before project retarget.
- Branch naming supports project scope, static/semantic/custom modes, inheritance/reset and edited-field save-on-blur (`settings/BranchNamingSettings.tsx:15–169`). Focused tests pass. No new source defect isolated here.
- Test Rig Review intentionally has Working tree/Unstaged/Staged/Branch/Commit + turn scopes, staging actions, changed-file navigation, and resize; richer scope is retained, not counted as asymmetry. W4/W6 are transition/access gaps around that surface.
- Desktop native Settings and shared renderer entry remain. Updater/cloud/device absences are not automatically gaps under FORK.md. Device surface was not included as an actionable local parity finding without a boundary decision.

## Verification and limitations

`./node_modules/.bin/vp test run apps/web/src/hooks/useScratchDraftWorkspace.test.ts apps/web/src/components/chat/threadDetailsCardLayout.test.ts apps/web/src/components/settings/BranchNamingSettings.test.tsx apps/web/src/rightPanelStore.test.ts` passed **45 tests in 4 files**, duration 840ms. `vp` was absent from PATH, local binary used. No repository-wide checks and no generated tests/production edits.

These findings use current owning source, not memory or previous Git bug reports. They identify missing nightly UX or concrete stale/default/desktop mechanisms. They are not substitutes for the primary live screenshots and provider-turn outcomes. Specifically confirm actual defaults behavior, media cache updates, terminal close paths, details clipping/visibility, and desktop zoom before describing them as live failures.

Latest comparator update: `.2752` (`d8d037eae1b77a77f372fd1afd2662a31ebe37c8`) was published during the live pass. Exact new-source findings and verified official app artifact are in `/private/tmp/testrig-live-parity-nightly-2752-delta.md`; W0–W11 are not superseded. Primary confirmed ignored generated folder omission (W3) and CSV raw-vs-table behavior (W5) against .2735. Primary's terminal-created file did not autoappear in either tree until manual refresh: W4 remains narrowly source-only mutation-refresh handling, not proof either nightly instantly detects arbitrary terminal writes.
