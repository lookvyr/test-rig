import { TASK_FOLDER_DEFAULT_REPOSITORIES_MAX, type WorkspaceFolder } from "@t3tools/contracts";
import { ChevronDownIcon, FolderGitIcon } from "lucide-react";

import { cn } from "../lib/utils";
import type { WorktreeRepositoryChoice } from "../worktreeRepositoryChoiceStore";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";

/** The repositories a new worktree thread includes, resolving the default. */
export function resolveWorktreeRepositoryPaths(
  repositories: ReadonlyArray<Pick<WorkspaceFolder, "path">>,
  choice: WorktreeRepositoryChoice,
): ReadonlyArray<string> {
  const available = repositories.map((repository) => repository.path);
  if (choice.paths === null) {
    return available.length <= TASK_FOLDER_DEFAULT_REPOSITORIES_MAX ? available : [];
  }
  return choice.paths.filter((path) => available.includes(path));
}

/**
 * Next to the workspace picker for a new worktree thread of a project with several
 * repositories: which of them get a worktree, and, for a plain project folder, the base branch.
 */
export function WorktreeRepositoriesControl(props: {
  repositories: ReadonlyArray<WorkspaceFolder>;
  choice: WorktreeRepositoryChoice;
  /** A plain project folder has no branch picker, so the base branch is named here. */
  asksBaseBranch: boolean;
  onChange: (choice: WorktreeRepositoryChoice) => void;
}) {
  const selected = resolveWorktreeRepositoryPaths(props.repositories, props.choice);
  // Nothing is selected only because there are too many to take them all by default.
  const needsChoice =
    props.choice.paths === null && props.repositories.length > TASK_FOLDER_DEFAULT_REPOSITORIES_MAX;
  const label = needsChoice
    ? "Choose repositories"
    : selected.length === props.repositories.length
      ? "All repositories"
      : selected.length === 0
        ? "No repositories"
        : selected.length === 1
          ? (props.repositories.find((repository) => repository.path === selected[0])?.name ??
            "1 repository")
          : `${selected.length} repositories`;
  const toggle = (path: string, checked: boolean) => {
    const next = checked ? [...selected, path] : selected.filter((entry) => entry !== path);
    props.onChange({ ...props.choice, paths: next });
  };
  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "inline-flex h-6 min-w-0 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
          needsChoice && "text-warning-foreground hover:text-warning-foreground",
        )}
        aria-label="Repositories for the new worktree"
      >
        <FolderGitIcon className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{label}</span>
        <ChevronDownIcon className="size-3 shrink-0 opacity-70" aria-hidden />
      </PopoverTrigger>
      <PopoverPopup align="start" className="w-64 p-1">
        <p className="px-2 pt-1 pb-1.5 text-xs text-muted-foreground">
          {needsChoice
            ? "Choose the repositories this thread works on."
            : "Each repository you choose gets a worktree on the thread's branch."}
        </p>
        {props.repositories.map((repository) => (
          <label
            key={repository.path}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
            title={repository.path}
          >
            <Checkbox
              checked={selected.includes(repository.path)}
              onCheckedChange={(checked) => toggle(repository.path, checked === true)}
            />
            <span className="min-w-0 truncate">{repository.name}</span>
          </label>
        ))}
        {props.asksBaseBranch ? (
          <div className="flex flex-col gap-1 border-t border-border/60 px-2 pt-2 pb-1">
            <label className="text-xs text-muted-foreground" htmlFor="worktree-base-branch">
              Base branch
            </label>
            <Input
              id="worktree-base-branch"
              className="h-7 font-mono text-xs"
              value={props.choice.baseBranch}
              onChange={(event) =>
                props.onChange({ ...props.choice, baseBranch: event.currentTarget.value })
              }
            />
            <p className="text-2xs text-muted-foreground">
              A repository without this branch starts from its current checkout.
            </p>
          </div>
        ) : null}
      </PopoverPopup>
    </Popover>
  );
}
