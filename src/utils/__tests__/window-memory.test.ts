// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { APP_WINDOW_HIDDEN_EVENT, hideWindowAndStartMemoryRelease } from "../window-memory";

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

    it("在 hide() 之前同步派发隐藏事件，供号标等一次性 UI 复位", async () => {
        const order: string[] = [];
        // 事件派发目标是 globalThis，因此监听也必须挂在 globalThis 上。
        const onHidden = () => order.push("hidden-event");
        globalThis.addEventListener(APP_WINDOW_HIDDEN_EVENT, onHidden);

        const window = {
            hide: vi.fn(async () => {
                order.push("hide");
            }),
        };

        try {
            await hideWindowAndStartMemoryRelease(window, () => {
                order.push("release");
            });
        } finally {
            globalThis.removeEventListener(APP_WINDOW_HIDDEN_EVENT, onHidden);
        }

        // 事件必须先于 hide，否则窗口会先画出带号标的一帧。
        expect(order).toEqual(["hidden-event", "hide", "release"]);
    });
});
