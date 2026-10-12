import type { ProjectId, SkillLibraryProvider, ToolsScopeId } from "@t3tools/contracts";
import { ChevronDownIcon } from "lucide-react";
import { Checkbox } from "../ui/checkbox";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { PROVIDER_CLIENT_DEFINITIONS } from "./providerDriverMeta";

export interface ToolsProject {
  id: ToolsScopeId;
  name: string;
  memberProjectIds: readonly ProjectId[];
  workspaceRoot: string;
}

export function ProviderAvailability({
  providers,
  onChange,
  disabled = false,
}: {
  providers: readonly SkillLibraryProvider[];
  onChange: (providers: SkillLibraryProvider[]) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Providers</p>
      <div className="flex gap-2">
        {PROVIDER_CLIENT_DEFINITIONS.map(({ value, label, icon: Icon }) => {
          const provider = value as SkillLibraryProvider;
          const checked = providers.includes(provider);
          return (
            <Tooltip key={value}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    disabled={disabled}
                    aria-label={`${checked ? "Disable" : "Enable"} for ${label}`}
                    aria-pressed={checked}
                    onClick={() =>
                      onChange(
                        checked
                          ? providers.filter((entry) => entry !== provider)
                          : [...providers, provider],
                      )
                    }
                    className={`inline-flex size-10 items-center justify-center rounded-lg border transition-colors disabled:opacity-50 ${checked ? "border-primary/40 bg-primary/10 text-foreground" : "border-border text-muted-foreground/50 hover:bg-accent"}`}
                  >
                    <Icon className="size-5" aria-hidden />
                  </button>
                }
              />
              <TooltipPopup>{label}</TooltipPopup>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

export function ToolsSelect({
  value,
  onChange,
  options,
  label,
  disabled = false,
  compact = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  label: string;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (typeof next === "string") onChange(next);
      }}
      items={options}
    >
      <SelectTrigger
        aria-label={label}
        className={compact ? "w-auto min-w-36 max-w-[min(70vw,24rem)] px-3" : "min-w-44 px-3"}
        icon={<ChevronDownIcon className="size-3 opacity-60" />}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectPopup alignItemWithTrigger={false}>
        {options.map((entry) => (
          <SelectItem key={entry.value} value={entry.value}>
            {entry.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

export function ProjectChoices({
  projects,
  selected,
  onChange,
  disabled = false,
}: {
  projects: readonly ToolsProject[];
  selected: readonly ToolsScopeId[];
  onChange: (value: ToolsScopeId[]) => void;
  disabled?: boolean;
}) {
  return (
    <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border p-3">
      {projects.length === 0 ? (
        <p className="text-sm text-muted-foreground">No projects available.</p>
      ) : (
        projects.map((project) => (
          <label key={project.id} className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              disabled={disabled}
              checked={selected.includes(project.id)}
              onCheckedChange={(checked) =>
                onChange(
                  checked ? [...selected, project.id] : selected.filter((id) => id !== project.id),
                )
              }
            />
            {project.name}
          </label>
        ))
      )}
    </div>
  );
}
