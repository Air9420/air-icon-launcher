// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, ref } from "vue";

const { hideMock, safeInvokeMock } = vi.hoisted(() => ({
    hideMock: vi.fn(async () => {}),
    safeInvokeMock: vi.fn(async (_cmd?: string, _args?: Record<string, unknown>): Promise<unknown> => null),
}));

vi.mock("@tauri-apps/api/window", () => ({
    getCurrentWindow: () => ({
        hide: hideMock,
        onFocusChanged: async () => () => {},
        isFocused: async () => true,
        setFocus: () => {},
    }),
}));

vi.mock("../../utils/invoke-wrapper", () => ({
    safeInvoke: safeInvokeMock,
}));

import { useLaunchStatus } from "../useLaunchStatus";

function createComposable(autoHide: boolean) {
    const scope = effectScope();
    const autoHideAfterLaunch = ref(autoHide);
    const api = scope.run(() => useLaunchStatus({ autoHideAfterLaunch }))!;
    return { scope, api, autoHideAfterLaunch };
}

function pressCtrl() {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Control", ctrlKey: true }));
}

function releaseCtrl() {
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Control", ctrlKey: false }));
}

describe("useLaunchStatus", () => {
    const originalHasFocus = document.hasFocus;

    beforeEach(() => {
        vi.useFakeTimers();
        hideMock.mockClear();
        safeInvokeMock.mockClear();
        document.hasFocus = originalHasFocus;
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        document.hasFocus = originalHasFocus;
    });

    it("点击启动项立即隐藏窗口，且不显示启动动画", async () => {
        const { scope, api } = createComposable(true);

        api.setLaunchStatus("item-1", "launching");

        // 隐藏排在微任务里：不受窗口失焦后的定时器节流影响。
        await Promise.resolve();
        expect(hideMock).toHaveBeenCalledTimes(1);
        expect(api.getLaunchStatus("item-1")).toBeUndefined();

        scope.stop();
    });

    it("未开启自动隐藏时也不显示动画、不隐藏窗口", async () => {
        const { scope, api } = createComposable(false);

        api.setLaunchStatus("item-1", "launching");
        api.setLaunchStatus("item-1", "success");
        await Promise.resolve();

        expect(hideMock).not.toHaveBeenCalled();
        expect(api.getLaunchStatus("item-1")).toBeUndefined();

        scope.stop();
    });

    it("按住 Ctrl 时显示启动动画，松开 Ctrl 后才隐藏窗口", async () => {
        const { scope, api } = createComposable(true);
        pressCtrl();

        api.setLaunchStatus("item-1", "launching");
        await Promise.resolve();
        expect(hideMock).not.toHaveBeenCalled();
        expect(api.getLaunchStatus("item-1")).toBe("launching");

        api.setLaunchStatus("item-1", "success");
        expect(api.getLaunchStatus("item-1")).toBe("success");

        releaseCtrl();
        await Promise.resolve();
        expect(hideMock).toHaveBeenCalledTimes(1);

        scope.stop();
    });

    it("启动失败时还原被隐藏的窗口并清除状态", async () => {
        const { scope, api } = createComposable(true);

        api.setLaunchStatus("item-1", "launching");
        await Promise.resolve();
        expect(hideMock).toHaveBeenCalledTimes(1);

        api.clearLaunchStatus("item-1");
        expect(safeInvokeMock).toHaveBeenCalledWith("show_launcher", { forceNoFollow: true });

        scope.stop();
    });

    it("启动失败发生在隐藏之前时，取消隐藏而不是闪一下", async () => {
        const { scope, api } = createComposable(true);

        api.setLaunchStatus("item-1", "launching");
        api.clearLaunchStatus("item-1");
        await Promise.resolve();

        expect(hideMock).not.toHaveBeenCalled();
        expect(safeInvokeMock).not.toHaveBeenCalledWith("show_launcher", { forceNoFollow: true });

        scope.stop();
    });

    it("关闭自动隐藏后，按住 Ctrl 松开不会隐藏窗口", async () => {
        const { scope, api } = createComposable(false);
        pressCtrl();

        api.setLaunchStatus("item-1", "launching");
        api.setLaunchStatus("item-1", "success");
        releaseCtrl();
        await Promise.resolve();

        expect(hideMock).not.toHaveBeenCalled();

        scope.stop();
    });

    it("keyup 丢失时，物理状态轮询发现 Ctrl 已松开也会隐藏窗口", async () => {
        const { scope, api } = createComposable(true);
        pressCtrl();

        api.setLaunchStatus("item-1", "launching");
        await Promise.resolve();
        expect(hideMock).not.toHaveBeenCalled();

        // 模拟启动项抢走焦点：窗口失去焦点，keyup 收不到。
        document.hasFocus = () => false;
        safeInvokeMock.mockImplementation(async (cmd?: string) =>
            cmd === "is_ctrl_key_pressed" ? false : null,
        );

        // 轮询间隔 120ms，推进一次即可读到「Ctrl 已松开」。
        await vi.advanceTimersByTimeAsync(130);

        expect(hideMock).toHaveBeenCalledTimes(1);

        scope.stop();
    });

    it("keyup 丢失后，下一次普通按键也能兜底收尾", async () => {
        const { scope, api } = createComposable(true);
        pressCtrl();

        api.setLaunchStatus("item-1", "launching");
        await Promise.resolve();
        expect(hideMock).not.toHaveBeenCalled();

        // 不派发 keyup，直接按一个不带 Ctrl 的键（窗口已重新获得焦点）。
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: false }));
        await Promise.resolve();

        expect(hideMock).toHaveBeenCalledTimes(1);

        scope.stop();
    });

    it("轮询读取失败（返回 null）时不会误隐藏窗口", async () => {
        const { scope, api } = createComposable(true);
        pressCtrl();

        api.setLaunchStatus("item-1", "launching");
        await Promise.resolve();

        document.hasFocus = () => false;
        safeInvokeMock.mockImplementation(async () => null);

        await vi.advanceTimersByTimeAsync(400);

        expect(hideMock).not.toHaveBeenCalled();

        scope.stop();
    });
});
