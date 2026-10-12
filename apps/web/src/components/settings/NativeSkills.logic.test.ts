import { describe, expect, it } from "vite-plus/test";
import {
  ProviderInstanceId,
  ProviderDriverKind,
  type ServerProvider,
  type ServerProviderSkill,
} from "@t3tools/contracts";
import { groupNativeSkills } from "./NativeSkills.logic";

const codex: ServerProvider = {
  instanceId: ProviderInstanceId.make("codex"),
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-10-12T00:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
};
const claude: ServerProvider = {
  ...codex,
  instanceId: ProviderInstanceId.make("claudeAgent"),
  driver: ProviderDriverKind.make("claudeAgent"),
};
const skill: ServerProviderSkill = {
  name: "review",
  path: "/repo/.agents/skills/review/SKILL.md",
  canonicalPath: "/repo/.agents/skills/review/SKILL.md",
  enabled: true,
};

describe("outside skill grouping", () => {
  it("groups symlink aliases and keeps all providers and an original source path", () => {
    const groups = groupNativeSkills([
      { provider: codex, skills: [skill] },
      { provider: claude, skills: [{ ...skill, path: "/repo/.claude/skills/review/SKILL.md" }] },
    ]);
    expect(groups).toEqual([{ skill, providers: [codex, claude] }]);
  });
  it("keeps same-name independent files separate", () => {
    const other = {
      ...skill,
      path: "/other/review/SKILL.md",
      canonicalPath: "/other/review/SKILL.md",
    };
    expect(groupNativeSkills([{ provider: codex, skills: [skill, other] }])).toHaveLength(2);
  });
  it("falls back to original paths and does not repeat a provider or include library skills", () => {
    const native = { name: "review", path: skill.path, enabled: true };
    const groups = groupNativeSkills([
      { provider: codex, skills: [native, native, { ...skill, source: "test-rig" }] },
      { provider: claude, skills: [native] },
    ]);
    expect(groups).toEqual([{ skill: native, providers: [codex, claude] }]);
  });
  it("does not mutate the provider's catalogue", () => {
    const catalogues = [{ provider: codex, skills: Object.freeze([Object.freeze(skill)]) }];
    groupNativeSkills(catalogues);
    expect(catalogues[0]!.skills).toEqual([skill]);
  });
});
