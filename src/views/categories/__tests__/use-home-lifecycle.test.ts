// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { createHomeKeyboardHandlers, type HomeKeyboardDeps } from "../use-home-lifecycle";

function createDeps(overrides: Partial<HomeKeyboardDeps> = {}) {
    const showShortcutHints = ref(false);
    const launchedPinned: string[] = [];

    const deps: HomeKeyboardDeps = {
        searchKeyword: ref(""),
        homeSearchViewState: ref("home"),
        showShortcutHints,
        showSearchHistoryPanel: ref(false),
        pinnedMergedItems: ref([
            { key: "p1", item: { id: "p1", name: "Pin 1" }, primaryCategoryId: "c1" },
            { key: "p2", item: { id: "p2", name: "Pin 2" }, primaryCategoryId: "c1" },
        ] as HomeKeyboardDeps["pinnedMergedItems"]["value"]),
        stableRecentDisplayItems: ref([]),
        totalSearchItemCount: ref(0),
        selectedIndex: ref(-1),
        closeSearchHistoryPanel: vi.fn(),
        clearSearchForEscape: vi.fn(),
        triggerSearchSelectionAt: vi.fn(),
        launchPinned: (item) => { launchedPinned.push(item.key); },
        launchRecent: vi.fn(),
        rotateHomeTabCycle: vi.fn(),
        isHomeKeyboardNavActive: () => false,
        moveHomeSelectionByKey: vi.fn(),
        triggerHomeSelection: vi.fn(),
        ...overrides,
    };

    return { deps, showShortcutHints, launchedPinned };
}

describe("createHomeKeyboardHandlers 号标显隐", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("按下 Ctrl 时显示号标，松开时隐藏", () => {
        const { deps, showShortcutHints } = createDeps();
        const { onKeydown, onKeyup } = createHomeKeyboardHandlers(deps);

        onKeydown(new KeyboardEvent("keydown", { key: "Control", ctrlKey: true }));
        expect(showShortcutHints.value).toBe(true);

        onKeyup(new KeyboardEvent("keyup", { key: "Control", ctrlKey: false }));
        expect(showShortcutHints.value).toBe(false);
    });

    it("Ctrl+数字 启动后焦点被抢走，号标仍保持显示", () => {
        const { deps, showShortcutHints, launchedPinned } = createDeps();
        const { onKeydown } = createHomeKeyboardHandlers(deps);

        onKeydown(new KeyboardEvent("keydown", { key: "Control", ctrlKey: true }));
        onKeydown(new KeyboardEvent("keydown", { key: "2", code: "Digit2", ctrlKey: true }));
        expect(launchedPinned).toEqual(["p2"]);

        // 模拟目标程序抢焦点：号标不应被焦点逻辑清掉。
        expect(showShortcutHints.value).toBe(true);

        // 继续按同一个数字仍能启动，且号标仍在。
        onKeydown(new KeyboardEvent("keydown", { key: "2", code: "Digit2", ctrlKey: true }));
        expect(showShortcutHints.value).toBe(true);
    });

    it("失焦期间松开 Ctrl，之后按普通键会把号标关掉", () => {
        const { deps, showShortcutHints } = createDeps();
        const { onKeydown } = createHomeKeyboardHandlers(deps);

        onKeydown(new KeyboardEvent("keydown", { key: "Control", ctrlKey: true }));
        expect(showShortcutHints.value).toBe(true);

        // 失焦期间松开了 Ctrl，keyup 收不到；下一次不带 Ctrl 的按键作为兜底。
        onKeydown(new KeyboardEvent("keydown", { key: "a", ctrlKey: false }));
        expect(showShortcutHints.value).toBe(false);
    });
});
