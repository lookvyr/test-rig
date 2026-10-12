import type { ServerProvider, ServerProviderSkill } from "@t3tools/contracts";

/** Group discoveries by source file, retaining a provider path for opening each source. */
export function groupNativeSkills(
  catalogues: readonly { provider: ServerProvider; skills: readonly ServerProviderSkill[] }[],
) {
  const groups = new Map<string, { skill: ServerProviderSkill; providers: ServerProvider[] }>();
  for (const { provider, skills } of catalogues) {
    for (const skill of skills) {
      if (skill.source === "test-rig") continue;
      const key = skill.canonicalPath ?? skill.path;
      const existing = groups.get(key);
      if (existing) {
        if (!existing.providers.some((entry) => entry.instanceId === provider.instanceId))
          existing.providers.push(provider);
      } else {
        groups.set(key, { skill, providers: [provider] });
      }
    }
  }
  return [...groups.values()];
}
