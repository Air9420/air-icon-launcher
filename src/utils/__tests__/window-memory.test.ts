import { describe, expect, it, vi } from "vitest";

import { hideWindowAndStartMemoryRelease } from "../window-memory";

describe("hideWindowAndStartMemoryRelease", () => {
    it("hides the window before starting memory release", async () => {
        const calls: string[] = [];
        const window = {
            hide: vi.fn(async () => {
                calls.push("hide");
            }),
        };

        await hideWindowAndStartMemoryRelease(window, async () => {
            calls.push("release");
        });

        expect(window.hide).toHaveBeenCalledTimes(1);
        expect(calls).toEqual(["hide", "release"]);
    });

    it("does not start memory release when hiding fails", async () => {
        const calls: string[] = [];
        const window = {
            hide: vi.fn(async () => {
                calls.push("hide");
                throw new Error("hide failed");
            }),
        };

        await expect(
            hideWindowAndStartMemoryRelease(window, async () => {
                calls.push("release");
            })
        ).rejects.toThrow("hide failed");

        expect(window.hide).toHaveBeenCalledTimes(1);
        expect(calls).toEqual(["hide"]);
    });
});
