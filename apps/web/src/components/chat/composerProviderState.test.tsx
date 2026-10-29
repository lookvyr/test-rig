import { describe, expect, it } from "vite-plus/test";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
  type ServerProviderModel,
} from "@t3tools/contracts";
import {
  getComposerPromptInjectionState,
  getComposerProviderState,
  getComposerReasoningStep,
  renderProviderTraitsMenuContent,
  renderProviderTraitsPicker,
} from "./composerProviderState";

// Everything in composerProviderState is now data-driven by the model's
// optionDescriptors, so these tests use a single synthetic provider/model and
// vary only the descriptor shape per scenario.

const PROVIDER: ProviderDriverKind = ProviderDriverKind.make("codex");
const MODEL = "test-model";

function selectDescriptor(
  id: string,
  options: ReadonlyArray<{ id: string; label: string; isDefault?: boolean }>,
  promptInjectedValues?: ReadonlyArray<string>,
): Extract<ProviderOptionDescriptor, { type: "select" }> {
  const defaultId = options.find((option) => option.isDefault)?.id;
  return {
    id,
    label: id,
    type: "select",
    options: [...options],
    ...(defaultId ? { currentValue: defaultId } : {}),
    ...(promptInjectedValues && promptInjectedValues.length > 0
      ? { promptInjectedValues: [...promptInjectedValues] }
      : {}),
  };
}

function booleanDescriptor(id: string): Extract<ProviderOptionDescriptor, { type: "boolean" }> {
  return { id, label: id, type: "boolean" };
}

function modelWith(
  descriptors: ReadonlyArray<ProviderOptionDescriptor>,
): ReadonlyArray<ServerProviderModel> {
  return [
    { slug: MODEL, name: MODEL, isCustom: false, capabilities: { optionDescriptors: descriptors } },
  ];
}

function selections(
  ...entries: Array<[string, string | boolean]>
): ReadonlyArray<ProviderOptionSelection> {
  return entries.map(([id, value]) => ({ id, value }));
}

describe("getComposerReasoningStep", () => {
  const LEVELS = [
    { id: "low", label: "Low" },
    { id: "medium", label: "Medium", isDefault: true },
    { id: "high", label: "High" },
  ];
  const INSTANCE = ProviderInstanceId.make("codex");
  const CLAUDE = {
    provider: ProviderDriverKind.make("claudeAgent"),
    instanceId: ProviderInstanceId.make("claudeAgent"),
    models: modelWith([
      selectDescriptor(
        "effort",
        [
          { id: "medium", label: "Medium" },
          { id: "high", label: "High", isDefault: true },
          { id: "ultrathink", label: "Ultrathink" },
        ],
        ["ultrathink"],
      ),
    ]),
  };

  function step(input: Partial<Parameters<typeof getComposerReasoningStep>[0]>) {
    return getComposerReasoningStep({
      provider: PROVIDER,
      instanceId: INSTANCE,
      model: MODEL,
      models: modelWith([selectDescriptor("reasoningEffort", LEVELS)]),
      modelOptions: undefined,
      prompt: "Fix the bug",
      cursor: 0,
      direction: 1,
      ...input,
    });
  }

  it("ignores models without a multi-level reasoning control", () => {
    expect(step({ models: [] })).toBeNull();
    expect(step({ models: modelWith([selectDescriptor("contextWindow", LEVELS)]) })).toBeNull();
    expect(step({ models: modelWith([selectDescriptor("effort", [LEVELS[0]!])]) })).toBeNull();
  });

  it("walks the catalog order, wrapping at both ends and keeping the other traits", () => {
    const models = modelWith([
      selectDescriptor("contextWindow", [
        { id: "200k", label: "200k", isDefault: true },
        { id: "1m", label: "1M" },
      ]),
      selectDescriptor("reasoningEffort", LEVELS),
    ]);
    for (const [from, direction, to] of [
      ["low", -1, "high"],
      ["low", 1, "medium"],
      ["high", 1, "low"],
      ["high", -1, "medium"],
    ] as const) {
      expect(
        step({
          models,
          modelOptions: selections(["contextWindow", "1m"], ["reasoningEffort", from]),
          direction,
        }),
        `${from} by ${direction}`,
      ).toStrictEqual({
        prompt: "Fix the bug",
        cursor: 0,
        modelOptions: selections(["contextWindow", "1m"], ["reasoningEffort", to]),
      });
    }
  });

  it("adds and strips the Ultrathink prefix while the caret stays on the same character", () => {
    for (const { prompt, modelOptions, direction, expected } of [
      {
        prompt: "  Fix the bug \n",
        modelOptions: selections(["effort", "high"]),
        direction: 1,
        expected: { prompt: "Ultrathink:\nFix the bug", cursor: 20 },
      },
      {
        // The prefix, not the draft's Medium, is the current level.
        prompt: "Ultrathink:\n  Fix the bug",
        modelOptions: selections(["effort", "medium"]),
        direction: -1,
        expected: {
          prompt: "Fix the bug",
          cursor: 8,
          modelOptions: selections(["effort", "high"]),
        },
      },
    ] as const) {
      const result = step({
        ...CLAUDE,
        prompt,
        cursor: prompt.indexOf("bug"),
        modelOptions,
        direction,
      });
      expect(result).toStrictEqual(expected);
      expect(result?.prompt.slice(result.cursor)).toMatch(/^bug/);
    }
    // A caret in leading whitespace must not land inside the new prefix.
    expect(
      step({ ...CLAUDE, prompt: "   Fix", modelOptions: selections(["effort", "high"]) })?.cursor,
    ).toBe("Ultrathink:\n".length);
  });

  it("skips Ultrathink for slash commands and does nothing when the prompt locks it", () => {
    expect(
      step({ ...CLAUDE, prompt: "/review", modelOptions: selections(["effort", "high"]) }),
    ).toStrictEqual({
      prompt: "/review",
      cursor: 0,
      modelOptions: selections(["effort", "medium"]),
    });
    for (const [prompt, direction] of [
      ["Please ultrathink harder", 1],
      ["Ultrathink:\nPlease ultrathink harder", -1],
    ] as const) {
      expect(
        step({ ...CLAUDE, prompt, modelOptions: selections(["effort", "high"]), direction }),
        prompt,
      ).toBeNull();
    }
  });

  it("steps from the provider-reported level for the same instance and model", () => {
    const reported = {
      instanceId: INSTANCE,
      model: MODEL,
      options: selections(["reasoningEffort", "high"]),
    };
    for (const { label, modelOptions, reportedModelSelection, to } of [
      { label: "reported", modelOptions: undefined, reportedModelSelection: reported, to: "low" },
      {
        label: "other instance",
        modelOptions: undefined,
        reportedModelSelection: { ...reported, instanceId: ProviderInstanceId.make("codex-work") },
        to: "high",
      },
      {
        label: "other model",
        modelOptions: undefined,
        reportedModelSelection: { ...reported, model: "other-model" },
        to: "high",
      },
      {
        label: "explicit draft",
        modelOptions: selections(["reasoningEffort", "low"]),
        reportedModelSelection: reported,
        to: "medium",
      },
      {
        label: "reported value outside the catalog",
        modelOptions: undefined,
        reportedModelSelection: {
          ...reported,
          options: selections(["reasoningEffort", "default"]),
        },
        to: "high",
      },
    ]) {
      expect(step({ modelOptions, reportedModelSelection })?.modelOptions, label).toStrictEqual(
        selections(["reasoningEffort", to]),
      );
    }
  });
});

const ULTRATHINK_FRAME_CLASSES = {
  composerFrameClassName: "ultrathink-frame",
  composerSurfaceClassName: "shadow-[0_0_0_1px_rgba(255,255,255,0.07)_inset]",
  modelPickerIconClassName: "ultrathink-chroma",
} as const;

describe("getComposerProviderState", () => {
  it("derives a stable prompt injection state for ordinary prompt edits", () => {
    expect(getComposerPromptInjectionState("Investigate this failure")).toBe("none");
    expect(getComposerPromptInjectionState("Ultrathink:\nInvestigate this failure")).toBe(
      "ultrathink",
    );
  });

  it("returns descriptor defaults when no selections are provided", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor("effort", [
          { id: "low", label: "Low" },
          { id: "high", label: "High", isDefault: true },
        ]),
      ]),
      modelOptions: undefined,
    });

    expect(state).toEqual({
      provider: PROVIDER,
      promptEffort: "high",
      modelOptionsForDispatch: selections(["effort", "high"]),
    });
  });

  it("lets selections override defaults and propagates them through dispatch", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor("effort", [
          { id: "low", label: "Low" },
          { id: "high", label: "High", isDefault: true },
        ]),
        booleanDescriptor("fastMode"),
      ]),
      modelOptions: selections(["effort", "low"], ["fastMode", true]),
    });

    expect(state).toEqual({
      provider: PROVIDER,
      promptEffort: "low",
      modelOptionsForDispatch: selections(["effort", "low"], ["fastMode", true]),
    });
  });

  it("preserves selections that match defaults so deepMerge can overwrite prior state", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor("effort", [{ id: "high", label: "High", isDefault: true }]),
        booleanDescriptor("fastMode"),
      ]),
      modelOptions: selections(["effort", "high"], ["fastMode", false]),
    });

    expect(state.modelOptionsForDispatch).toEqual(
      selections(["effort", "high"], ["fastMode", false]),
    );
  });

  it("drops selections for descriptors the model does not declare", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([booleanDescriptor("thinking")]),
      modelOptions: selections(["effort", "max"], ["thinking", false]),
    });

    expect(state).toEqual({
      provider: PROVIDER,
      promptEffort: null,
      modelOptionsForDispatch: selections(["thinking", false]),
    });
  });

  it("derives promptEffort from the first select descriptor and preserves all others for dispatch", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor("effort", [{ id: "high", label: "High", isDefault: true }]),
        selectDescriptor("contextWindow", [
          { id: "200k", label: "200k", isDefault: true },
          { id: "1m", label: "1M" },
        ]),
        selectDescriptor("agent", [
          { id: "build", label: "Build", isDefault: true },
          { id: "plan", label: "Plan" },
        ]),
      ]),
      modelOptions: selections(["agent", "plan"]),
    });

    expect(state.promptEffort).toBe("high");
    expect(state.modelOptionsForDispatch).toEqual(
      selections(["effort", "high"], ["contextWindow", "200k"], ["agent", "plan"]),
    );
  });

  it("returns undefined dispatch options when the model declares no descriptors", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([]),
      modelOptions: selections(["anything", "value"]),
    });

    expect(state).toEqual({
      provider: PROVIDER,
      promptEffort: null,
      modelOptionsForDispatch: undefined,
    });
  });

  it("adds ultrathink class names when the prompt triggers a promptInjectedValues descriptor", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor(
          "effort",
          [
            { id: "medium", label: "Medium" },
            { id: "high", label: "High", isDefault: true },
            { id: "ultrathink", label: "Ultrathink" },
          ],
          ["ultrathink"],
        ),
      ]),
      promptInjectionState: getComposerPromptInjectionState(
        "Ultrathink:\nInvestigate this failure",
      ),
      modelOptions: selections(["effort", "medium"]),
    });

    expect(state).toEqual({
      provider: PROVIDER,
      promptEffort: "medium",
      modelOptionsForDispatch: selections(["effort", "medium"]),
      ...ULTRATHINK_FRAME_CLASSES,
    });
  });

  it("does not add ultrathink class names when the descriptor has no promptInjectedValues", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor("effort", [{ id: "high", label: "High", isDefault: true }]),
      ]),
      promptInjectionState: getComposerPromptInjectionState(
        "Ultrathink:\nInvestigate this failure",
      ),
      modelOptions: undefined,
    });

    expect(state).not.toHaveProperty("composerFrameClassName");
    expect(state).not.toHaveProperty("composerSurfaceClassName");
    expect(state).not.toHaveProperty("modelPickerIconClassName");
  });
});

describe("provider traits render guards", () => {
  it("returns null when no thread target is provided", () => {
    const models = modelWith([
      selectDescriptor("effort", [{ id: "high", label: "High", isDefault: true }]),
    ]);
    const args = {
      provider: PROVIDER,
      model: MODEL,
      models,
      modelOptions: undefined,
      prompt: "",
      onPromptChange: () => {},
    };

    expect(renderProviderTraitsPicker(args)).toBeNull();
    expect(renderProviderTraitsMenuContent(args)).toBeNull();
  });
});
