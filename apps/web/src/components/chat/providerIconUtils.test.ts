import { describe, expect, it } from "vite-plus/test";
import { getCompactModelName } from "./providerIconUtils";

describe("getCompactModelName", () => {
  it("drops the family the provider icon already shows", () => {
    expect(getCompactModelName({ slug: "claude-opus-5-5", name: "Claude Opus 5.5" })).toBe(
      "Opus 5.5",
    );
    expect(getCompactModelName({ slug: "gpt-6-sol", name: "GPT-6-Sol" })).toBe("6 Sol");
  });

  it("keeps the family when only a version would remain", () => {
    expect(getCompactModelName({ slug: "gpt-5.5", name: "GPT-5.5" })).toBe("GPT-5.5");
  });

  it("prefers an explicit short name", () => {
    expect(
      getCompactModelName({ slug: "custom", name: "Claude Custom", shortName: "Custom" }),
    ).toBe("Custom");
  });

  it("leaves names outside the known families alone", () => {
    expect(getCompactModelName({ slug: "o5", name: "o5" })).toBe("o5");
  });
});
