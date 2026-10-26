import { useClientSettings } from "~/hooks/useSettings";
import { useEnvironmentQuery } from "../../state/query";
import { vcsEnvironment } from "../../state/vcs";
import { preloadDiffPanel } from "../diffPanelLoader";
import { shortcutLabelForCommand } from "../../keybindings";
import type {
  EditorId,
  ProjectScript,
  ResolvedKeybindingsConfig,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { FileDiffIcon, FolderIcon, GitPullRequestIcon } from "lucide-react";
import { fileBasename } from "@t3tools/client-runtime/markdown-links";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useT3ProjectFileScripts } from "../../hooks/useT3ProjectFileScripts";
import ProjectScriptsControl, {
  type NewProjectScriptInput,
  type ProjectScriptActionResult,
} from "../ProjectScriptsControl";
import { OpenInPicker } from "./OpenInPicker";
import { shouldShowOpenInPicker } from "./ChatHeader";
import { ThreadDetailsCard } from "./ThreadDetailsCard";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { ThreadAutomationsPanel } from "./ThreadAutomationsPanel";
import { ThreadPullRequestWatches } from "./ThreadPullRequestWatches";
import { ThreadRelationshipsPanel } from "./ThreadRelationshipsControl";

export function ThreadDetailsPanel(props: {
  threadRef: ScopedThreadRef;
  toggleContainer: HTMLElement | null;
  projectName: string | undefined;
  scripts: ReadonlyArray<ProjectScript> | undefined;
  preferredScriptId: string | null;
  gitCwd: string | null;
  openInCwd: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  isDraft: boolean;
  onOpenChanges: () => void;
  onShowPullRequest?: (() => void) | undefined;
  onRunScript: (script: ProjectScript) => void;
  onAddScript: (input: NewProjectScriptInput) => Promise<ProjectScriptActionResult>;
  onUpdateScript: (id: string, input: NewProjectScriptInput) => Promise<ProjectScriptActionResult>;
  onDeleteScript: (id: string) => Promise<ProjectScriptActionResult>;
}) {
  const redesign = useClientSettings((s) => s.redesignEnabled);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const gitStatus = useEnvironmentQuery(
    props.gitCwd
      ? vcsEnvironment.status({
          environmentId: props.threadRef.environmentId,
          input: { cwd: props.gitCwd },
        })
      : null,
  ).data;
  const changesTotals = gitStatus?.hasWorkingTreeChanges
    ? gitStatus.workingTree
    : gitStatus?.branchChanges;
  const fileScripts = useT3ProjectFileScripts(
    props.threadRef.environmentId,
    props.scripts ? props.openInCwd : null,
  );
  const shortcutLabel = shortcutLabelForCommand(props.keybindings, "threadPanel.toggle");
  const workspaceTitle =
    (props.openInCwd ? fileBasename(props.openInCwd) : null) || props.projectName || "Workspace";
  return (
    <ThreadDetailsCard
      threadRef={props.threadRef}
      toggleContainer={props.toggleContainer}
      {...(shortcutLabel ? { shortcutLabel } : {})}
      contentKey={`${Boolean(props.gitCwd)}:${props.scripts?.map((script) => script.id).join(",")}:${fileScripts.map((script) => script.name).join(",")}:${props.availableEditors.length}`}
    >
      <h2
        className="flex min-w-0 items-center gap-2 px-4.5 pt-3 pb-1 text-xs font-medium text-muted-foreground"
        title={props.openInCwd ?? props.projectName}
      >
        <FolderIcon aria-hidden className="size-3.5 shrink-0 opacity-70" />
        <span className="truncate">{workspaceTitle}</span>
      </h2>
      <ThreadDetailsSection
        title="Workspace"
        headingId="thread-details-workspace"
        separated={false}
        showHeading={false}
      >
        {shouldShowOpenInPicker({
          activeProjectName: props.projectName,
          activeThreadEnvironmentId: props.threadRef.environmentId,
          primaryEnvironmentId,
        }) ? (
          <div data-details-secondary>
            <OpenInPicker
              displayMode="panel"
              environmentId={props.threadRef.environmentId}
              openInCwd={props.openInCwd}
              keybindings={props.keybindings}
              availableEditors={props.availableEditors}
            />
          </div>
        ) : null}
        {props.scripts ? (
          <ProjectScriptsControl
            displayMode="panel"
            scripts={props.scripts}
            fileScripts={fileScripts}
            preferredScriptId={props.preferredScriptId}
            keybindings={props.keybindings}
            onRunScript={props.onRunScript}
            onAddScript={props.onAddScript}
            onUpdateScript={props.onUpdateScript}
            onDeleteScript={props.onDeleteScript}
          />
        ) : null}
      </ThreadDetailsSection>
      {props.gitCwd ? (
        <ThreadDetailsSection
          title="Version Control"
          headingId="thread-details-git"
          showHeading={false}
        >
          {(!redesign ||
            !props.isDraft ||
            !changesTotals ||
            changesTotals.insertions > 0 ||
            changesTotals.deletions > 0 ||
            gitStatus?.hasWorkingTreeChanges) && (
            <ThreadDetailsControl
              onClick={props.onOpenChanges}
              onPointerEnter={preloadDiffPanel}
              onFocus={preloadDiffPanel}
            >
              <FileDiffIcon />
              <span className="flex-1 text-left">Changes</span>
              <span className="flex items-center gap-1 font-mono text-2xs tabular-nums">
                <span className="text-success">+{changesTotals?.insertions ?? "…"}</span>
                <span className="text-destructive">-{changesTotals?.deletions ?? "…"}</span>
              </span>
            </ThreadDetailsControl>
          )}
          {props.onShowPullRequest ? (
            <ThreadDetailsControl onClick={props.onShowPullRequest}>
              <GitPullRequestIcon />
              Open PR details
            </ThreadDetailsControl>
          ) : null}
          <ThreadPullRequestWatches threadRef={props.threadRef} />
        </ThreadDetailsSection>
      ) : null}
      <ThreadAutomationsPanel
        environmentId={props.threadRef.environmentId}
        threadId={props.threadRef.threadId}
      />
      {!props.isDraft ? (
        <ThreadRelationshipsPanel
          environmentId={props.threadRef.environmentId}
          threadId={props.threadRef.threadId}
          mode="subagents"
          hideWhenEmpty
        />
      ) : null}
    </ThreadDetailsCard>
  );
}
