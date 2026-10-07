import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { BrowserProfileId, resolveBrowserProfiles } from "./browserProfile.ts";

const decodeProfileId = Schema.decodeUnknownSync(BrowserProfileId);

describe("browser profiles", () => {
  it("keeps built-ins stable and removes identities that share a partition", () => {
    expect(
      resolveBrowserProfiles([
        { id: "default", name: "Override", kind: "persistent" },
        { id: "work", name: "Work", kind: "incognito" },
        { id: "work", name: "Duplicate", kind: "persistent" },
      ]),
    ).toEqual([
      { id: "default", name: "Default", kind: "persistent" },
      { id: "incognito", name: "Incognito", kind: "incognito" },
      { id: "work", name: "Work", kind: "persistent" },
    ]);
  });
  it("rejects control characters in partition ids", () => {
    expect(() => decodeProfileId("profile\u0000work")).toThrow();
  });
});
