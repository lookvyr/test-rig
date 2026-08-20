import { describe, expect, it } from "vite-plus/test";

import { resolveOpenInOptions } from "./OpenInPicker";

describe("resolveOpenInOptions", () => {
  it("keeps Cursor available as an editor integration", () => {
    expect(
      resolveOpenInOptions("MacIntel", ["cursor"]).map(({ label, value }) => ({ label, value })),
    ).toEqual([{ label: "Cursor", value: "cursor" }]);
  });
});
