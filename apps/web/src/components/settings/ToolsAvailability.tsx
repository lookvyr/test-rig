import type { ProjectId, SkillLibraryProvider, ToolsScopeId } from "@t3tools/contracts";
import { ChevronDownIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { PROVIDER_CLIENT_DEFINITIONS } from "./providerDriverMeta";

export interface ToolsProject {
  id: ToolsScopeId;
  name: string;
  memberProjectIds: readonly ProjectId[];
  workspaceRoot: string;
}

/** A switch or provider change shown before its save lands. */
export interface ToolToggle {
  readonly enabled?: boolean;
  readonly providers?: readonly SkillLibraryProvider[];
}

const toggled = (providers: readonly SkillLibraryProvider[], provider: SkillLibraryProvider) =>
  providers.includes(provider)
    ? providers.filter((entry) => entry !== provider)
    : [...providers, provider];

/** Quiet per-row provider toggles: dim when off, a tooltip names each. */
export function ProviderIconToggles({
  providers,
  onChange,
  disabled = false,
}: {
  providers: readonly SkillLibraryProvider[];
  onChange: (providers: SkillLibraryProvider[]) => void;
  disabled?: boolean;
}) {
  return (
    <span className="flex shrink-0 items-center">
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
                  aria-label={label}
                  aria-pressed={checked}
                  onClick={() => onChange(toggled(providers, provider))}
                  className={cn(
                    "inline-flex size-7 items-center justify-center rounded-md outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none",
                    checked
                      ? "opacity-85 hover:opacity-100"
                      : "opacity-25 grayscale hover:opacity-60",
                  )}
                >
                  <Icon className="size-3.5" aria-hidden />
                </button>
              }
            />
            <TooltipPopup>{label}</TooltipPopup>
          </Tooltip>
        );
      })}
    </span>
  );
}

/** Labeled provider toggles for a tool's detail page. */
export function ProviderToggles({
  providers,
  onChange,
  disabled = false,
}: {
  providers: readonly SkillLibraryProvider[];
  onChange: (providers: SkillLibraryProvider[]) => void;
  disabled?: boolean;
}) {
  return (
    <span className="flex gap-1.5">
      {PROVIDER_CLIENT_DEFINITIONS.map(({ value, label, icon: Icon }) => {
        const provider = value as SkillLibraryProvider;
        const checked = providers.includes(provider);
        return (
          <button
            key={value}
            type="button"
            disabled={disabled}
            aria-pressed={checked}
            onClick={() => onChange(toggled(providers, provider))}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
              checked
                ? "border-primary/40 bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:bg-accent",
            )}
          >
            <Icon className={cn("size-3.5", !checked && "opacity-40 grayscale")} aria-hidden />
            {label}
          </button>
        );
      })}
    </span>
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

/** A label on the left, its control on the right. */
export function ToolField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center gap-4 px-3 py-2 sm:px-4">
      <span className="w-28 shrink-0 text-sm text-muted-foreground">{label}</span>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2">{children}</div>
    </div>
  );
}
