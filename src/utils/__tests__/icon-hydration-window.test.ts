import { describe, expect, it } from "vitest";

import { collectVisibleGridHydrationTargets } from "../icon-hydration-window";

describe("collectVisibleGridHydrationTargets", () => {
  it("returns only the visible rows plus buffer rows", () => {
    const targets = collectVisibleGridHydrationTargets({
      categoryId: "cat-1",
      itemIds: Array.from({ length: 40 }, (_, index) => `item-${index + 1}`),
      cols: 5,
      scrollTop: 240,
      clientHeight: 220,
      rowHeight: 120,
      bufferRows: 1,
    });

    expect(targets.map((target) => target.itemId)).toEqual([
      "item-6",
      "item-7",
      "item-8",
      "item-9",
      "item-10",
      "item-11",
      "item-12",
      "item-13",
      "item-14",
      "item-15",
      "item-16",
      "item-17",
      "item-18",
      "item-19",
      "item-20",
      "item-21",
      "item-22",
      "item-23",
      "item-24",
      "item-25",
    ]);
  });

  it("falls back to a bounded head slice when viewport metrics are unavailable", () => {
    const targets = collectVisibleGridHydrationTargets({
      categoryId: "cat-1",
      itemIds: Array.from({ length: 50 }, (_, index) => `item-${index + 1}`),
      cols: 4,
      scrollTop: 0,
      clientHeight: 0,
      rowHeight: 0,
      bufferRows: 2,
      fallbackVisibleRows: 3,
    });

    expect(targets).toHaveLength(20);
    expect(targets[0]).toEqual({ categoryId: "cat-1", itemId: "item-1" });
    expect(targets[targets.length - 1]).toEqual({ categoryId: "cat-1", itemId: "item-20" });
  });
});
