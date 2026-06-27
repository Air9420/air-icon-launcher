import { describe, expect, it } from "vitest";

import {
  UPDATE_PROGRESS_ANIMATION_MS,
  clampProgress,
  getSmoothedProgressFrame,
} from "../progress-animation";

describe("progress-animation", () => {
  it("clamps progress into the 0-100 range", () => {
    expect(clampProgress(-20)).toBe(0);
    expect(clampProgress(42.4)).toBe(42);
    expect(clampProgress(42.6)).toBe(43);
    expect(clampProgress(140)).toBe(100);
  });

  it("smoothly advances toward a fast target jump", () => {
    const halfway = getSmoothedProgressFrame(0, 100, UPDATE_PROGRESS_ANIMATION_MS / 2);

    expect(halfway).toBeGreaterThan(0);
    expect(halfway).toBeLessThan(100);
  });

  it("reaches the target when animation duration is elapsed", () => {
    expect(getSmoothedProgressFrame(12, 100, UPDATE_PROGRESS_ANIMATION_MS)).toBe(100);
    expect(getSmoothedProgressFrame(12, 80, UPDATE_PROGRESS_ANIMATION_MS + 1)).toBe(80);
  });

  it("does not animate backwards", () => {
    expect(getSmoothedProgressFrame(80, 20, 10)).toBe(20);
  });
});
