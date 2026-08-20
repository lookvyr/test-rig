import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  MODEL_SLUG_ALIASES_BY_PROVIDER,
  PROVIDER_DISPLAY_NAMES,
} from "./model.ts";

const APPROVED_DRIVERS = ["codex", "claudeAgent", "opencode"];

describe("built-in provider model metadata", () => {
  it("contains defaults and presentation only for approved executable providers", () => {
    expect(Object.keys(DEFAULT_MODEL_BY_PROVIDER)).toEqual(APPROVED_DRIVERS);
    expect(Object.keys(DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER)).toEqual(APPROVED_DRIVERS);
    expect(Object.keys(MODEL_SLUG_ALIASES_BY_PROVIDER)).toEqual(APPROVED_DRIVERS);
    expect(Object.keys(PROVIDER_DISPLAY_NAMES)).toEqual(APPROVED_DRIVERS);
  });
});
