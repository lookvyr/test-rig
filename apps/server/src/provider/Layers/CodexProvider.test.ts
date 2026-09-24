import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { CodexSettings } from "@t3tools/contracts";

import {
  applyPreferredCodexDefaultModel,
  checkCodexProviderStatus,
  isLegacyCodexModel,
  mapCodexModelCapabilities,
} from "./CodexProvider.ts";

const settings = Schema.decodeSync(CodexSettings)({});

it.layer(NodeServices.layer)("Codex CLI compatibility", (it) => {
  const checkVersion = (version: string | undefined, requiresLogin = false) =>
    checkCodexProviderStatus(settings, () =>
      Effect.succeed({
        version,
        account: { account: null, requiresOpenaiAuth: requiresLogin },
        models: [],
        skills: [],
      }),
    );

  it.effect("reports versions without the required history and revert protocol", () =>
    Effect.gen(function* () {
      for (const version of ["0.155.0", "0.156.0-alpha.1"]) {
        const provider = yield* checkVersion(version);
        assert.strictEqual(provider.status, "error");
        assert.include(provider.message, "requires v0.156.0 or newer");
      }
    }),
  );

  it.effect("accepts the baseline, tested release, and future releases", () =>
    Effect.gen(function* () {
      for (const version of ["0.156.0", "0.156.1", "0.157.0", "1.0.0"]) {
        const provider = yield* checkVersion(version);
        assert.strictEqual(provider.status, "ready");
        assert.strictEqual(provider.message, undefined);
      }
    }),
  );

  it.effect("keeps an unknown version ready with explanatory guidance", () =>
    Effect.gen(function* () {
      for (const version of [undefined, "development"]) {
        const provider = yield* checkVersion(version);
        assert.strictEqual(provider.status, "ready");
        assert.include(provider.message, "Unable to determine Codex CLI version");
      }
    }),
  );

  it.effect("keeps login errors actionable before checking compatibility", () =>
    Effect.gen(function* () {
      const provider = yield* checkVersion("0.155.0", true);
      assert.strictEqual(provider.status, "error");
      assert.strictEqual(provider.auth.status, "unauthenticated");
      assert.include(provider.message, "codex login");
    }),
  );

  it.effect("labels newly reported ChatGPT plan variants", () =>
    Effect.gen(function* () {
      for (const [planType, label] of [
        ["edu_plus", "ChatGPT Edu Subscription"],
        ["edu_pro", "ChatGPT Edu Subscription"],
        ["ent26", "ChatGPT Enterprise Subscription"],
        ["enterprise_cbp_automation", "ChatGPT Enterprise Subscription"],
        ["self_serve_business_prolite", "ChatGPT Business Subscription"],
      ] as const) {
        const provider = yield* checkCodexProviderStatus(settings, () =>
          Effect.succeed({
            version: "0.156.1",
            account: {
              account: { type: "chatgpt", email: "test@example.com", planType },
              requiresOpenaiAuth: true,
            },
            models: [],
            skills: [],
          }),
        );
        assert.strictEqual(provider.auth.label, label);
      }
    }),
  );
});

it("keeps discovered current and unfamiliar models visible", () => {
  for (const model of ["gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "gpt-7-sol", "custom-model"]) {
    assert.strictEqual(isLegacyCodexModel(model), false, model);
  }
});

it("groups older GPT families under legacy models", () => {
  for (const model of [
    "gpt-5.6-luna",
    "gpt-5.6-terra",
    "gpt-5.6-sol",
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5.3-codex",
    "gpt-5-codex",
    "gpt-4.1",
  ]) {
    assert.strictEqual(isLegacyCodexModel(model), true, model);
  }
});

it("maps current Codex model capability fields", () => {
  const capabilities = mapCodexModelCapabilities({
    additionalSpeedTiers: [],
    defaultReasoningEffort: "super-high",
    description: "Test model",
    displayName: "GPT Test",
    hidden: false,
    id: "gpt-test",
    isDefault: true,
    model: "gpt-test",
    defaultServiceTier: "flex",
    serviceTiers: [
      {
        id: "priority",
        name: "Fast",
        description: "Lower latency responses.",
      },
      {
        id: "flex",
        name: "Flex",
        description: "Lower-cost asynchronous routing.",
      },
    ],
    supportedReasoningEfforts: [
      {
        description: "Maximum reasoning",
        reasoningEffort: "super-high",
      },
    ],
  });

  assert.deepStrictEqual(capabilities.optionDescriptors, [
    {
      id: "reasoningEffort",
      label: "Reasoning",
      type: "select",
      options: [{ id: "super-high", label: "super-high", isDefault: true }],
      currentValue: "super-high",
    },
    {
      id: "serviceTier",
      label: "Service Tier",
      type: "select",
      options: [
        { id: "default", label: "Standard" },
        {
          id: "priority",
          label: "Fast",
          description: "Lower latency responses.",
        },
        {
          id: "flex",
          label: "Flex",
          description: "Lower-cost asynchronous routing.",
          isDefault: true,
        },
      ],
      currentValue: "flex",
    },
  ]);
});

it("uses standard routing when the catalog has no default service tier", () => {
  const capabilities = mapCodexModelCapabilities({
    additionalSpeedTiers: ["fast"],
    defaultReasoningEffort: "medium",
    defaultServiceTier: null,
    description: "Test model",
    displayName: "GPT Test",
    hidden: false,
    id: "gpt-test",
    isDefault: true,
    model: "gpt-test",
    serviceTiers: [
      {
        id: "priority",
        name: "Fast",
        description: "1.5x speed, increased usage",
      },
    ],
    supportedReasoningEfforts: [],
  });

  assert.deepStrictEqual(capabilities.optionDescriptors, [
    {
      id: "serviceTier",
      label: "Service Tier",
      type: "select",
      options: [
        { id: "default", label: "Standard", isDefault: true },
        {
          id: "priority",
          label: "Fast",
          description: "1.5x speed, increased usage",
        },
      ],
      currentValue: "default",
    },
  ]);
});

it("marks the most preferred available model as default", () => {
  const models = applyPreferredCodexDefaultModel([
    { slug: "gpt-5.6-terra", name: "GPT-5.6-Terra", isCustom: false, capabilities: null },
    { slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, isDefault: true, capabilities: null },
  ]);

  assert.deepStrictEqual(
    models.map((model) => ({ slug: model.slug, isDefault: model.isDefault })),
    [
      { slug: "gpt-5.6-terra", isDefault: true },
      { slug: "gpt-5.4", isDefault: undefined },
    ],
  );
});

it("prefers sol over terra when both are available", () => {
  const models = applyPreferredCodexDefaultModel([
    { slug: "gpt-5.6-terra", name: "GPT-5.6-Terra", isCustom: false, capabilities: null },
    { slug: "gpt-5.6-sol", name: "GPT-5.6-Sol", isCustom: false, capabilities: null },
  ]);

  assert.deepStrictEqual(models.find((model) => model.isDefault)?.slug, "gpt-5.6-sol");
});

it("keeps Codex's own default when no preferred model is available", () => {
  const models = applyPreferredCodexDefaultModel([
    { slug: "gpt-5.5", name: "GPT-5.5", isCustom: false, capabilities: null },
    { slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, isDefault: true, capabilities: null },
  ]);

  assert.deepStrictEqual(models.find((model) => model.isDefault)?.slug, "gpt-5.4");
});

it("ignores custom models that shadow a preferred slug", () => {
  const models = applyPreferredCodexDefaultModel([
    { slug: "gpt-5.6-sol", name: "gpt-5.6-sol", isCustom: true, capabilities: null },
    { slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, isDefault: true, capabilities: null },
  ]);

  assert.deepStrictEqual(models.find((model) => model.isDefault)?.slug, "gpt-5.4");
});

it("prefers GPT-6 Sol over older defaults when available", () => {
  const models = applyPreferredCodexDefaultModel([
    {
      slug: "gpt-5.6-sol",
      name: "GPT-5.6-Sol",
      isCustom: false,
      isDefault: true,
      capabilities: null,
    },
    { slug: "gpt-6-sol", name: "GPT-6-Sol", isCustom: false, capabilities: null },
  ]);
  assert.deepStrictEqual(
    models.filter((model) => model.isDefault).map((model) => model.slug),
    ["gpt-6-sol"],
  );
});
