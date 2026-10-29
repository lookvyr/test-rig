import { assert, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import { ProjectId } from "./baseSchemas.ts";
import { ToolsScopeId } from "./toolsScope.ts";
import {
  SkillLibrarySummary,
  SkillLibraryUpsertInput,
  isSkillLibrarySkillAvailable,
} from "./skillLibrary.ts";

const isSkillInput = Schema.is(SkillLibraryUpsertInput);
const decodeSummary = Schema.decodeUnknownSync(SkillLibrarySummary);
const encodeSummary = Schema.encodeSync(SkillLibrarySummary);

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
    isSkillLibrarySkillAvailable(explicitlyEnabled, second, "unsupported", scope, [second]),
  );
});

it("filters provider and project assignments, including global project exceptions", () => {
  assert.equal(isSkillLibrarySkillAvailable(skill, first, "codex"), true);
  assert.equal(isSkillLibrarySkillAvailable(skill, second, "codex"), false);
  assert.equal(isSkillLibrarySkillAvailable(skill, first, "unsupported"), false);
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
  assert.equal(isSkillInput(input), true);
  assert.equal(isSkillInput({ ...input, id: "../outside" }), false);
  assert.equal(isSkillInput({ ...input, providers: ["cursor"] }), false);
  assert.equal(isSkillInput({ ...input, name: " " }), false);
});

it("keeps stored skills assigned to retained providers and rewrites the old default", () => {
  const summary = decodeSummary({
    id: "11111111-1111-4111-8111-111111111111",
    name: "Review",
    description: "",
    path: "/skills/review/SKILL.md",
    createdAt: "2026-10-29T00:00:00.000Z",
    updatedAt: "2026-10-29T00:00:00.000Z",
    providers: ["codex", "claudeAgent", "opencode"],
    assignment: skill.assignment,
  });
  assert.deepEqual(summary.providers, ["codex", "claudeAgent"]);
  assert.deepEqual(encodeSummary(summary).providers, ["codex", "claudeAgent"]);
  assert.isFalse(isSkillInput({ ...summary, instructions: "Review", providers: ["opencode"] }));
});
