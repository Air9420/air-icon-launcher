import { describe, expect, it } from "vitest";
import {
    buildSearchHighlightSegments,
    createSearchSelectionTarget,
    findSearchSelectionIndex,
    getHomeSearchViewState,
    getRecentSearchHistoryEntries,
    getSearchHistoryDisplayKeyword,
    getSearchShortcutIndex,
    getSearchMatchTypeLabel,
} from "../search-ui";
import type { GlobalSearchMergedResult } from "../../stores/launcherStore";

function makeSearchResult(
    overrides: Partial<GlobalSearchMergedResult> = {}
): GlobalSearchMergedResult {
    return {
        key: "result-1",
        item: {
            id: "item-1",
            name: "Visual Studio Code",
            path: "C:\\VSCode.exe",
            itemType: "file",
            isDirectory: false,
            iconBase64: null,
            originalIconBase64: null,
            launchDependencies: [],
            launchDelaySeconds: 0,
        },
        primaryCategoryId: "cat-dev",
        categories: [],
        matchType: "prefix",
        ...overrides,
    };
}

describe("buildSearchHighlightSegments", () => {
    it("highlights direct substring matches case-insensitively", () => {
        expect(buildSearchHighlightSegments("Visual Studio Code", "studio", "substring")).toEqual([
            { text: "Visual ", highlighted: false },
            { text: "Studio", highlighted: true },
            { text: " Code", highlighted: false },
        ]);
    });

    it("does not highlight pinyin matches", () => {
        expect(buildSearchHighlightSegments("微信", "weixin", "pinyin_full")).toEqual([
            { text: "微信", highlighted: false },
        ]);
    });
});

describe("getRecentSearchHistoryEntries", () => {
    it("sorts by lastUsedAt descending and truncates", () => {
        const entries = [
            { keyword: "a", lastUsedAt: 1 },
            { keyword: "b", lastUsedAt: 3 },
            { keyword: "c", lastUsedAt: 2 },
        ];

        expect(getRecentSearchHistoryEntries(entries, 2)).toEqual([
            { keyword: "b", lastUsedAt: 3 },
            { keyword: "c", lastUsedAt: 2 },
        ]);
    });
});

describe("getSearchHistoryDisplayKeyword", () => {
    it("prefers displayKeyword when present", () => {
        expect(
            getSearchHistoryDisplayKeyword({
                keyword: "vscode",
                displayKeyword: "VSCode",
            })
        ).toBe("VSCode");
    });

    it("falls back to normalized keyword for old data", () => {
        expect(
            getSearchHistoryDisplayKeyword({
                keyword: "chrome",
            })
        ).toBe("chrome");
    });
});

describe("findSearchSelectionIndex", () => {
    it("restores selection by merged result key", () => {
        const target = createSearchSelectionTarget(
            makeSearchResult({
                key: "result-2",
                item: {
                    id: "item-2",
                    name: "VSCode",
                    path: "C:\\VSCode.exe",
                    itemType: "file",
                    isDirectory: false,
                    iconBase64: null,
                    originalIconBase64: null,
                    launchDependencies: [],
                    launchDelaySeconds: 0,
                },
            })
        );
        const results = [
            makeSearchResult(),
            makeSearchResult({
                key: "result-2",
                item: {
                    id: "item-2",
                    name: "VSCode",
                    path: "C:\\VSCode.exe",
                    itemType: "file",
                    isDirectory: false,
                    iconBase64: null,
                    originalIconBase64: null,
                    launchDependencies: [],
                    launchDelaySeconds: 0,
                },
            }),
        ];

        expect(findSearchSelectionIndex(results, target)).toBe(1);
    });

    it("falls back to item/category identity when key changes", () => {
        const target = {
            key: "old-key",
            itemId: "item-9",
            primaryCategoryId: "cat-social",
        };
        const results = [
            makeSearchResult({
                key: "new-key",
                primaryCategoryId: "cat-social",
                item: {
                    id: "item-9",
                    name: "WeChat",
                    path: "C:\\WeChat.exe",
                    itemType: "file",
                    isDirectory: false,
                    iconBase64: null,
                    originalIconBase64: null,
                    launchDependencies: [],
                    launchDelaySeconds: 0,
                },
            }),
        ];

        expect(findSearchSelectionIndex(results, target)).toBe(0);
    });
});

describe("getSearchShortcutIndex", () => {
    it("maps main keyboard digits", () => {
        expect(getSearchShortcutIndex({ key: "1", code: "Digit1" })).toBe(0);
        expect(getSearchShortcutIndex({ key: "9", code: "Digit9" })).toBe(8);
    });

    it("maps numpad digits", () => {
        expect(getSearchShortcutIndex({ key: "1", code: "Numpad1" })).toBe(0);
        expect(getSearchShortcutIndex({ key: "9", code: "Numpad9" })).toBe(8);
    });

    it("ignores unsupported keys", () => {
        expect(getSearchShortcutIndex({ key: "0", code: "Digit0" })).toBeNull();
        expect(getSearchShortcutIndex({ key: "a", code: "KeyA" })).toBeNull();
    });
});

describe("getSearchMatchTypeLabel", () => {
    it("returns stable labels", () => {
        expect(getSearchMatchTypeLabel("exact")).toBe("精确");
        expect(getSearchMatchTypeLabel("pinyin_initial")).toBe("首字母");
    });
});

describe("getHomeSearchViewState", () => {
    it("keeps pending search from showing fallback", () => {
        expect(getHomeSearchViewState("vscode", 0, true)).toBe("pending");
    });

    it("shows fallback only after pending completes with no results", () => {
        expect(getHomeSearchViewState("vscode", 0, false)).toBe("fallback");
    });

    it("shows results when settled search has matches", () => {
        expect(getHomeSearchViewState("vscode", 2, false)).toBe("results");
    });
});
