import { DiffFilePathCopyButton } from "./DiffFilePathCopyButton";
import GitActionsControl from "./GitActionsControl";
import { useSourceControlActionRunning } from "~/lib/sourceControlActions";
import { ReviewFileNavigator, type ReviewFile } from "./diffs/ReviewFileNavigator";
import { sortReviewFiles, resolveReviewFilePath } from "./diffs/reviewFileTree";
import { useAtomValue } from "@effect/atom-react";
import type { FileDiffContentsLoader } from "@pierre/diffs";
import { useParams } from "@tanstack/react-router";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { safeErrorLogAttributes } from "@t3tools/client-runtime/errors";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ReviewDiffPreviewSourceKind, ScopedThreadRef, TurnId } from "@t3tools/contracts";
import {
  ArrowRightIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  PanelRightIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  Columns2Icon,
  PilcrowIcon,
  RefreshCwIcon,
  Rows3Icon,
  SearchIcon,
  TextWrapIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOpenInPreferredEditor } from "../editorPreferences";
import { type DraftId } from "../composerDraftStore";
import { openDiffFilePrimaryAction } from "../diffFileActions";
import { useCheckpointDiff } from "~/lib/checkpointDiffState";
import { cn } from "~/lib/utils";
import {
  selectThreadDiffPanelSelection,
  useDiffPanelStore,
  type GitReviewScope,
} from "../diffPanelStore";
import { useOnTurnCompleted } from "../hooks/useOnTurnCompleted";
import { useTheme } from "../hooks/useTheme";
import {
  buildFileDiffContentVersion,
  buildFileDiffIdentityKey,
  getDiffCollapseIconClassName,
  getDiffLineStat,
  getRenderablePatch,
  resolveDiffThemeName,
  resolveFileDiffPath,
  DIFF_SURFACE_THEME_UNSAFE_CSS,
} from "../lib/diffRendering";
import { areAllDiffFilesCollapsed, toggleAllDiffFiles } from "../lib/diffCollapse";
import { useTurnDiffSummaries } from "../hooks/useTurnDiffSummaries";
import { useProject, useThread } from "../state/entities";
import { resolveThreadRouteRef } from "../threadRoutes";
import { useClientSettings } from "../hooks/useSettings";
import { formatShortTimestamp } from "../timestampFormat";
import { DiffPanelLoadingState, DiffPanelShell, type DiffPanelMode } from "./DiffPanelShell";
import { DiffStatLabel } from "./chat/DiffStatLabel";
import { AnnotatableCodeView, type AnnotatableCodeViewHandle } from "./diffs/AnnotatableCodeView";
import { Button } from "./ui/button";
import { ToggleGroup, Toggle } from "./ui/toggle-group";
import { Switch } from "./ui/switch";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxTrigger,
} from "./ui/combobox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import { serverEnvironment } from "../state/server";
import { reviewEnvironment } from "../state/review";
import { vcsEnvironment } from "../state/vcs";
import { buildBaseRefChoices, filterBaseRefChoices } from "../lib/baseRefChoices";

type DiffThemeType = "light" | "dark";
const AUTOMATIC_BASE_REF = "__automatic_base_ref__";

interface CollapsedDiffFilesState {
  readonly scopeKey: string | null;
  readonly fileKeys: ReadonlySet<string>;
}

const EMPTY_COLLAPSED_DIFF_FILE_KEYS: ReadonlySet<string> = new Set();

const DIFF_PANEL_UNSAFE_CSS = `${DIFF_SURFACE_THEME_UNSAFE_CSS}
:is(
  [data-line],
  [data-line-annotation],
  [data-merge-conflict],
  [data-merge-conflict-actions],
  [data-no-newline]
)[data-selected-line] {
  --diffs-line-bg: light-dark(
    color-mix(
      in lab,
      var(--code-background) 88%,
      color-mix(in srgb, var(--code-background) 50%, var(--diffs-modified-base))
    ),
    color-mix(
      in lab,
      var(--code-background) 80%,
      color-mix(in srgb, var(--code-background) 70%, var(--diffs-modified-base))
    )
  ) !important;
}

:is([data-gutter-buffer], [data-column-number])[data-selected-line] {
  --diffs-line-bg: light-dark(
    color-mix(
      in lab,
      var(--code-background) 91%,
      color-mix(in srgb, var(--code-background) 35%, var(--diffs-modified-base))
    ),
    color-mix(
      in lab,
      var(--code-background) 85%,
      color-mix(in srgb, var(--code-background) 60%, var(--diffs-modified-base))
    )
  ) !important;
}

[data-indicators="bars"]
  :is([data-column-number], [data-gutter-buffer="annotation"])[data-selected-line] {
  position: relative;
}

[data-indicators="bars"]
  :is([data-column-number], [data-gutter-buffer="annotation"])[data-selected-line]::before {
  position: absolute !important;
  inset-block: 0 !important;
  inset-inline-start: 0 !important;
  display: block !important;
  width: 4px !important;
  min-width: 4px !important;
  max-width: 4px !important;
  height: auto !important;
  padding: 0 !important;
  content: "" !important;
  background-color: var(--diffs-modified-base) !important;
  background-image: none !important;
}

[data-file-info] {
  background-color: var(--code-background) !important;
  border-block-color: transparent !important;
  color: var(--code-foreground) !important;
}

[data-diffs-header] {
  position: sticky !important;
  top: 0;
  z-index: 4;
  background-color: var(--code-background) !important;
  border-bottom-color: transparent !important;
  align-items: center !important;
  font-family: var(--font-sans) !important;
  font-size: 12px !important;
  line-height: 1 !important;
  min-height: 32px !important;
  padding-block: 6px !important;
  padding-inline: 8px 12px !important;
}

[data-diffs-header]:hover {
  background-color: color-mix(in srgb, var(--code-background) 97%, var(--code-foreground)) !important;
}

:is([data-separator="line-info"], [data-separator="line-info-basic"]) {
  height: 24px !important;
  margin-block: 0 !important;
  background-color: var(--code-background) !important;
}

:is([data-separator="line-info"], [data-separator="line-info-basic"])
  [data-separator-wrapper] {
  padding-inline: 8px 12px !important;
  background-color: transparent !important;
}

:is([data-separator="line-info"], [data-separator="line-info-basic"])
  [data-separator-content] {
  gap: 8px;
  padding-inline: 0 !important;
  background-color: transparent !important;
  color: color-mix(in srgb, var(--code-foreground) 52%, var(--code-background)) !important;
  font-family: var(--font-sans) !important;
  font-size: 11px !important;
  text-decoration: none !important;
}

:is([data-separator="line-info"], [data-separator="line-info-basic"])
  [data-unmodified-lines] {
  display: flex !important;
  min-width: 0;
  flex: 1 1 auto;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

:is([data-separator="line-info"], [data-separator="line-info-basic"])
  [data-unmodified-lines]::before,
:is([data-separator="line-info"], [data-separator="line-info-basic"])
  [data-unmodified-lines]::after {
  width: auto;
  height: 1px;
  flex: 1 1 auto;
  content: "";
  background-color: color-mix(in srgb, var(--code-background) 92%, var(--code-foreground));
}

:is([data-separator="line-info"], [data-separator="line-info-basic"])[data-expand-index]
  [data-separator-wrapper] {
  grid-template-columns: 0 minmax(0, 1fr) !important;
}

:is([data-separator="line-info"], [data-separator="line-info-basic"])[data-expand-index]
  [data-separator-content] {
  grid-column: 2 !important;
}

:is([data-separator="line-info"], [data-separator="line-info-basic"])
  [data-expand-button] {
  display: none !important;
}

:is([data-separator="line-info"], [data-separator="line-info-basic"]):has(
    [data-expand-button]
  )
  [data-separator-content] {
  cursor: pointer;
}

:is([data-separator="line-info"], [data-separator="line-info-basic"]):has(
    [data-expand-button]
  ):hover
  [data-separator-content] {
  color: color-mix(in srgb, var(--code-foreground) 76%, var(--code-background)) !important;
}

:is([data-separator="line-info"], [data-separator="line-info-basic"]):has(
    [data-expand-button]
  ):hover
  [data-unmodified-lines]::before,
:is([data-separator="line-info"], [data-separator="line-info-basic"]):has(
    [data-expand-button]
  ):hover
  [data-unmodified-lines]::after {
  background-color: color-mix(in srgb, var(--code-background) 84%, var(--code-foreground));
}

[data-diffs-header] [data-header-content] {
  align-items: center !important;
  line-height: 1 !important;
}

[data-diffs-header] [data-metadata] {
  align-items: center !important;
  line-height: 1 !important;
  font-variant-numeric: tabular-nums;
}

[data-diffs-header] [data-additions-count],
[data-diffs-header] [data-deletions-count] {
  font-family: var(--font-mono) !important;
  font-size: 11px !important;
  font-variant-numeric: tabular-nums;
  line-height: 1 !important;
}

[data-diffs-header] [data-change-icon],
[data-diffs-header] [data-rename-icon] {
  display: block;
  flex-shrink: 0;
}

[data-title] {
  cursor: pointer;
  transition:
    color 120ms ease,
    text-decoration-color 120ms ease;
  text-decoration: underline;
  text-decoration-color: transparent;
  text-underline-offset: 2px;
  font-family: var(--font-sans) !important;
}

[data-title]:hover {
  color: color-mix(in srgb, var(--code-foreground) 84%, var(--primary)) !important;
  text-decoration-color: currentColor;
}
`;

interface DiffPanelProps {
  mode?: DiffPanelMode;
  composerDraftTarget: ScopedThreadRef | DraftId;
  threadRef?: ScopedThreadRef | undefined;
  initialGitScope: "branch" | "working-tree";
}

export { DiffWorkerPoolProvider } from "./DiffWorkerPoolProvider";

export default function DiffPanel({
  mode = "inline",
  composerDraftTarget,
  threadRef,
  initialGitScope: initialGitScopeProp,
}: DiffPanelProps) {
  const { resolvedTheme } = useTheme();
  const settings = useClientSettings();
  const [initialGitScope] = useState(initialGitScopeProp);
  const diffRenderMode = useDiffPanelStore((state) => state.diffRenderMode);
  const setDiffRenderMode = useDiffPanelStore((state) => state.setDiffRenderMode);
  const [wordWrap, setWordWrap] = useState(settings.wordWrap);
  const [diffIgnoreWhitespace, setDiffIgnoreWhitespace] = useState(settings.diffIgnoreWhitespace);
  const [baseRefQuery, setBaseRefQuery] = useState("");
  const [commitQuery, setCommitQuery] = useState("");
  const [filesVisibility, setShowFiles] = useState<boolean | null>(null);
  const [wideReview, setWideReview] = useState(false);
  const showFiles = filesVisibility ?? wideReview;
  const [collapsedDiffFiles, setCollapsedDiffFiles] = useState<CollapsedDiffFilesState>(() => ({
    scopeKey: null,
    fileKeys: EMPTY_COLLAPSED_DIFF_FILE_KEYS,
  }));
  const [codeViewRevision, setCodeViewRevision] = useState(0);
  const codeViewRef = useRef<AnnotatableCodeViewHandle>(null);
  const reviewBodyRef = useRef<HTMLDivElement>(null);

  const routedThreadRef = useParams({
    strict: false,
    select: (params) => resolveThreadRouteRef(params),
  });
  const routeThreadRef = threadRef ?? routedThreadRef;
  const fileSelection = useDiffPanelStore((state) =>
    routeThreadRef
      ? (state.fileSelectionByThreadKey[scopedThreadKey(routeThreadRef)] ?? null)
      : null,
  );
  const activeThreadId = routeThreadRef?.threadId ?? null;
  const activeThread = useThread(routeThreadRef);
  const activeProjectId = activeThread?.projectId ?? null;
  const activeProject = useProject(
    activeThread && activeProjectId
      ? {
          environmentId: activeThread.environmentId,
          projectId: activeProjectId,
        }
      : null,
  );
  const activeCwd = activeThread?.worktreePath ?? activeProject?.workspaceRoot;
  const activeRepositoryRoot = activeThread?.worktreePath
    ? undefined
    : activeProject?.repositoryIdentity?.rootPath;
  const serverConfig = useAtomValue(
    serverEnvironment.configValueAtom(activeThread?.environmentId ?? null),
  );
  const openInPreferredEditor = useOpenInPreferredEditor(
    activeThread?.environmentId ?? null,
    serverConfig?.availableEditors ?? [],
  );
  const isGitActionRunning = useSourceControlActionRunning(
    { environmentId: activeThread?.environmentId ?? null, cwd: activeCwd ?? null },
    ["runStackedAction", "pull", "publishRepository"],
  );
  const getDiffFileContents = useAtomCommand(reviewEnvironment.diffFileContents);
  const setFilesStaged = useAtomCommand(reviewEnvironment.setFilesStaged);
  const [staging, setStaging] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const gitStatusQuery = useEnvironmentQuery(
    activeThread !== null && activeThread !== undefined && activeCwd != null
      ? vcsEnvironment.status({
          environmentId: activeThread.environmentId,
          input: { cwd: activeCwd },
        })
      : null,
  );
  const diffSelection = useDiffPanelStore((state) =>
    selectThreadDiffPanelSelection(
      state.byThreadKey,
      routeThreadRef,
      initialGitScope === "working-tree",
    ),
  );
  const isGitRepo = gitStatusQuery.data?.isRepo ?? true;
  const { turnDiffSummaries, inferredCheckpointTurnCountByTurnId } =
    useTurnDiffSummaries(activeThread);
  const orderedTurnDiffSummaries = useMemo(
    () =>
      [...turnDiffSummaries].toSorted((left, right) => {
        const leftTurnCount =
          left.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[left.turnId] ?? 0;
        const rightTurnCount =
          right.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[right.turnId] ?? 0;
        if (leftTurnCount !== rightTurnCount) {
          return rightTurnCount - leftTurnCount;
        }
        return right.completedAt.localeCompare(left.completedAt);
      }),
    [inferredCheckpointTurnCountByTurnId, turnDiffSummaries],
  );

  useEffect(() => {
    if (!routeThreadRef || diffSelection.kind !== "turn") return;
    useDiffPanelStore.getState().reconcileTurnSelection(
      routeThreadRef,
      orderedTurnDiffSummaries.map((summary) => summary.turnId),
    );
  }, [diffSelection, orderedTurnDiffSummaries, routeThreadRef]);

  const latestTurn = orderedTurnDiffSummaries[0];
  const isTurnScope = diffSelection.kind === "turn" || diffSelection.kind === "latest-turn";
  const selectedTurnId =
    diffSelection.kind === "turn"
      ? diffSelection.turnId
      : diffSelection.kind === "latest-turn"
        ? (latestTurn?.turnId ?? null)
        : null;
  const selectedGitScope: GitReviewScope = isTurnScope
    ? "working-tree"
    : (diffSelection.kind as GitReviewScope);
  const selectedSourceKind: ReviewDiffPreviewSourceKind =
    selectedGitScope === "branch" ? "branch-range" : selectedGitScope;
  const selectedCommitRef = diffSelection.kind === "commit" ? diffSelection.commitRef : null;
  const selectedBaseRef = diffSelection.kind === "branch" ? diffSelection.baseRef : null;
  const selectedFilePath = diffSelection.kind === "turn" ? diffSelection.filePath : null;
  const selectedFileRevealRequestId =
    diffSelection.kind === "turn" ? diffSelection.revealRequestId : 0;
  const selectedTurn =
    selectedTurnId === null
      ? undefined
      : orderedTurnDiffSummaries.find((summary) => summary.turnId === selectedTurnId);
  const selectedCheckpointTurnCount =
    selectedTurn &&
    (selectedTurn.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[selectedTurn.turnId]);
  const gitScopeLabels = {
    "working-tree": "Uncommitted",
    unstaged: "Unstaged",
    staged: "Staged",
    branch: "Branch",
    commit: "Committed",
  };
  const selectedScopeLabel =
    diffSelection.kind === "latest-turn"
      ? "Latest turn"
      : isTurnScope
        ? `Turn ${selectedCheckpointTurnCount ?? "?"}`
        : gitScopeLabels[selectedGitScope];
  const reviewSectionId = isTurnScope
    ? `turn:${selectedTurnId ?? "latest"}`
    : selectedGitScope === "working-tree"
      ? "unstaged"
      : selectedGitScope === "branch"
        ? selectedBaseRef
          ? `branch:${selectedBaseRef}`
          : "branch"
        : selectedGitScope === "commit"
          ? `commit:${selectedCommitRef ?? "HEAD"}`
          : `git:${selectedGitScope}`;
  const collapseScopeKey = routeThreadRef
    ? `${routeThreadRef.environmentId}:${routeThreadRef.threadId}:${reviewSectionId}`
    : null;
  const codeViewMountKey = `${collapseScopeKey ?? reviewSectionId}:${codeViewRevision}`;
  const collapsedDiffFileKeys =
    collapsedDiffFiles.scopeKey === collapseScopeKey
      ? collapsedDiffFiles.fileKeys
      : EMPTY_COLLAPSED_DIFF_FILE_KEYS;
  const reviewSectionTitle = selectedScopeLabel;
  const selectedCheckpointRange = useMemo(
    () =>
      typeof selectedCheckpointTurnCount === "number"
        ? {
            fromTurnCount: Math.max(0, selectedCheckpointTurnCount - 1),
            toTurnCount: selectedCheckpointTurnCount,
          }
        : null,
    [selectedCheckpointTurnCount],
  );
  const activeCheckpointDiff = useCheckpointDiff(
    {
      environmentId: activeThread?.environmentId ?? null,
      threadId: activeThreadId,
      fromTurnCount: selectedCheckpointRange?.fromTurnCount ?? null,
      toTurnCount: selectedCheckpointRange?.toTurnCount ?? null,
      ignoreWhitespace: diffIgnoreWhitespace,
      cacheScope: selectedTurn ? `turn:${selectedTurn.turnId}` : null,
    },
    { enabled: isGitRepo && selectedTurn !== undefined },
  );
  const stagedFilesPreview = useEnvironmentQuery(
    activeThread && activeCwd
      ? reviewEnvironment.diffPreview({
          environmentId: activeThread.environmentId,
          input: { cwd: activeCwd, sourceKind: "staged", includePatch: false },
        })
      : null,
  );
  const unstagedFilesPreview = useEnvironmentQuery(
    !isTurnScope && selectedGitScope === "working-tree" && activeThread && activeCwd
      ? reviewEnvironment.diffPreview({
          environmentId: activeThread.environmentId,
          input: { cwd: activeCwd, sourceKind: "unstaged", includePatch: false },
        })
      : null,
  );
  const nothingToStage =
    unstagedFilesPreview.error === null &&
    unstagedFilesPreview.data?.sources.find((source) => source.kind === "unstaged")?.files
      ?.length === 0;
  const branchDiffPreview = useEnvironmentQuery(
    !isTurnScope && activeThread && activeCwd
      ? reviewEnvironment.diffPreview({
          environmentId: activeThread.environmentId,
          input: {
            cwd: activeCwd,
            sourceKind: selectedSourceKind,
            ...(selectedBaseRef ? { baseRef: selectedBaseRef } : {}),
            ...(selectedCommitRef ? { commitRef: selectedCommitRef } : {}),
            ignoreWhitespace: diffIgnoreWhitespace,
          },
        })
      : null,
  );
  const selectedGitSource = branchDiffPreview.data?.sources.find(
    (source) => source.kind === selectedSourceKind,
  );
  const currentLoadDiffFiles = useMemo<FileDiffContentsLoader | undefined>(() => {
    const preview = branchDiffPreview.data;
    if (isTurnScope || !activeThread || !preview || !selectedGitSource) {
      return undefined;
    }

    const source = selectedGitSource;
    return async (fileDiff) => {
      const newPath = resolveFileDiffPath(fileDiff);
      const oldPath = fileDiff.prevName
        ? resolveFileDiffPath({ ...fileDiff, name: fileDiff.prevName })
        : newPath;
      const result = await getDiffFileContents({
        environmentId: activeThread.environmentId,
        input: {
          cwd: preview.cwd,
          sourceKind: source.kind,
          changeType: fileDiff.type,
          baseRef: source.mergeBaseRef ?? source.baseRef,
          headRef: source.headRef,
          oldPath,
          newPath,
        },
      });
      if (result._tag !== "Success") {
        throw squashAtomCommandFailure(result);
      }

      const newFile = {
        name: newPath,
        contents: result.value.newContents,
        cacheKey: `${source.diffHash}:new:${newPath}`,
      };
      if (fileDiff.type === "rename-pure") {
        return { oldFile: null, newFile };
      }
      return {
        oldFile: {
          name: oldPath,
          contents: result.value.oldContents,
          cacheKey: `${source.diffHash}:old:${oldPath}`,
        },
        newFile,
      };
    };
  }, [activeThread, branchDiffPreview.data, getDiffFileContents, selectedGitSource, isTurnScope]);
  const loadDiffFilesRef = useRef(currentLoadDiffFiles);
  loadDiffFilesRef.current = currentLoadDiffFiles;
  const loadDiffFiles = useCallback<FileDiffContentsLoader>(async (fileDiff) => {
    const loader = loadDiffFilesRef.current;
    if (!loader) throw new Error("Diff file contents are unavailable for this selection.");
    return loader(fileDiff);
  }, []);
  const localBranchRefs = useEnvironmentQuery(
    !isTurnScope && selectedGitScope === "branch" && activeThread && activeCwd
      ? vcsEnvironment.listRefs({
          environmentId: activeThread.environmentId,
          input: {
            cwd: activeCwd,
            includeMatchingRemoteRefs: true,
            refKind: "local",
            ...(baseRefQuery.trim().length > 0 ? { query: baseRefQuery.trim() } : {}),
            limit: 100,
          },
        })
      : null,
  );
  const remoteBranchRefs = useEnvironmentQuery(
    !isTurnScope && selectedGitScope === "branch" && activeThread && activeCwd
      ? vcsEnvironment.listRefs({
          environmentId: activeThread.environmentId,
          input: {
            cwd: activeCwd,
            includeMatchingRemoteRefs: true,
            refKind: "remote",
            ...(baseRefQuery.trim().length > 0 ? { query: baseRefQuery.trim() } : {}),
            limit: 100,
          },
        })
      : null,
  );
  const baseRefChoices = buildBaseRefChoices(
    localBranchRefs.data?.refs.filter((ref) => ref.name !== gitStatusQuery.data?.refName) ?? [],
    remoteBranchRefs.data?.refs ?? [],
  );
  const matchingBaseRefChoices = filterBaseRefChoices(baseRefChoices, baseRefQuery);
  const valueForBaseRefChoice = (choice: (typeof baseRefChoices)[number]) =>
    selectedBaseRef && selectedBaseRef === choice.remote?.name
      ? selectedBaseRef
      : (choice.local?.name ?? choice.remote?.name ?? choice.id);
  const baseRefItems = [AUTOMATIC_BASE_REF, ...baseRefChoices.map(valueForBaseRefChoice)];
  const filteredBaseRefItems = [
    ...(baseRefQuery.trim().length === 0 ? [AUTOMATIC_BASE_REF] : []),
    ...matchingBaseRefChoices.map(valueForBaseRefChoice),
  ];
  const aggregatePatch = isTurnScope ? activeCheckpointDiff.data?.diff : selectedGitSource?.diff;
  const skipAggregatePatch =
    !isTurnScope &&
    selectedGitSource?.files &&
    (selectedGitSource.truncated || selectedGitSource.files.length > 100);
  const aggregateRenderablePatch = useMemo(
    () =>
      skipAggregatePatch
        ? null
        : getRenderablePatch(aggregatePatch, `diff-panel:${resolvedTheme}`, {
            compactPartialHunkOffsets: !isTurnScope,
          }),
    [aggregatePatch, resolvedTheme, isTurnScope, skipAggregatePatch],
  );
  const reviewFiles = useMemo<readonly ReviewFile[]>(() => {
    if (!isTurnScope && selectedGitSource?.files)
      return sortReviewFiles(
        selectedGitSource.files.map((file) => ({
          ...file,
          additions: file.binary ? null : file.additions,
          deletions: file.binary ? null : file.deletions,
        })),
      );
    if (aggregateRenderablePatch?.kind !== "files") return [];
    return sortReviewFiles(
      aggregateRenderablePatch.files.map((file) => {
        const stats = getDiffLineStat([file]);
        return {
          path: resolveFileDiffPath(file),
          oldPath: file.prevName ?? null,
          status:
            file.type === "new"
              ? "added"
              : file.type === "deleted"
                ? "deleted"
                : file.type.startsWith("rename")
                  ? "renamed"
                  : "modified",
          additions: stats.additions,
          deletions: stats.deletions,
        };
      }),
    );
  }, [isTurnScope, selectedGitSource, aggregateRenderablePatch]);
  const navigationScope = collapseScopeKey ?? reviewSectionId;
  const activeFilePath = resolveReviewFilePath(
    reviewFiles,
    fileSelection,
    navigationScope,
    selectedFilePath,
    selectedFileRevealRequestId,
  );
  const activeFile = reviewFiles.find((file) => file.path === activeFilePath);
  const singleFileMode =
    !isTurnScope && (selectedGitSource?.truncated === true || reviewFiles.length > 100);
  const fileDiffPreview = useEnvironmentQuery(
    singleFileMode && activeThread && activeCwd && activeFilePath
      ? reviewEnvironment.diffPreview({
          environmentId: activeThread.environmentId,
          input: {
            cwd: activeCwd,
            sourceKind: selectedSourceKind,
            filePath: activeFilePath,
            ...(selectedBaseRef ? { baseRef: selectedBaseRef } : {}),
            ...(selectedSourceKind === "commit" && selectedGitSource?.headRef
              ? { commitRef: selectedGitSource.headRef }
              : {}),
            ignoreWhitespace: diffIgnoreWhitespace,
          },
        })
      : null,
  );
  const selectedFileSource = fileDiffPreview.data?.sources.find(
    (source) => source.kind === selectedSourceKind,
  );
  const selectedPatch = singleFileMode ? selectedFileSource?.diff : aggregatePatch;
  const isSelectedPatchTruncated = singleFileMode && selectedFileSource?.truncated === true;
  const isLoadingSelectedPatch = isTurnScope
    ? activeCheckpointDiff.isPending
    : singleFileMode
      ? fileDiffPreview.isPending
      : branchDiffPreview.isPending;
  const selectedPatchError = isTurnScope
    ? activeCheckpointDiff.error
    : (branchDiffPreview.error ?? fileDiffPreview.error);
  const canRefreshReview = isGitRepo && activeThread != null && activeCwd != null;
  const canRefreshGitDiff = canRefreshReview && !isTurnScope;
  const refreshBranchDiffPreview = useCallback(() => {
    branchDiffPreview.refresh();
    stagedFilesPreview.refresh();
    unstagedFilesPreview.refresh();
    if (singleFileMode) fileDiffPreview.refresh();
  }, [
    branchDiffPreview.refresh,
    stagedFilesPreview.refresh,
    unstagedFilesPreview.refresh,
    fileDiffPreview.refresh,
    singleFileMode,
  ]);
  const previousAggregateHash = useRef(selectedGitSource?.diffHash);
  useEffect(() => {
    if (
      previousAggregateHash.current &&
      previousAggregateHash.current !== selectedGitSource?.diffHash &&
      singleFileMode
    )
      fileDiffPreview.refresh();
    previousAggregateHash.current = selectedGitSource?.diffHash;
  }, [selectedGitSource?.diffHash, singleFileMode, fileDiffPreview.refresh]);
  useEffect(() => {
    if (!canRefreshReview) return;
    window.addEventListener("focus", refreshBranchDiffPreview);
    return () => window.removeEventListener("focus", refreshBranchDiffPreview);
  }, [canRefreshReview, refreshBranchDiffPreview]);
  useOnTurnCompleted(routeThreadRef, () => {
    if (canRefreshReview) refreshBranchDiffPreview();
  });
  const hasResolvedPatch = typeof selectedPatch === "string";
  const hasNoNetChanges = hasResolvedPatch && selectedPatch.trim().length === 0;
  const renderablePatch = useMemo(
    () =>
      singleFileMode
        ? getRenderablePatch(selectedPatch, `diff-panel:${resolvedTheme}`, {
            compactPartialHunkOffsets: true,
          })
        : aggregateRenderablePatch,
    [singleFileMode, selectedPatch, resolvedTheme, aggregateRenderablePatch],
  );
  const renderableFiles = useMemo(() => {
    if (!renderablePatch || renderablePatch.kind !== "files") {
      return [];
    }
    return renderablePatch.files.toSorted((left, right) =>
      resolveFileDiffPath(left).localeCompare(resolveFileDiffPath(right), undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
  }, [renderablePatch]);
  const renderableFileEntries = useMemo(
    () =>
      renderableFiles.map((fileDiff) => ({
        fileDiff,
        fileKey: buildFileDiffIdentityKey(fileDiff),
        fileVersion: buildFileDiffContentVersion(fileDiff),
      })),
    [renderableFiles],
  );
  const codeViewFiles = useMemo(
    () =>
      renderableFileEntries.map(({ fileDiff, fileKey, fileVersion }) => {
        return {
          fileDiff,
          filePath: resolveFileDiffPath(fileDiff),
          fileKey,
          fileVersion,
          collapsed: collapsedDiffFileKeys.has(fileKey),
        };
      }),
    [collapsedDiffFileKeys, renderableFileEntries],
  );
  const diffFileKeys = useMemo(() => codeViewFiles.map((file) => file.fileKey), [codeViewFiles]);
  const allDiffFilesCollapsed = areAllDiffFilesCollapsed(diffFileKeys, collapsedDiffFileKeys);
  const diffLineStat = useMemo(
    () =>
      reviewFiles.reduce(
        (stats, file) => ({
          additions: stats.additions + (file.additions ?? 0),
          deletions: stats.deletions + (file.deletions ?? 0),
        }),
        { additions: 0, deletions: 0 },
      ),
    [reviewFiles],
  );
  const selectedDiffFileKey = activeFilePath
    ? (codeViewFiles.find((candidate) => candidate.filePath === activeFilePath)?.fileKey ?? null)
    : null;

  useEffect(() => {
    if (!selectedDiffFileKey) return;
    setCollapsedDiffFiles((current) => {
      if (current.scopeKey !== collapseScopeKey || !current.fileKeys.has(selectedDiffFileKey))
        return current;
      const fileKeys = new Set(current.fileKeys);
      fileKeys.delete(selectedDiffFileKey);
      return { scopeKey: collapseScopeKey, fileKeys };
    });
  }, [
    collapseScopeKey,
    selectedDiffFileKey,
    selectedFileRevealRequestId,
    fileSelection?.revealRequestId,
  ]);
  useEffect(() => {
    if (!selectedDiffFileKey) return;
    codeViewRef.current?.scrollTo({ type: "item", id: selectedDiffFileKey, align: "start" });
  }, [
    codeViewMountKey,
    selectedDiffFileKey,
    selectedFileRevealRequestId,
    fileSelection?.revealRequestId,
  ]);

  const selectFile = useCallback(
    (path: string) => {
      if (!routeThreadRef) return;
      useDiffPanelStore.getState().selectFile(routeThreadRef, {
        scope: navigationScope,
        path,
        turnRevealRequestId: selectedFileRevealRequestId,
      });
    },
    [navigationScope, routeThreadRef, selectedFileRevealRequestId],
  );
  useEffect(() => {
    const element = reviewBodyRef.current;
    if (!element) return;
    const update = () => setWideReview(element.clientWidth >= 700);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [activeThreadId, isGitRepo, isTurnScope, orderedTurnDiffSummaries.length]);

  const openDiffFile = useCallback(
    (filePath: string) => {
      openDiffFilePrimaryAction({
        threadRef: routeThreadRef,
        filePath,
        activeCwd,
        repositoryRoot: activeRepositoryRoot,
        openInEditor: (targetPath) => {
          void (async () => {
            const result = await openInPreferredEditor(targetPath);
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              console.warn("Failed to open diff file in editor.", {
                operation: "open-diff-file",
                ...(routeThreadRef
                  ? {
                      environmentId: routeThreadRef.environmentId,
                      threadId: routeThreadRef.threadId,
                    }
                  : {}),
                ...safeErrorLogAttributes(squashAtomCommandFailure(result)),
              });
            }
          })();
        },
      });
    },
    [activeCwd, activeRepositoryRoot, openInPreferredEditor, routeThreadRef],
  );
  const toggleDiffFileCollapsed = useCallback(
    (fileKey: string) => {
      setCollapsedDiffFiles((current) => {
        const next = new Set(current.scopeKey === collapseScopeKey ? current.fileKeys : []);
        if (next.has(fileKey)) {
          next.delete(fileKey);
        } else {
          next.add(fileKey);
        }
        return { scopeKey: collapseScopeKey, fileKeys: next };
      });
    },
    [collapseScopeKey],
  );

  const toggleDiffFileCollapse = useCallback(() => {
    setCodeViewRevision((current) => current + 1);
    setCollapsedDiffFiles((current) => {
      const currentKeys =
        current.scopeKey === collapseScopeKey ? current.fileKeys : EMPTY_COLLAPSED_DIFF_FILE_KEYS;

      return {
        scopeKey: collapseScopeKey,
        fileKeys: toggleAllDiffFiles(diffFileKeys, currentKeys),
      };
    });
  }, [collapseScopeKey, diffFileKeys]);

  const selectTurn = (turnId: TurnId) => {
    if (!routeThreadRef) return;
    useDiffPanelStore.getState().selectTurn(routeThreadRef, turnId);
  };
  const selectGitScope = (scope: GitReviewScope) => {
    if (!routeThreadRef) return;
    useDiffPanelStore.getState().selectGitScope(routeThreadRef, scope);
  };
  const selectBranchBaseRef = (baseRef: string | null) => {
    if (!routeThreadRef) return;
    useDiffPanelStore.getState().selectBranchBaseRef(routeThreadRef, baseRef);
  };

  const stageFiles = async (files: readonly ReviewFile[], staged: boolean) => {
    if (!activeThread || !activeCwd || staging || isGitActionRunning || files.length === 0) return;
    setStaging(true);
    setActionError(null);
    try {
      const filePaths = [
        ...new Set(
          files.flatMap((file) => (file.oldPath ? [file.path, file.oldPath] : [file.path])),
        ),
      ];
      const [firstPath, ...otherPaths] = filePaths;
      if (!firstPath) return;
      const result = await setFilesStaged({
        environmentId: activeThread.environmentId,
        input: { cwd: activeCwd, filePaths: [firstPath, ...otherPaths], staged },
      });
      if (result._tag !== "Success") throw squashAtomCommandFailure(result);
      refreshBranchDiffPreview();
      gitStatusQuery.refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to update staged files.");
    } finally {
      setStaging(false);
    }
  };
  const activeFileIndex = reviewFiles.findIndex((file) => file.path === activeFilePath);
  const canStageFiles =
    !isTurnScope &&
    selectedGitScope !== "branch" &&
    selectedGitScope !== "commit" &&
    reviewFiles.length > 0;
  const recentCommits = branchDiffPreview.data?.commits ?? [];
  const matchingCommits = recentCommits.filter((commit) =>
    `${commit.sha} ${commit.subject}`.toLowerCase().includes(commitQuery.toLowerCase().trim()),
  );
  const customCommitRef = commitQuery.trim();
  const commitItems = [
    "HEAD",
    ...recentCommits.map((commit) => commit.sha),
    ...(customCommitRef &&
    !recentCommits.some((commit) => commit.sha === customCommitRef) &&
    customCommitRef !== "HEAD"
      ? [customCommitRef]
      : []),
  ];
  const filteredCommitItems = [
    "HEAD",
    ...matchingCommits.map((commit) => commit.sha),
    ...(customCommitRef &&
    !recentCommits.some((commit) => commit.sha === customCommitRef) &&
    customCommitRef !== "HEAD"
      ? [customCommitRef]
      : []),
  ];
  const headerRow = (
    <div className="flex w-full min-w-0 flex-col gap-2 py-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs font-medium" title={activeCwd}>
          {activeProject?.title ?? "Review"}
          {gitStatusQuery.data?.refName ? ` · ${gitStatusQuery.data.refName}` : ""}
        </span>
        {activeThread && activeCwd && (
          <GitActionsControl
            gitCwd={activeCwd}
            activeThreadRef={routeThreadRef}
            stagedOnly
            stagedFiles={
              stagedFilesPreview.data?.sources.find((source) => source.kind === "staged")?.files
            }
            onActionComplete={refreshBranchDiffPreview}
          />
        )}
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-48 flex-1 items-center gap-3 [-webkit-app-region:no-drag]">
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex h-6 max-w-full items-center gap-1 rounded-md bg-accent px-2 text-xs font-medium text-accent-foreground outline-none transition-colors hover:bg-accent/80 focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Diff scope: ${selectedScopeLabel}`}
            >
              <span className="truncate">{selectedScopeLabel}</span>
              <ChevronDownIcon className="size-3.5 shrink-0 opacity-70" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-60">
              {(["working-tree", "unstaged", "staged", "branch", "commit"] as const).map(
                (scope) => (
                  <DropdownMenuItem
                    key={scope}
                    className={
                      !isTurnScope && selectedGitScope === scope
                        ? "bg-foreground/[0.08]"
                        : undefined
                    }
                    onClick={() => selectGitScope(scope)}
                  >
                    <span>{gitScopeLabels[scope]}</span>
                  </DropdownMenuItem>
                ),
              )}
              <DropdownMenuItem
                className={
                  diffSelection.kind === "latest-turn" ? "bg-foreground/[0.08]" : undefined
                }
                onClick={() => {
                  if (routeThreadRef) useDiffPanelStore.getState().selectLatestTurn(routeThreadRef);
                }}
              >
                <span>Latest turn</span>
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Turn</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-64">
                  {orderedTurnDiffSummaries.map((summary) => {
                    const turnCount =
                      summary.checkpointTurnCount ??
                      inferredCheckpointTurnCountByTurnId[summary.turnId] ??
                      "?";
                    return (
                      <DropdownMenuItem
                        key={summary.turnId}
                        className={
                          summary.turnId === selectedTurn?.turnId
                            ? "bg-foreground/[0.08]"
                            : undefined
                        }
                        onClick={() => selectTurn(summary.turnId)}
                      >
                        <span>Turn {turnCount}</span>
                        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                          {formatShortTimestamp(summary.completedAt, settings.timestampFormat)}
                        </span>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuContent>
          </DropdownMenu>
          {!isTurnScope && selectedGitScope === "commit" && (
            <Combobox
              items={commitItems}
              filteredItems={filteredCommitItems}
              value={selectedCommitRef ?? "HEAD"}
              onOpenChange={(open) => {
                if (!open) setCommitQuery("");
              }}
              onValueChange={(value) => {
                if (value && routeThreadRef)
                  useDiffPanelStore
                    .getState()
                    .selectCommit(routeThreadRef, value === "HEAD" ? null : value);
              }}
            >
              <ComboboxTrigger
                className="inline-flex min-w-0 max-w-48 items-center gap-1 rounded-md px-1.5 py-1 text-xs hover:bg-muted"
                aria-label="Choose commit"
              >
                <span className="truncate">
                  {selectedCommitRef ? selectedCommitRef.slice(0, 8) : "Latest commit"}
                </span>
                <ChevronDownIcon className="size-3.5 shrink-0" />
              </ComboboxTrigger>
              <ComboboxPopup align="start" className="w-80 max-w-[calc(100vw-1rem)]">
                <ComboboxInput
                  placeholder="Search commits or enter a ref…"
                  showTrigger={false}
                  value={commitQuery}
                  onChange={(event) => setCommitQuery(event.target.value)}
                />
                <ComboboxList className="max-h-72">
                  <ComboboxItem value="HEAD">Latest commit (HEAD)</ComboboxItem>
                  {recentCommits.map((commit) => (
                    <ComboboxItem
                      key={commit.sha}
                      value={commit.sha}
                      contentClassName="flex items-center gap-3"
                    >
                      <span className="min-w-0 truncate" title={commit.subject}>
                        {commit.subject}
                      </span>
                      <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                        {commit.sha.slice(0, 7)}
                      </span>
                    </ComboboxItem>
                  ))}
                  {customCommitRef &&
                    !recentCommits.some((commit) => commit.sha === customCommitRef) &&
                    customCommitRef !== "HEAD" && (
                      <ComboboxItem value={customCommitRef}>Review {customCommitRef}</ComboboxItem>
                    )}
                </ComboboxList>
              </ComboboxPopup>
            </Combobox>
          )}
          {!isTurnScope && selectedGitScope === "branch" && (
            <div
              className="flex min-w-0 max-w-full items-center gap-2 overflow-hidden text-xs text-muted-foreground"
              title={`${gitStatusQuery.data?.refName ?? "HEAD"} → ${selectedGitSource?.baseRef ?? selectedBaseRef ?? "Choose base"}`}
              aria-label={`Comparing ${gitStatusQuery.data?.refName ?? "HEAD"} against ${selectedGitSource?.baseRef ?? selectedBaseRef ?? "a base branch"}`}
            >
              <span className="min-w-0 max-w-48 truncate">
                {gitStatusQuery.data?.refName ?? "HEAD"}
              </span>
              <ArrowRightIcon className="size-3.5 shrink-0 opacity-70" />
              <Combobox
                items={baseRefItems}
                filteredItems={filteredBaseRefItems}
                value={selectedBaseRef ?? AUTOMATIC_BASE_REF}
                onOpenChange={(open) => {
                  if (!open) setBaseRefQuery("");
                }}
                onValueChange={(value) => {
                  if (!value) return;
                  selectBranchBaseRef(value === AUTOMATIC_BASE_REF ? null : value);
                }}
              >
                <ComboboxTrigger
                  className="inline-flex min-w-0 max-w-48 items-center gap-1 overflow-hidden rounded-md px-1.5 py-1 outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Change comparison target. Currently ${selectedGitSource?.baseRef ?? selectedBaseRef ?? "not selected"}`}
                >
                  <span className="min-w-0 truncate">
                    {selectedGitSource?.baseRef ?? selectedBaseRef ?? "Choose base…"}
                  </span>
                  <ChevronDownIcon className="size-3.5 shrink-0 opacity-70" />
                </ComboboxTrigger>
                <ComboboxPopup
                  align="start"
                  className="w-72 min-w-0 max-w-[calc(100vw-1rem)] overflow-hidden [&>[data-slot=combobox-popup]]:min-w-0 [&>[data-slot=combobox-popup]]:overflow-hidden"
                >
                  <div className="min-w-0 shrink-0 px-3 pt-2.5">
                    <div className="relative -translate-y-px border-b border-border/70 pb-1.5 transition-colors focus-within:border-ring">
                      <SearchIcon
                        aria-hidden="true"
                        className="pointer-events-none absolute top-1.5 left-0 size-4 shrink-0 text-muted-foreground/55"
                      />
                      <ComboboxInput
                        className="[&_input]:h-6.5 [&_input]:ps-5 [&_input]:font-sans [&_input]:leading-6.5"
                        inputClassName="rounded-none bg-transparent text-sm"
                        placeholder="Search refs..."
                        showTrigger={false}
                        size="sm"
                        unstyled
                        value={baseRefQuery}
                        onChange={(event) => setBaseRefQuery(event.target.value)}
                      />
                    </div>
                  </div>
                  <div className="grid shrink-0 grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 border-b border-border/70 ps-3 pe-6.5 pt-2 pb-1.5 font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
                    <span aria-hidden="true" />
                    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_2rem] items-center">
                      <span>Branch</span>
                      <span className="text-right">Remote</span>
                    </div>
                  </div>
                  <ComboboxEmpty>No matching refs.</ComboboxEmpty>
                  <ComboboxList className="max-h-64 min-w-0 overflow-x-hidden">
                    <ComboboxItem
                      className="h-8 w-full min-w-0 grid-cols-[1rem_minmax(0,1fr)] py-0"
                      contentClassName="w-full min-w-0 overflow-hidden"
                      value={AUTOMATIC_BASE_REF}
                    >
                      <span className="block min-w-0 truncate">Automatic</span>
                    </ComboboxItem>
                    {baseRefChoices.map((choice) => {
                      const item = valueForBaseRefChoice(choice);
                      const hasBoth = choice.local !== null && choice.remote !== null;
                      const useRemote = choice.remote?.name === item;
                      return (
                        <ComboboxItem
                          key={choice.id}
                          className="h-8 w-full min-w-0 grid-cols-[1rem_minmax(0,1fr)] py-0"
                          contentClassName="w-full min-w-0 overflow-hidden"
                          value={item}
                        >
                          <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_2rem] items-center overflow-hidden">
                            <span className="block min-w-0 truncate pe-2">{choice.label}</span>
                            {hasBoth ? (
                              <div
                                className="flex justify-end"
                                onClick={(event) => event.stopPropagation()}
                                onPointerDown={(event) => event.stopPropagation()}
                              >
                                <Switch
                                  aria-label={`Use remote version of ${choice.label}`}
                                  checked={useRemote}
                                  className="[--thumb-size:--spacing(3)]"
                                  onCheckedChange={(checked) => {
                                    const nextRef = checked
                                      ? choice.remote?.name
                                      : choice.local?.name;
                                    if (nextRef) selectBranchBaseRef(nextRef);
                                  }}
                                />
                              </div>
                            ) : choice.remote ? (
                              <span
                                className="flex justify-end text-muted-foreground"
                                title="Remote only"
                              >
                                <CheckIcon aria-hidden="true" className="size-3" />
                              </span>
                            ) : null}
                          </div>
                        </ComboboxItem>
                      );
                    })}
                  </ComboboxList>
                </ComboboxPopup>
              </Combobox>
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
          {reviewFiles.length > 0 && (
            <DiffStatLabel
              additions={diffLineStat.additions}
              deletions={diffLineStat.deletions}
              className="mr-1 text-[11px]"
              layout="inline"
            />
          )}
          {canRefreshGitDiff && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={branchDiffPreview.isPending ? "Refreshing diff" : "Refresh diff"}
                    onClick={refreshBranchDiffPreview}
                  />
                }
              >
                <RefreshCwIcon
                  className={cn("size-3.5", branchDiffPreview.isPending && "animate-spin")}
                />
              </TooltipTrigger>
              <TooltipPopup side="top">
                {branchDiffPreview.isPending ? "Refreshing diff…" : "Refresh diff"}
              </TooltipPopup>
            </Tooltip>
          )}
          {codeViewFiles.length > 0 && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={allDiffFilesCollapsed ? "Expand all files" : "Collapse all files"}
                    onClick={toggleDiffFileCollapse}
                  />
                }
              >
                {allDiffFilesCollapsed ? (
                  <ChevronsUpDownIcon className="size-3.5" />
                ) : (
                  <ChevronsDownUpIcon className="size-3.5" />
                )}
              </TooltipTrigger>
              <TooltipPopup side="top">
                {allDiffFilesCollapsed ? "Expand all files" : "Collapse all files"}
              </TooltipPopup>
            </Tooltip>
          )}
          <ToggleGroup
            className="shrink-0 gap-1"
            size="sm"
            value={[diffRenderMode]}
            onValueChange={(value) => {
              const next = value[0];
              if (next === "stacked" || next === "split") {
                setDiffRenderMode(next);
              }
            }}
          >
            <Toggle aria-label="Stacked diff view" value="stacked" variant="ghost">
              <Rows3Icon className="size-3.5" />
            </Toggle>
            <Toggle aria-label="Split diff view" value="split" variant="ghost">
              <Columns2Icon className="size-3.5" />
            </Toggle>
          </ToggleGroup>
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  aria-label={wordWrap ? "Disable diff line wrapping" : "Enable diff line wrapping"}
                  variant="ghost"
                  size="sm"
                  pressed={wordWrap}
                  onPressedChange={(pressed) => {
                    setWordWrap(Boolean(pressed));
                  }}
                />
              }
            >
              <TextWrapIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup side="top">
              {wordWrap ? "Disable line wrapping" : "Enable line wrapping"}
            </TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  aria-label={
                    diffIgnoreWhitespace ? "Show whitespace changes" : "Hide whitespace changes"
                  }
                  variant="ghost"
                  size="sm"
                  pressed={diffIgnoreWhitespace}
                  onPressedChange={(pressed) => {
                    setDiffIgnoreWhitespace(Boolean(pressed));
                  }}
                />
              }
            >
              <PilcrowIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup side="top">
              {diffIgnoreWhitespace ? "Show whitespace changes" : "Hide whitespace changes"}
            </TooltipPopup>
          </Tooltip>
        </div>
      </div>
    </div>
  );

  return (
    <DiffPanelShell mode={mode} header={headerRow}>
      {!activeThread ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          Select a thread to inspect turn diffs.
        </div>
      ) : !isGitRepo ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          Turn diffs are unavailable because this project is not a git repository.
        </div>
      ) : isTurnScope && orderedTurnDiffSummaries.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          No completed turns yet.
        </div>
      ) : (
        <>
          <div className="flex min-h-9 shrink-0 flex-wrap items-center justify-between gap-1 border-b border-border/70 px-2 py-1">
            <div className="flex min-w-0 items-center gap-1">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Previous changed file"
                disabled={activeFileIndex <= 0}
                onClick={() => {
                  const file = reviewFiles[activeFileIndex - 1];
                  if (file) selectFile(file.path);
                }}
              >
                <ArrowUpIcon className="size-3.5" />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Next changed file"
                disabled={activeFileIndex < 0 || activeFileIndex >= reviewFiles.length - 1}
                onClick={() => {
                  const file = reviewFiles[activeFileIndex + 1];
                  if (file) selectFile(file.path);
                }}
              >
                <ArrowDownIcon className="size-3.5" />
              </Button>
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {reviewFiles.length > 0
                  ? `${activeFileIndex + 1} / ${reviewFiles.length}`
                  : "0 files"}
              </span>
              {singleFileMode && (
                <span className="ml-1 text-[11px] text-muted-foreground">One file at a time</span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {canStageFiles && (
                <Tooltip disabled={!nothingToStage}>
                  <TooltipTrigger
                    closeOnClick={false}
                    render={
                      <span className="inline-flex" tabIndex={nothingToStage ? 0 : undefined} />
                    }
                  >
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={
                        staging ||
                        isGitActionRunning ||
                        unstagedFilesPreview.isPending ||
                        nothingToStage
                      }
                      onClick={() => void stageFiles(reviewFiles, selectedGitScope !== "staged")}
                    >
                      {selectedGitScope === "staged" ? "Unstage all" : "Stage all"}
                    </Button>
                  </TooltipTrigger>
                  <TooltipPopup>All changes are staged. Nothing left to stage.</TooltipPopup>
                </Tooltip>
              )}
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={showFiles ? "Hide changed files" : "Show changed files"}
                aria-pressed={showFiles}
                onClick={() => setShowFiles(!showFiles)}
              >
                <PanelRightIcon className="size-3.5" />
              </Button>
            </div>
          </div>
          {actionError && (
            <p role="alert" className="shrink-0 px-3 py-2 text-xs text-error">
              {actionError}
            </p>
          )}
          <div
            ref={reviewBodyRef}
            className="@container/review relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
          >
            <div className="diff-panel-viewport flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              {isSelectedPatchTruncated && (
                <p className="shrink-0 border-b border-border/70 bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
                  This file exceeds the preview limit. Open it to inspect the full contents; all
                  other files remain available in the file list.
                </p>
              )}
              {selectedPatchError && (
                <div className="px-3">
                  <p className="mb-2 text-[11px] text-error/80">
                    {selectedPatchError.replace(/^Git command failed in [^\n]+?\): /, "")}
                  </p>
                </div>
              )}
              {!renderablePatch ? (
                isLoadingSelectedPatch ? (
                  <DiffPanelLoadingState
                    label={
                      selectedTurn
                        ? "Loading checkpoint diff..."
                        : selectedGitScope !== "branch"
                          ? "Loading changes..."
                          : "Loading branch diff..."
                    }
                  />
                ) : (
                  <div className="flex h-full items-center justify-center px-3 py-2 text-xs text-muted-foreground/70">
                    <p>
                      {hasNoNetChanges
                        ? singleFileMode && activeFile
                          ? "No text changes to display for this file."
                          : "No changes in this selection."
                        : "No patch available for this selection."}
                    </p>
                  </div>
                )
              ) : renderablePatch.kind === "files" ? (
                <div
                  className="min-h-0 flex-1"
                  onClickCapture={(event) => {
                    const composedPath = event.nativeEvent.composedPath?.() ?? [];
                    const title = composedPath.find(
                      (node): node is HTMLElement =>
                        node instanceof HTMLElement && node.hasAttribute("data-title"),
                    );
                    const filePath = title?.textContent?.trim();
                    if (filePath) openDiffFile(filePath);
                  }}
                >
                  <AnnotatableCodeView
                    key={collapseScopeKey ?? reviewSectionId}
                    viewerRef={codeViewRef}
                    codeViewKey={codeViewMountKey}
                    className="diff-render-surface h-full min-h-0 overflow-auto"
                    files={codeViewFiles}
                    sectionId={reviewSectionId}
                    sectionTitle={reviewSectionTitle}
                    composerDraftTarget={composerDraftTarget}
                    renderHeaderFilenameSuffix={(fileDiff) => (
                      <span className="inline-flex items-center gap-1">
                        <DiffFilePathCopyButton filePath={resolveFileDiffPath(fileDiff)} />
                        {canStageFiles && (
                          <Button
                            size="xs"
                            variant="ghost"
                            disabled={staging || isGitActionRunning}
                            aria-label={`${selectedGitScope === "staged" ? "Unstage" : "Stage"} ${resolveFileDiffPath(fileDiff)}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              const file = reviewFiles.find(
                                (candidate) => candidate.path === resolveFileDiffPath(fileDiff),
                              );
                              if (file) void stageFiles([file], selectedGitScope !== "staged");
                            }}
                          >
                            {selectedGitScope === "staged" ? "Unstage" : "Stage"}
                          </Button>
                        )}
                      </span>
                    )}
                    renderHeaderPrefix={(fileDiff, fileKey, collapsed) => {
                      const filePath = resolveFileDiffPath(fileDiff);
                      return (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <button
                                type="button"
                                className={cn(
                                  "-ms-0.5 inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 transition-colors hover:bg-foreground/10 focus-visible:outline-hidden",
                                  getDiffCollapseIconClassName(fileDiff),
                                )}
                                aria-label={
                                  collapsed ? `Expand ${filePath}` : `Collapse ${filePath}`
                                }
                                aria-expanded={!collapsed}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  toggleDiffFileCollapsed(fileKey);
                                }}
                              />
                            }
                          >
                            {collapsed ? (
                              <ChevronRightIcon className="size-4" />
                            ) : (
                              <ChevronDownIcon className="size-4" />
                            )}
                          </TooltipTrigger>
                          <TooltipPopup side="top">
                            {collapsed ? "Expand diff" : "Collapse diff"}
                          </TooltipPopup>
                        </Tooltip>
                      );
                    }}
                    options={{
                      diffStyle: diffRenderMode === "split" ? "split" : "unified",
                      lineDiffType: "word",
                      overflow: wordWrap ? "wrap" : "scroll",
                      theme: resolveDiffThemeName(resolvedTheme),
                      themeType: resolvedTheme as DiffThemeType,
                      unsafeCSS: DIFF_PANEL_UNSAFE_CSS,
                      stickyHeaders: true,
                      ...(currentLoadDiffFiles ? { loadDiffFiles } : {}),
                      itemMetrics: {
                        diffHeaderHeight: 32,
                        hunkSeparatorHeight: 24,
                        paddingTop: 0,
                        paddingBottom: 0,
                      },
                      layout: { paddingTop: 0, paddingBottom: 0, gap: 0 },
                    }}
                  />
                </div>
              ) : (
                <div className="min-h-0 flex-1 overflow-auto p-2">
                  <div className="space-y-2">
                    <p className="text-[11px] text-muted-foreground/75">{renderablePatch.reason}</p>
                    <pre
                      className={cn(
                        "max-h-[72vh] rounded-md border border-border/70 bg-background/70 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground/90",
                        wordWrap
                          ? "overflow-auto whitespace-pre-wrap wrap-break-word"
                          : "overflow-auto",
                      )}
                    >
                      {renderablePatch.text}
                    </pre>
                  </div>
                </div>
              )}
            </div>
            {showFiles && reviewFiles.length > 0 && (
              <aside
                className="absolute inset-y-0 right-0 z-10 w-60 border-l border-border bg-background shadow-lg @[700px]/review:static @[700px]/review:w-60 @[700px]/review:shrink-0 @[700px]/review:shadow-none"
                aria-label="Changed files"
              >
                <ReviewFileNavigator
                  files={reviewFiles}
                  selectedPath={activeFilePath}
                  onSelectFile={selectFile}
                  onActivateFile={() => {
                    if (!wideReview) setShowFiles(false);
                  }}
                />
              </aside>
            )}
          </div>
        </>
      )}
    </DiffPanelShell>
  );
}
