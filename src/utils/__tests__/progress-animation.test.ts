import { describe, expect, it } from "vitest";

import { getSmoothedProgress } from "../progress-animation";

describe("getSmoothedProgress", () => {
    it("moves toward the target by at most the configured step", () => {
        expect(getSmoothedProgress(20, 80, 15)).toBe(35);
    });

    it("uses the target when it is within one step", () => {
        expect(getSmoothedProgress(20, 28, 15)).toBe(28);
    });

    it("does not move backward when raw progress regresses", () => {
        expect(getSmoothedProgress(70, 30, 15)).toBe(70);
    });

    it("clamps progress values to a valid percentage range", () => {
        expect(getSmoothedProgress(-20, 250, 200)).toBe(100);
        expect(getSmoothedProgress(120, 80, 15)).toBe(100);
    });
});
