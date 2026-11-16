import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { formatThreadLink, parseThreadLinkHref } from "./threadLinks.ts";

const environmentId = EnvironmentId.make("env-1");
const threadId = ThreadId.make("thread-1");

describe("thread links", () => {
  it("round-trips v2 links and reads v1 links without an environment", () => {
    expect(formatThreadLink({ environmentId, threadId }, "Fix [login]\nbug")).toBe(
      "[Fix login bug](t3-thread://v2/env-1/thread-1)",
    );
    expect(parseThreadLinkHref("t3-thread://v2/env-1/thread-1")).toEqual({
      environmentId,
      threadId,
    });
    expect(parseThreadLinkHref("t3-thread://v1/thread-1")).toEqual({
      environmentId: null,
      threadId,
    });
  });

  it("autolinks without a label and brackets hrefs with parentheses", () => {
    expect(formatThreadLink({ environmentId: null, threadId })).toBe("<t3-thread://v1/thread-1>");
    expect(formatThreadLink({ environmentId, threadId: ThreadId.make("task(1)") }, "Task")).toBe(
      "[Task](<t3-thread://v2/env-1/task(1)>)",
    );
  });

  it("rejects other schemes and malformed paths", () => {
    expect(parseThreadLinkHref("https://example.com")).toBeNull();
    expect(parseThreadLinkHref("t3-thread://v2/env-only")).toBeNull();
    expect(parseThreadLinkHref("t3-thread://v1/")).toBeNull();
  });
});
