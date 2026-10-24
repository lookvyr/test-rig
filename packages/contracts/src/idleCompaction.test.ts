import { describe, expect, it } from "vite-plus/test";
import { idleCompactionOf, isCompactionCommandMessage } from "./orchestrationV2.ts";

describe("compaction message classification", () => {
  it("distinguishes manual, explicit idle, and legacy server compaction", () => {
    const manual = { role: "user", text: " \t\u00a0/COMPACT\u3000\n", attachments: [] };
    expect(isCompactionCommandMessage(manual)).toBe(true);
    expect(idleCompactionOf(manual)).toBeUndefined();
    expect(idleCompactionOf({ ...manual, idleCompaction: "onReturn" })).toBe("onReturn");
    expect(idleCompactionOf({ ...manual, idleCompaction: "beforeCacheExpires" })).toBe(
      "beforeCacheExpires",
    );
    expect(idleCompactionOf({ ...manual, createdBy: "agent", creationSource: "server" })).toBe(
      "beforeCacheExpires",
    );
  });

  it("does not classify attachments, ordinary prompts, or assistant output as compaction", () => {
    for (const message of [
      { role: "user", text: "/compact", attachments: [{}] },
      { role: "user", text: "Continue", attachments: [] },
      { role: "assistant", text: "/compact", attachments: [] },
    ]) {
      expect(isCompactionCommandMessage(message)).toBe(false);
      expect(idleCompactionOf({ ...message, idleCompaction: "onReturn" })).toBeUndefined();
    }
  });
});
