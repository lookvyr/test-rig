import {
  THREAD_REPOSITORIES_VISIBLE,
  otherThreadRepositories,
  threadChangedRepositories,
  threadRepositorySections,
  type ThreadRepository,
} from "@t3tools/client-runtime/state/thread-repositories";
import type { ProjectId, ScopedThreadRef } from "@t3tools/contracts";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderGitIcon,
  PinOffIcon,
  PlusIcon,
} from "lucide-react";
import { memo, useMemo, useState } from "react";

import { parseChangeRequestUrl } from "@t3tools/shared/changeRequestUrl";

import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";

import { useThreadDetail } from "../../state/entities";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { projectEnvironment } from "../../state/projects";
import { useEnvironmentQuery } from "../../state/query";
import { vcsEnvironment } from "../../state/vcs";
import {
  useThreadRepositoryPins,
  useThreadRepositoryPinsStore,
} from "../../threadRepositoryPinsStore";
import GitActionsControl from "../GitActionsControl";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { THREAD_DETAILS_PANEL_LABEL_CLASS } from "./threadDetailsPanelStyles";

const RepositorySection = memo(function RepositorySection(props: {
  threadRef: ScopedThreadRef;
  repository: ThreadRepository;
  expanded: boolean;
  /** Folded behind "Show more" by default, so the details card's fit measurement leaves it out. */
  overflow: boolean;
  /** Picked from "Other repositories...", so the user can take it back off the list. */
  removable: boolean;
  onToggle: (key: string) => void;
  onRemove: (key: string) => void;
}) {
  // Local status only: a remote read for every listed repository would fetch on a timer. The
  // expanded section's actions hold the full subscription.
  const status = useEnvironmentQuery(
    vcsEnvironment.status({
      environmentId: props.threadRef.environmentId,
      input: { cwd: props.repository.cwd, includeRemote: false },
    }),
  ).data;
  const totals = status?.hasWorkingTreeChanges ? status.workingTree : null;
  const Chevron = props.expanded ? ChevronDownIcon : ChevronRightIcon;
  const linkPullRequest = useAtomCommand(threadEnvironment.linkPullRequest, {
    reportFailure: false,
  });
  // The thread's own branch discovery only knows its own folder, so a pull request opened in
  // another repository is linked to the thread here, under that repository.
  const linkOpenedPullRequest = (url: string) => {
    const parsed = parseChangeRequestUrl(url);
    if (parsed === null) return;
    void linkPullRequest({
      environmentId: props.threadRef.environmentId,
      input: {
        threadId: props.threadRef.threadId,
        host: parsed.host,
        repository: parsed.repository,
        number: parsed.number,
        url,
        source: "created",
      },
    });
  };
  return (
    <div
      role="group"
      aria-label={`Repository ${props.repository.name}`}
      data-thread-details-repository-overflow={props.overflow || undefined}
      className="flex flex-col"
    >
      <ThreadDetailsControl
        variant="ghost"
        aria-expanded={props.expanded}
        onClick={() => props.onToggle(props.repository.key)}
      >
        <Chevron className="size-3.5 text-muted-foreground" aria-hidden />
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="max-w-2/3 shrink-0 truncate">{props.repository.name}</span>
          <span className="min-w-0 truncate text-xs font-normal text-muted-foreground">
            {status === null ? "" : status.isRepo ? (status.refName ?? "Detached HEAD") : ""}
          </span>
          {totals ? (
            <span className="ml-auto flex shrink-0 items-baseline gap-1 ps-2 font-mono text-2xs tabular-nums">
              <span className="text-diff-addition-foreground">+{totals.insertions}</span>
              <span className="text-diff-deletion-foreground">-{totals.deletions}</span>
            </span>
          ) : null}
        </span>
      </ThreadDetailsControl>
      {props.expanded ? (
        <div className="flex flex-col ps-4">
          <GitActionsControl
            displayMode="panel"
            gitCwd={props.repository.cwd}
            activeThreadRef={props.threadRef}
            onPullRequestOpened={linkOpenedPullRequest}
            syncsThreadBranch={false}
          />
          {props.removable ? (
            <ThreadDetailsControl
              variant="ghost"
              tone="muted"
              onClick={() => props.onRemove(props.repository.key)}
            >
              <PinOffIcon className="size-3.5" aria-hidden />
              <span className={THREAD_DETAILS_PANEL_LABEL_CLASS}>Remove from this thread</span>
            </ThreadDetailsControl>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

/** Mounted while the menu is open, so the folder list is read only when someone asks for it. */
function OtherRepositoryItems(props: {
  threadRef: ScopedThreadRef;
  projectId: ProjectId;
  threadCwd: string | null;
  listed: ReadonlyArray<ThreadRepository>;
  onPick: (repository: ThreadRepository) => void;
}) {
  const folders = useEnvironmentQuery(
    projectEnvironment.listFolders({
      environmentId: props.threadRef.environmentId,
      input: { projectId: props.projectId },
    }),
  );
  if (folders.data === null) {
    return (
      <MenuItem disabled>{folders.error ? "Could not read repositories" : "Loading…"}</MenuItem>
    );
  }
  const repositories = otherThreadRepositories({
    folders: folders.data,
    listed: props.listed,
    threadCwd: props.threadCwd,
  });
  if (repositories.length === 0) return <MenuItem disabled>No other repositories</MenuItem>;
  return repositories.map((repository) => (
    <MenuItem key={repository.key} onClick={() => props.onPick(repository)}>
      <FolderGitIcon />
      {repository.name}
    </MenuItem>
  ));
}

/**
 * Git state and actions for the project's other repositories in a thread's details: the ones its
 * turns changed, most recent first, and any picked from "Other repositories..." (kept per thread
 * for the session, removable). A worktree
 * thread lists its task folder's worktrees instead, and picking one adds a worktree. Folded
 * sections render no Git actions, so they hold no remote subscription.
 */
export function ThreadRepositorySections(props: {
  threadRef: ScopedThreadRef;
  projectId: ProjectId;
  /** The thread's own folder, which has its own Git controls when it is a repository. */
  threadCwd: string | null;
  /** Lists only once the project is known to cover other repositories. */
  coversRepositories: boolean;
  /** A worktree thread's task folder repositories; null for a thread in the project folder. */
  taskFolder: ReadonlyArray<ThreadRepository> | null;
  onTaskFolderChange: () => void;
}) {
  const detail = useThreadDetail(props.threadRef);
  const projection = detail?.projection ?? null;
  const changed = useMemo(
    () => (projection === null ? [] : threadChangedRepositories(projection)),
    [projection],
  );
  const picked = useThreadRepositoryPins(props.threadRef);
  const pin = useThreadRepositoryPinsStore((state) => state.pin);
  const unpin = useThreadRepositoryPinsStore((state) => state.unpin);
  const [showAll, setShowAll] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [addingName, setAddingName] = useState<string | null>(null);
  const addTaskFolderRepository = useAtomCommand(projectEnvironment.addTaskFolderRepository, {
    reportFailure: false,
  });
  const sections = threadRepositorySections({
    // A task folder's worktrees are the only ones the thread reaches. A repository changed before
    // the thread moved there is listed at its worktree, not at the checkout it was changed in.
    changed:
      props.taskFolder === null
        ? changed
        : changed.flatMap((repository) =>
            props.taskFolder!.filter((entry) => entry.key === repository.key),
          ),
    picked: props.taskFolder ?? picked,
    threadCwd: props.threadCwd,
    showAll,
  });
  if (!props.coversRepositories && sections.visible.length === 0) return null;
  const listed = [...sections.visible, ...sections.hidden];
  const toggle = (key: string) => setExpandedKey((current) => (current === key ? null : key));
  const addWorktree = async (repository: ThreadRepository) => {
    if (addingName !== null) return;
    setAddingName(repository.name);
    const result = await addTaskFolderRepository({
      environmentId: props.threadRef.environmentId,
      input: { threadId: props.threadRef.threadId, repositoryPath: repository.key },
    });
    setAddingName(null);
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) return;
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: `Could not add ${repository.name}`,
          description: error instanceof Error ? error.message : String(error),
        }),
      );
      return;
    }
    props.onTaskFolderChange();
    setShowAll(true);
    setExpandedKey(repository.key);
  };
  return (
    <>
      {sections.visible.map((repository, index) => (
        <RepositorySection
          key={repository.key}
          threadRef={props.threadRef}
          repository={repository}
          expanded={expandedKey === repository.key}
          overflow={index >= THREAD_REPOSITORIES_VISIBLE}
          removable={
            props.taskFolder === null &&
            picked.some((entry) => entry.key === repository.key) &&
            !changed.some((entry) => entry.key === repository.key)
          }
          onToggle={toggle}
          onRemove={(key) => unpin(props.threadRef, key)}
        />
      ))}
      {sections.hidden.length > 0 || (showAll && listed.length > THREAD_REPOSITORIES_VISIBLE) ? (
        <ThreadDetailsControl
          variant="ghost"
          tone="muted"
          aria-expanded={showAll}
          onClick={() => setShowAll((current) => !current)}
        >
          <span className={`ms-6 ${THREAD_DETAILS_PANEL_LABEL_CLASS}`}>
            {showAll ? "Show fewer" : `Show ${sections.hidden.length} more`}
          </span>
        </ThreadDetailsControl>
      ) : null}
      <Menu open={isPickerOpen} onOpenChange={setIsPickerOpen}>
        <MenuTrigger
          render={<ThreadDetailsControl variant="ghost" tone="muted" />}
          disabled={addingName !== null}
        >
          <PlusIcon className="size-3.5" aria-hidden />
          <span className={THREAD_DETAILS_PANEL_LABEL_CLASS}>
            {addingName === null
              ? "Other repositories..."
              : `Adding a worktree of ${addingName}...`}
          </span>
        </MenuTrigger>
        <MenuPopup align="start">
          {isPickerOpen ? (
            <OtherRepositoryItems
              threadRef={props.threadRef}
              projectId={props.projectId}
              threadCwd={props.threadCwd}
              listed={listed}
              onPick={(repository) => {
                if (props.taskFolder !== null) {
                  void addWorktree(repository);
                  return;
                }
                pin(props.threadRef, repository);
                // A pick beyond the visible few would land folded away, out of sight.
                setShowAll(true);
                setExpandedKey(repository.key);
              }}
            />
          ) : null}
        </MenuPopup>
      </Menu>
    </>
  );
}
