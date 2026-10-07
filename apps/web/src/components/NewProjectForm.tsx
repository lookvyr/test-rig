import { useEffect, useRef, useState } from "react";
import { type EnvironmentId } from "@t3tools/contracts";
import { newProjectFolderName } from "@t3tools/shared/path";
import { openCommandPalette } from "../commandPaletteBus";
import { useNewProject } from "../hooks/useNewProject";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

/** Name-based project creation stays local; publishing uses the project's Git menu. */
export function NewProjectForm({
  onCreated,
  initialEnvironmentId,
}: {
  onCreated: () => void;
  initialEnvironmentId?: EnvironmentId;
}) {
  const { environments } = useEnvironments();
  const primaryId = usePrimaryEnvironmentId();
  const available = environments.filter(
    (environment) =>
      environment.connection.phase === "connected" && environment.serverConfig?.newProjectsRoot,
  );
  const [chosenEnvironmentId, setEnvironmentId] = useState<EnvironmentId | null>(null);
  const environmentId =
    chosenEnvironmentId ??
    initialEnvironmentId ??
    available.find((environment) => environment.environmentId === primaryId)?.environmentId ??
    available[0]?.environmentId ??
    null;
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const create = useNewProject();
  const selected = available.find((environment) => environment.environmentId === environmentId);
  const root = selected?.serverConfig?.newProjectsRoot;
  const trimmedName = name.trim();
  const separator = root?.includes("\\") ? "\\" : "/";
  const preview = root
    ? `${root.replace(/[\\/]+$/, "")}${separator}${newProjectFolderName(trimmedName)}`
    : null;

  return (
    <form
      className="flex flex-col gap-4 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!environmentId || !root || !trimmedName || submitting.current) return;
        submitting.current = true;
        setPending(true);
        void create({ environmentId, name: trimmedName }, { shouldOpen: () => mounted.current })
          .then((created) => {
            if (created && mounted.current) onCreated();
          })
          .finally(() => {
            submitting.current = false;
            if (mounted.current) setPending(false);
          });
      }}
    >
      <h2 className="font-medium">New project</h2>
      <label className="flex flex-col gap-2 text-sm">
        Project name
        <Input
          autoFocus
          maxLength={200}
          placeholder="My project"
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={pending}
        />
      </label>
      {available.length > 0 && (available.length > 1 || !selected) && (
        <label className="flex flex-col gap-2 text-sm">
          Environment
          <select
            className="rounded-md border bg-background p-2"
            value={selected ? (environmentId ?? "") : ""}
            disabled={pending}
            onChange={(event) => {
              const target = available.find(
                (environment) => environment.environmentId === event.target.value,
              );
              if (target) setEnvironmentId(target.environmentId);
            }}
          >
            {!selected && (
              <option value="" disabled>
                Choose an environment
              </option>
            )}
            {available.map((environment) => (
              <option key={environment.environmentId} value={environment.environmentId}>
                {environment.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="break-all text-sm text-muted-foreground">
        {preview
          ? trimmedName
            ? `Creates ${preview}`
            : `Goes in ${root}`
          : "No connected environment supports creating projects."}
      </p>
      <p className="text-xs text-muted-foreground">
        Creates a local Git repository with a README and project icon. Publish it separately from
        the Git menu.
      </p>
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => openCommandPalette({ open: "add-project" })}
        >
          Add existing project
        </Button>
        <Button type="submit" disabled={!root || !trimmedName || pending}>
          {pending ? "Creating…" : "Create project"}
        </Button>
      </div>
    </form>
  );
}
