import { useState } from "react";
import type { ProjectId, SkillLibraryAssignment, ToolsScopeId } from "@t3tools/contracts";
import { SearchIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { assignScopes, selectedSkillScopes } from "./toolsSettings.logic";
import type { ToolsProject } from "./ToolsAvailability";

const SEARCH_THRESHOLD = 8;
const NO_PROJECT_IDS: readonly ProjectId[] = [];

/** Picks the projects a tool applies to; nothing changes until Save. */
export function ToolsProjectsDialog({
  toolName,
  projects,
  assignment,
  unavailableProjectIds = NO_PROJECT_IDS,
  onSave,
  onClose,
}: {
  toolName: string;
  projects: readonly ToolsProject[];
  assignment: SkillLibraryAssignment;
  unavailableProjectIds?: readonly ProjectId[] | undefined;
  onSave: (assignment: SkillLibraryAssignment) => Promise<void>;
  onClose: () => void;
}) {
  const initialSelected = selectedSkillScopes(assignment, projects);
  const [selected, setSelected] = useState<readonly ToolsScopeId[]>(initialSelected);
  const [includeNew, setIncludeNew] = useState(assignment.allProjects);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const changed =
    includeNew !== assignment.allProjects ||
    selected.length !== initialSelected.length ||
    selected.some((id) => !initialSelected.includes(id));
  const shown = projects.filter((project) =>
    project.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const allSelected = selected.length === projects.length;
  const toggle = (id: ToolsScopeId, checked: boolean) =>
    setSelected(checked ? [...selected, id] : selected.filter((entry) => entry !== id));
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await onSave(assignScopes(assignment, selected, includeNew, projects, unavailableProjectIds));
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The change could not be saved.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogPopup className="sm:max-w-sm" showCloseButton>
        <DialogHeader>
          <DialogTitle>
            Projects <span className="font-normal text-muted-foreground">· {toolName}</span>
          </DialogTitle>
        </DialogHeader>
        <DialogPanel className="space-y-1">
          {projects.length > SEARCH_THRESHOLD ? (
            <label className="mb-2 flex h-8 items-center gap-2 rounded-lg border px-2.5 focus-within:ring-2 focus-within:ring-ring">
              <SearchIcon className="size-3.5 text-muted-foreground" aria-hidden />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="Search projects"
                aria-label="Search projects"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
            </label>
          ) : null}
          <div className="max-h-72 overflow-y-auto">
            {query ? null : (
              <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent">
                <Checkbox
                  checked={allSelected}
                  indeterminate={!allSelected && selected.length > 0}
                  onCheckedChange={(checked) =>
                    setSelected(checked ? projects.map((project) => project.id) : [])
                  }
                />
                Select all
              </label>
            )}
            {shown.map((project) => (
              <label
                key={project.id}
                title={project.workspaceRoot}
                className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
              >
                <Checkbox
                  checked={selected.includes(project.id)}
                  onCheckedChange={(checked) => toggle(project.id, checked)}
                />
                <span className="truncate">{project.name}</span>
              </label>
            ))}
            {shown.length === 0 ? (
              <p className="px-2 py-1.5 text-sm text-muted-foreground">
                {projects.length ? "No projects match" : "No projects yet"}
              </p>
            ) : null}
          </div>
          <div className="border-t pt-1">
            <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
              <Checkbox checked={includeNew} onCheckedChange={setIncludeNew} />
              New projects
            </label>
          </div>
          {error ? (
            <p role="alert" className="px-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || !changed || projects.length === 0} onClick={() => void save()}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
