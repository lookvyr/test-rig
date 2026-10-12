import { assert, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import { ProjectId } from "./baseSchemas.ts";
import { ToolsScopeId } from "./toolsScope.ts";
import { SkillLibraryUpsertInput, isSkillLibrarySkillAvailable } from "./skillLibrary.ts";

const first = ProjectId.make("first");
const second = ProjectId.make("second");
const skill = {
  providers: ["codex" as const, "claudeAgent" as const],
  assignment: { allProjects: false, projectIds: [first], disabledProjectIds: [] },
};

it("uses repository scope choices before legacy workspace assignments", () => {
  const scope = ToolsScopeId.make(`git:${"a".repeat(64)}`);
  assert.isTrue(isSkillLibrarySkillAvailable(skill, second, "codex", scope, [first, second]));
  const explicitlyDisabled = {
    ...skill,
    assignment: { ...skill.assignment, disabledScopeIds: [scope] },
  };
  assert.isFalse(
    isSkillLibrarySkillAvailable(explicitlyDisabled, first, "codex", scope, [first, second]),
  );
  const explicitlyEnabled = {
    ...skill,
    assignment: { ...skill.assignment, projectIds: [], scopeIds: [scope] },
  };
  assert.isTrue(isSkillLibrarySkillAvailable(explicitlyEnabled, second, "codex", scope, [second]));
  assert.isFalse(
    isSkillLibrarySkillAvailable(explicitlyEnabled, second, "opencode", scope, [second]),
  );
});

it("filters provider and project assignments, including global project exceptions", () => {
  assert.equal(isSkillLibrarySkillAvailable(skill, first, "codex"), true);
  assert.equal(isSkillLibrarySkillAvailable(skill, second, "codex"), false);
  assert.equal(isSkillLibrarySkillAvailable(skill, first, "opencode"), false);
  assert.equal(isSkillLibrarySkillAvailable(skill, null, "codex"), false);
  const global = {
    ...skill,
    assignment: { allProjects: true, projectIds: [], disabledProjectIds: [second] },
  };
  assert.equal(isSkillLibrarySkillAvailable(global, first, "claudeAgent"), true);
  assert.equal(isSkillLibrarySkillAvailable(global, second, "codex"), false);
  assert.equal(
    isSkillLibrarySkillAvailable(
      { ...skill, assignment: { ...skill.assignment, projectIds: [] } },
      first,
      "codex",
    ),
    false,
  );
});

it("rejects unsafe IDs and excluded providers while allowing unassigned skills", () => {
  const input = {
    name: "Review notes",
    description: "",
    instructions: "# Review",
    providers: [],
    assignment: { allProjects: false, projectIds: [], disabledProjectIds: [] },
  };
  assert.equal(Schema.is(SkillLibraryUpsertInput)(input), true);
  assert.equal(Schema.is(SkillLibraryUpsertInput)({ ...input, id: "../outside" }), false);
  assert.equal(Schema.is(SkillLibraryUpsertInput)({ ...input, providers: ["cursor"] }), false);
  assert.equal(Schema.is(SkillLibraryUpsertInput)({ ...input, name: " " }), false);
});
