import { describe, expect, it } from "vitest";

import { computeActiveTabScrollLeft } from "../tabScroll";

describe("computeActiveTabScrollLeft", () => {
  it("keeps the current scroll when the active tab and its tails are already fully visible", () => {
    expect(
      computeActiveTabScrollLeft({
        currentScrollLeft: 0,
        viewportWidth: 320,
        tabOffsetLeft: 80,
        tabWidth: 64,
        edgePadding: 4,
        tailWidth: 16,
      })
    ).toBe(0);
  });

  it("scrolls right enough to reveal the last tab tail and right-side inset", () => {
    expect(
      computeActiveTabScrollLeft({
        currentScrollLeft: 0,
        viewportWidth: 320,
        tabOffsetLeft: 412,
        tabWidth: 52,
        edgePadding: 4,
        tailWidth: 16,
      })
    ).toBe(278);
  });

  it("scrolls left enough to reveal the first tab tail and left-side inset", () => {
    expect(
      computeActiveTabScrollLeft({
        currentScrollLeft: 120,
        viewportWidth: 320,
        tabOffsetLeft: 12,
        tabWidth: 60,
        edgePadding: 4,
        tailWidth: 16,
      })
    ).toBe(0);
  });
});
