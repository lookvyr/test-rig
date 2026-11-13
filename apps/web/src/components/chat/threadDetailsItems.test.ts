import { describe, expect, it } from "vite-plus/test";

import {
  isDefaultThreadDetailsVisibility,
  resolveThreadDetailsVisibility,
  setThreadDetailsItem,
  THREAD_DETAILS_ITEMS,
} from "./threadDetailsItems";

const servers = THREAD_DETAILS_ITEMS.find((item) => item.id === "servers")!;

describe("thread details items", () => {
  it("uses defaults for missing ids and keeps unknown ids out of the result", () => {
    const visibility = resolveThreadDetailsVisibility({
      threadDetailsItems: { servers: false, usage: true },
    });
    expect(visibility.servers).toBe(false);
    expect(visibility.context).toBe(true);
    expect("usage" in visibility).toBe(false);
    expect(isDefaultThreadDetailsVisibility(visibility)).toBe(false);
    expect(
      isDefaultThreadDetailsVisibility(resolveThreadDetailsVisibility({ threadDetailsItems: {} })),
    ).toBe(true);
  });

  it("stores only choices that differ from the default", () => {
    expect(setThreadDetailsItem({ threadDetailsItems: {} }, servers, false)).toEqual({
      servers: false,
    });
    expect(setThreadDetailsItem({ threadDetailsItems: { servers: false } }, servers, true)).toEqual(
      {},
    );
    // Ids this build doesn't know survive, so a downgrade or upstream setting is kept.
    expect(
      setThreadDetailsItem({ threadDetailsItems: { gitActions: false } }, servers, false),
    ).toEqual({ gitActions: false, servers: false });
  });
});
