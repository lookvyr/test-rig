import { preloadDiffPanel } from "../diffPanelLoader";
import type {
  EditorId,
  ProjectScript,
  ResolvedKeybindingsConfig,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { FileDiffIcon, GitPullRequestIcon } from "lucide-react";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useT3ProjectFileScripts } from "../../hooks/useT3ProjectFileScripts";
import { BranchToolbar, type BranchToolbarProps } from "../BranchToolbar";
import GitActionsControl from "../GitActionsControl";
import ProjectScriptsControl, {
  type NewProjectScriptInput,
  type ProjectScriptActionResult,
} from "../ProjectScriptsControl";
import { OpenInPicker } from "./OpenInPicker";
import { shouldShowOpenInPicker } from "./ChatHeader";
import { ThreadDetailsCard } from "./ThreadDetailsCard";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadDetailsSection } from "./ThreadDetailsSection";

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
  branchToolbar: BranchToolbarProps | null;
  onOpenChanges: () => void;
  onShowPullRequest?: (() => void) | undefined;
  onRunScript: (script: ProjectScript) => void;
  onAddScript: (input: NewProjectScriptInput) => Promise<ProjectScriptActionResult>;
  onUpdateScript: (id: string, input: NewProjectScriptInput) => Promise<ProjectScriptActionResult>;
  onDeleteScript: (id: string) => Promise<ProjectScriptActionResult>;
}) {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const fileScripts = useT3ProjectFileScripts(
    props.threadRef.environmentId,
    props.scripts ? props.openInCwd : null,
  );
  return (
    <ThreadDetailsCard threadRef={props.threadRef} toggleContainer={props.toggleContainer}>
      <ThreadDetailsSection
        title="Workspace"
        headingId="thread-details-workspace"
        separated={false}
        showHeading={false}
      >
        {props.branchToolbar ? (
          <BranchToolbar {...props.branchToolbar} layout="panel" panelSection="workspace" />
        ) : null}
        {shouldShowOpenInPicker({
          activeProjectName: props.projectName,
          activeThreadEnvironmentId: props.threadRef.environmentId,
          primaryEnvironmentId,
        }) ? (
          <OpenInPicker
            displayMode="panel"
            environmentId={props.threadRef.environmentId}
            openInCwd={props.openInCwd}
            keybindings={props.keybindings}
            availableEditors={props.availableEditors}
          />
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
          {props.branchToolbar ? (
            <BranchToolbar {...props.branchToolbar} layout="panel" panelSection="branch" />
          ) : null}
          <GitActionsControl
            displayMode="panel"
            gitCwd={props.gitCwd}
            activeThreadRef={props.threadRef}
            {...(props.branchToolbar?.draftId ? { draftId: props.branchToolbar.draftId } : {})}
          />
          <ThreadDetailsControl
            onClick={props.onOpenChanges}
            onPointerEnter={preloadDiffPanel}
            onFocus={preloadDiffPanel}
          >
            <FileDiffIcon />
            Changes
          </ThreadDetailsControl>
          {props.onShowPullRequest ? (
            <ThreadDetailsControl onClick={props.onShowPullRequest}>
              <GitPullRequestIcon />
              Pull request details
            </ThreadDetailsControl>
          ) : null}
        </ThreadDetailsSection>
      ) : null}
    </ThreadDetailsCard>
  );
}
