import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ProjectId, WorkspaceFolder } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { FolderGit2Icon, FolderIcon, FolderPlusIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";

import { readLocalApi } from "../../localApi";
import { resolveProjectPickerTarget } from "../../wslPaths";
import { primaryEnvironmentIdAtom } from "../../state/primaryEnvironment";
import { projectEnvironment } from "../../state/projects";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import type { SidebarProjectGroupMember } from "../../sidebarProjectGrouping";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { resolveAddedFolder } from "./addedFolders.logic";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

/** The last segment of a path, for naming a folder someone adds. */
function folderNameFromPath(folderPath: string) {
  const trimmed = folderPath.replace(/[\\/]+$/, "");
  return trimmed.split(/[\\/]/).at(-1) || trimmed;
}

function reportFailure(title: string, result: AtomCommandResult<unknown, unknown>) {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
  const error = squashAtomCommandFailure(result);
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

/**
 * Settings → Projects → Repositories: what a project covers on each machine. Repositories inside
 * the project folder are found on their own; folders elsewhere are added here.
 */
export function ProjectRepositoriesSettings({
  members,
}: {
  members: readonly SidebarProjectGroupMember[];
}) {
  return (
    <SettingsSection id={searchableSetting("project-repositories").id} title="Repositories">
      <p className="px-3 py-2.5 text-xs text-muted-foreground sm:px-4">
        A project covers every repository inside its folder, and any folder you add. Threads can
        read and change all of them, and review and commit each repository separately. To leave a
        repository inside the project folder out, list it under{" "}
        <code className="font-mono">ignoreRepositories</code> in the project&apos;s{" "}
        <code className="font-mono">t3.json</code>.
      </p>
      {members.map((member) => (
        <MemberRepositories
          key={member.physicalProjectKey}
          member={member}
          showMachine={members.length > 1}
        />
      ))}
    </SettingsSection>
  );
}

function MemberRepositories({
  member,
  showMachine,
}: {
  member: SidebarProjectGroupMember;
  showMachine: boolean;
}) {
  const environmentId: EnvironmentId = member.environmentId;
  const projectId: ProjectId = member.id;
  const folders = useEnvironmentQuery(
    projectEnvironment.listFolders({ environmentId, input: { projectId } }),
  );
  const primaryEnvironmentId = useAtomValue(primaryEnvironmentIdAtom);
  const updateProject = useAtomCommand(projectEnvironment.update, { reportFailure: false });
  const [draftPath, setDraftPath] = useState("");
  const [pending, setPending] = useState(false);
  // The native picker browses this machine, so it only fits a project on it.
  const canBrowse =
    window.desktopBridge !== undefined && primaryEnvironmentId === member.environmentId;

  const change = async (
    input: { addFolders?: { path: string; name: string }[]; removeFolders?: string[] },
    failureTitle: string,
  ) => {
    setPending(true);
    const result = await updateProject({ environmentId, input: { projectId, ...input } });
    setPending(false);
    if (result._tag === "Failure") {
      reportFailure(failureTitle, result);
      return false;
    }
    folders.refresh();
    return true;
  };

  const add = async (folderPath: string, name?: string) => {
    const folder = resolveAddedFolder(folderPath, name);
    if (folder === null) return;
    if (await change({ addFolders: [folder] }, "Failed to add folder")) {
      setDraftPath("");
    }
  };
  const draftFolder = resolveAddedFolder(draftPath);

  const browse = async () => {
    const api = readLocalApi();
    if (!api) return;
    // A WSL-only desktop runs this server in a distro: route the picker there, so the desktop
    // hands back the distro's path rather than a Windows one.
    const wslConfiguration = (await window.desktopBridge?.getWslState().catch(() => null)) ?? null;
    const targetEnvironmentId = resolveProjectPickerTarget({
      browseEnvironmentId: member.environmentId,
      primaryEnvironmentId,
      desktopInstanceId: null,
      wslConfiguration,
    });
    const picked = await api.dialogs.pickFolder({
      initialPath: member.workspaceRoot,
      ...(targetEnvironmentId ? { targetEnvironmentId } : {}),
    });
    if (picked) await add(picked);
  };

  const list = folders.data;
  return (
    <>
      {showMachine ? (
        <div className="px-3 pt-3 text-xs font-medium text-muted-foreground sm:px-4">
          {member.environmentLabel ?? "This environment"}
        </div>
      ) : null}
      {list === null ? (
        <p className="px-3 py-2.5 text-sm text-muted-foreground sm:px-4">
          {folders.error ? "Could not read this project's folders." : "Reading folders…"}
        </p>
      ) : (
        <>
          <SettingsRow
            title={
              <span className="flex items-center gap-2">
                <FolderIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                Project folder
              </span>
            }
            description={
              <span className="font-mono">
                {member.workspaceRoot}
                {list.projectIsGitRepository ? "" : " (not a Git repository)"}
              </span>
            }
          />
          {list.folders.length === 0 ? (
            <p className="px-3 py-2.5 text-sm text-muted-foreground sm:px-4">
              No other repositories. Clone one into the project folder, or add a folder below.
            </p>
          ) : (
            list.folders.map((folder) => (
              <FolderRow
                key={folder.path}
                folder={folder}
                disabled={pending}
                onRemove={() =>
                  void change({ removeFolders: [folder.path] }, "Failed to remove folder")
                }
              />
            ))
          )}
          {list.suggestions.map((suggestion) => (
            <SettingsRow
              key={suggestion.path}
              title={
                <span className="flex items-center gap-2">
                  <FolderPlusIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  {suggestion.name}
                </span>
              }
              description={
                <span>
                  <span className="font-mono">{suggestion.path}</span>
                  <span className="block">
                    Listed in {folderNameFromPath(list.codeWorkspaceFile ?? "")}
                  </span>
                </span>
              }
              control={
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  aria-label={`Add ${suggestion.path}`}
                  onClick={() => void add(suggestion.path, suggestion.name)}
                >
                  Add
                </Button>
              }
            />
          ))}
          <SettingsRow
            title="Add folder"
            description="A folder outside the project folder, such as a repository it depends on. Agents can then reach it."
            control={
              <form
                className="flex w-full min-w-0 items-center gap-2 @min-[32rem]/settings-row:w-auto"
                onSubmit={(event) => {
                  event.preventDefault();
                  void add(draftPath);
                }}
              >
                <Input
                  className="w-full font-mono sm:w-64"
                  aria-label="Folder path"
                  placeholder="/path/to/folder"
                  value={draftPath}
                  aria-invalid={draftPath.trim() !== "" && draftFolder === null}
                  title={
                    draftPath.trim() !== "" && draftFolder === null
                      ? "Enter an absolute path"
                      : undefined
                  }
                  onChange={(event) => setDraftPath(event.currentTarget.value)}
                />
                {canBrowse ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => void browse()}
                  >
                    Browse…
                  </Button>
                ) : null}
                <Button type="submit" size="sm" disabled={pending || draftFolder === null}>
                  Add
                </Button>
              </form>
            }
          />
        </>
      )}
    </>
  );
}

function FolderRow({
  folder,
  disabled,
  onRemove,
}: {
  folder: WorkspaceFolder;
  disabled: boolean;
  onRemove: () => void;
}) {
  const Icon =
    folder.state === "missing"
      ? TriangleAlertIcon
      : folder.state === "git"
        ? FolderGit2Icon
        : FolderIcon;
  const detail =
    folder.state === "missing"
      ? "Missing on this machine"
      : folder.discovered
        ? "Inside the project folder"
        : folder.state === "git"
          ? "Added"
          : "Added, not a Git repository";
  return (
    <SettingsRow
      title={
        <span className="flex items-center gap-2">
          <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          {folder.name}
        </span>
      }
      description={
        <span>
          <span className="font-mono">{folder.path}</span>
          <span className="block">{detail}</span>
        </span>
      }
      control={
        folder.discovered ? null : (
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            aria-label={`Remove ${folder.path}`}
            onClick={onRemove}
          >
            Remove
          </Button>
        )
      }
    />
  );
}
