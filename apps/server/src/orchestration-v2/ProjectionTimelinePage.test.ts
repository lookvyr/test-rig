import { assert, describe, it } from "@effect/vitest";
import { TurnItemId } from "@t3tools/contracts";

import { selectTimelinePage } from "./ProjectionStore.ts";

const rows = Array.from({ length: 10 }, (_, position) => ({
  position,
  sourceItemId: TurnItemId.make(`item-${position}`),
  item: { type: position % 2 === 0 ? "user_message" : "command_execution" },
}));
const positions = (page: ReadonlyArray<{ readonly position: number }>) =>
  page.map((row) => row.position);

describe("selectTimelinePage", () => {
  it("pages forward from a position, oldest first", () => {
    const first = selectTimelinePage(rows, { afterPosition: -1, view: "activity", limit: 4 });
    assert.deepEqual(positions(first.page), [0, 1, 2, 3]);
    assert.isTrue(first.hasMore);
    assert.isFalse(first.hasEarlier);
    const next = selectTimelinePage(rows, { afterPosition: 7, view: "activity", limit: 4 });
    assert.deepEqual(positions(next.page), [8, 9]);
    assert.isFalse(next.hasMore);
    assert.isTrue(next.hasEarlier);
  });

  it("starts at the newest page and pages backward with beforePosition", () => {
    const newest = selectTimelinePage(rows, {
      beforePosition: Number.POSITIVE_INFINITY,
      view: "messages",
      limit: 2,
    });
    assert.deepEqual(positions(newest.page), [6, 8]);
    assert.isFalse(newest.hasMore);
    assert.isTrue(newest.hasEarlier);
    const earlier = selectTimelinePage(rows, { beforePosition: 6, view: "messages", limit: 2 });
    assert.deepEqual(positions(earlier.page), [2, 4]);
    assert.isTrue(earlier.hasMore);
    assert.isTrue(earlier.hasEarlier);
    const oldest = selectTimelinePage(rows, { beforePosition: 2, view: "messages", limit: 2 });
    assert.deepEqual(positions(oldest.page), [0]);
    assert.isFalse(oldest.hasEarlier);
  });

  it("reads one item by id whatever the cursor", () => {
    const one = selectTimelinePage(rows, {
      beforePosition: Number.POSITIVE_INFINITY,
      itemId: TurnItemId.make("item-3"),
      limit: 20,
    });
    assert.deepEqual(positions(one.page), [3]);
    assert.isFalse(one.hasMore);
  });
});
