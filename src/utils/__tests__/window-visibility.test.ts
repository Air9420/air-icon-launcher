import { describe, expect, it } from "vitest";

import { shouldSkipVisibleHydration } from "../window-visibility";

describe("shouldSkipVisibleHydration", () => {
  it("skips hydration while the window is hidden", () => {
    expect(shouldSkipVisibleHydration("hidden", true)).toBe(true);
  });

  it("skips hydration while the window is visible but not focused", () => {
    expect(shouldSkipVisibleHydration("visible", false)).toBe(true);
  });

  it("allows hydration only when the window is visible and focused", () => {
    expect(shouldSkipVisibleHydration("visible", true)).toBe(false);
  });
});
