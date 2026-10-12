import type { ServerProviderSkill } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  dedupeProviderSkillsByName,
  formatProviderSkillDisplayName,
  getProviderSkillsForSlashMenu,
  resolveProviderSkillSourceKind,
} from "./providerSkills.ts";

const native: ServerProviderSkill = {
  name: "review",
  path: "/repo/.agents/skills/review/SKILL.md",
  enabled: true,
};
const library: ServerProviderSkill = {
  name: "test-rig:12345678-1234-4234-8234-123456789abc",
  displayName: "review",
  path: "/state/skills/SKILL.md",
  enabled: true,
  source: "test-rig",
};

describe("library skill presentation", () => {
  it("preserves native and library skills with the same displayed name", () => {
    expect(dedupeProviderSkillsByName([native, library])).toEqual([native, library]);
    expect(getProviderSkillsForSlashMenu([native, library], true)).toEqual([native, library]);
    expect(formatProviderSkillDisplayName(library)).toBe("review");
  });

  it("recognizes library ownership without depending on a default state directory", () => {
    expect(resolveProviderSkillSourceKind(library)).toBe("app");
    expect(resolveProviderSkillSourceKind(native)).toBe("other");
  });
});
