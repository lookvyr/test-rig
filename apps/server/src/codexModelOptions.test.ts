import { assert, it } from "@effect/vitest";

import { ProviderInstanceId } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";

import { getCodexServiceTierOptionValue } from "./codexModelOptions.ts";

it("returns the selected Codex service tier id", () => {
  const selection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.5", [
    { id: "serviceTier", value: "flex" },
  ]);

  assert.equal(getCodexServiceTierOptionValue(selection), "flex");
});

it("keeps legacy persisted fast mode selections working", () => {
  const selection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4", [
    { id: "fastMode", value: true },
  ]);

  assert.equal(getCodexServiceTierOptionValue(selection), "fast");
});

it("explicitly selects Standard when speed was not requested", () => {
  assert.equal(getCodexServiceTierOptionValue(undefined), "default");
  for (const options of [
    [],
    [{ id: "reasoningEffort", value: "high" }],
    [{ id: "fastMode", value: false }],
  ]) {
    const selection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-6-sol", options);
    assert.equal(getCodexServiceTierOptionValue(selection), "default");
  }
});

it.each(["fast", "priority", "flex", "default"])(
  "preserves an explicit %s tier over legacy fastMode",
  (value) => {
    const selection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-6-sol", [
      { id: "serviceTier", value },
      { id: "fastMode", value: true },
    ]);
    assert.equal(getCodexServiceTierOptionValue(selection), value);
  },
);
