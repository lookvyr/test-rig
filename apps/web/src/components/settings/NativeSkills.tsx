import { useMemo, useState } from "react";
import type {
  EnvironmentId,
  ServerProvider,
  SkillLibrarySourceReadInput,
} from "@t3tools/contracts";
import { useEnvironmentQueries } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import {
  formatProviderSkillDisplayName,
  resolveProviderSkillSourceKind,
} from "@t3tools/client-runtime/providerSkills";

/** Provider discovery stays read-only; opening a source verifies it on the server. */
export function NativeSkills({
  environmentId,
  cwd,
  providers,
  onOpen,
}: {
  environmentId: EnvironmentId;
  cwd: string;
  providers: readonly ServerProvider[];
  onOpen: (input: SkillLibrarySourceReadInput) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const enabledProviders = useMemo(
    () => providers.filter((provider) => provider.enabled && provider.installed),
    [providers],
  );
  const queries = useMemo(
    () =>
      expanded
        ? enabledProviders.map((provider) =>
            serverEnvironment.providerWorkspaceCatalog({
              environmentId,
              input: { instanceId: provider.instanceId, cwd },
            }),
          )
        : [],
    [expanded, environmentId, cwd, enabledProviders],
  );
  const catalogues = useEnvironmentQueries(queries);
  const seen = new Set<string>();
  const skills = catalogues.flatMap((catalogue, index) =>
    (catalogue.data?.skills ?? []).flatMap((skill) => {
      if (skill.source === "test-rig" || seen.has(skill.path)) return [];
      seen.add(skill.path);
      return [{ skill, provider: enabledProviders[index]! }];
    }),
  );
  return (
    <details
      onToggle={(event) => setExpanded(event.currentTarget.open)}
      className="px-3 text-sm sm:px-4"
    >
      <summary className="cursor-pointer rounded-md py-2 text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Found outside Test Rig
      </summary>
      <div className="space-y-1 pt-2">
        {skills.map(({ skill, provider }) => (
          <button
            key={skill.path}
            type="button"
            className="block w-full rounded-lg px-3 py-3 text-left hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() => onOpen({ instanceId: provider.instanceId, cwd, sourcePath: skill.path })}
          >
            <span className="flex flex-wrap items-baseline gap-2">
              <span className="font-medium">{formatProviderSkillDisplayName(skill)}</span>
              <span className="text-xs text-muted-foreground">
                {resolveProviderSkillSourceKind(skill)} · {provider.displayName ?? provider.driver}
              </span>
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">{skill.description}</span>
          </button>
        ))}
        {catalogues.some((entry) => entry.error) ? (
          <p role="alert" className="text-xs text-destructive">
            Some provider skills could not be loaded.
          </p>
        ) : skills.length === 0 ? (
          <p className="py-3 text-xs text-muted-foreground">
            {catalogues.some((entry) => entry.isPending)
              ? "Loading provider skills…"
              : "No outside skills found for this project."}
          </p>
        ) : null}
      </div>
    </details>
  );
}
