import { describe, expect, it } from "@effect/vitest";

import { ProviderInstanceId, type ModelSelection } from "@t3tools/contracts";

import { compileClaudeModelSelection } from "./claudeModelOptions.ts";

const selection = (
  model: string,
  options: NonNullable<ModelSelection["options"]>,
): ModelSelection => ({
  instanceId: ProviderInstanceId.make("claude_test"),
  model,
  options,
});

describe("compileClaudeModelSelection", () => {
  it("preserves fixed context models when compiling saved context options and effort", () => {
    expect(
      compileClaudeModelSelection(
        selection("claude-fable-5", [
          { id: "contextWindow", value: "1m" },
          { id: "effort", value: "ultracode" },
        ]),
      ),
    ).toMatchObject({
      apiModelId: "claude-fable-5",
      effort: "xhigh",
      settings: { ultracode: true },
    });
  });

  it("treats omitted and explicit Normal identically while Fast stays distinct", () => {
    const omitted = compileClaudeModelSelection({
      instanceId: ProviderInstanceId.make("claude_test"),
      model: "claude-opus-4-6",
    });
    const normal = compileClaudeModelSelection(
      selection("claude-opus-4-6", [{ id: "fastMode", value: false }]),
    );
    const fast = compileClaudeModelSelection(
      selection("claude-opus-4-6", [{ id: "fastMode", value: true }]),
    );
    expect(omitted.queryIdentity).toEqual(normal.queryIdentity);
    expect(omitted.queryIdentity).not.toEqual(fast.queryIdentity);
    expect(omitted.settings).toEqual({ fastMode: false });
  });

  it("compiles fast mode only for models that expose it", () => {
    expect(
      compileClaudeModelSelection(selection("claude-opus-4-6", [{ id: "fastMode", value: true }]))
        .settings,
    ).toEqual({ fastMode: true });
    expect(
      compileClaudeModelSelection(selection("claude-opus-4-6", [{ id: "fastMode", value: false }]))
        .settings,
    ).toEqual({ fastMode: false });
  });

  it("falls back to model default effort for a saved Ultrathink selection without injecting a prefix", () => {
    expect(
      compileClaudeModelSelection(
        selection("claude-sonnet-4-6", [{ id: "effort", value: "ultrathink" }]),
      ),
    ).toMatchObject({ effort: "high", promptEffort: undefined });
  });

  it("compiles the thinking toggle for models that expose it", () => {
    expect(
      compileClaudeModelSelection(selection("claude-haiku-4-5", [{ id: "thinking", value: false }]))
        .settings,
    ).toEqual({ alwaysThinkingEnabled: false });
  });
});
