import { describe, expect, it } from "vitest";

import { buildSearchIconHydrationPlan } from "../search-icon-hydration";

describe("buildSearchIconHydrationPlan", () => {
    it("collects visible launcher and recent-file hydration work for active search results", () => {
        const plan = buildSearchIconHydrationPlan({
            keyword: "note",
            visibilityState: "visible",
            isWindowFocused: true,
            launcherLimit: 2,
            recentFileLimit: 4,
            launcherResults: [
                {
                    primaryCategoryId: "cat-1",
                    item: { id: "item-1" },
                },
                {
                    primaryCategoryId: "cat-2",
                    item: { id: "item-2" },
                },
                {
                    primaryCategoryId: "cat-3",
                    item: { id: "item-3" },
                },
            ],
            recentFileResults: [
                {
                    path: "C:/Docs/Alpha.txt",
                    iconBase64: null,
                },
                {
                    path: "C:\\Docs\\Alpha.txt",
                    iconBase64: null,
                },
                {
                    path: "C:/Docs/Beta.txt",
                    iconBase64: "cached",
                },
                {
                    path: "C:/Docs/Gamma.txt",
                    iconBase64: null,
                },
            ],
            visibleLauncherTargets: [
                { categoryId: "cat-2", itemId: "item-2" },
                { categoryId: "cat-3", itemId: "item-3" },
            ],
            visibleRecentFilePaths: [
                "C:/Docs/Gamma.txt",
                "C:/Docs/Alpha.txt",
            ],
        });

        expect(plan.launcherTargets).toEqual([
            { categoryId: "cat-2", itemId: "item-2" },
            { categoryId: "cat-3", itemId: "item-3" },
        ]);
        expect(plan.recentFilePaths).toEqual([
            "C:/Docs/Gamma.txt",
            "C:/Docs/Alpha.txt",
        ]);
    });

    it("returns no hydration work when visible hydration is currently blocked", () => {
        const hiddenPlan = buildSearchIconHydrationPlan({
            keyword: "note",
            visibilityState: "hidden",
            isWindowFocused: true,
            launcherLimit: 3,
            recentFileLimit: 3,
            launcherResults: [
                {
                    primaryCategoryId: "cat-1",
                    item: { id: "item-1" },
                },
            ],
            recentFileResults: [
                {
                    path: "C:/Docs/Alpha.txt",
                    iconBase64: null,
                },
            ],
        });

        const blurredPlan = buildSearchIconHydrationPlan({
            keyword: "note",
            visibilityState: "visible",
            isWindowFocused: false,
            launcherLimit: 3,
            recentFileLimit: 3,
            launcherResults: [
                {
                    primaryCategoryId: "cat-1",
                    item: { id: "item-1" },
                },
            ],
            recentFileResults: [
                {
                    path: "C:/Docs/Alpha.txt",
                    iconBase64: null,
                },
            ],
        });

        expect(hiddenPlan).toEqual({
            launcherTargets: [],
            recentFilePaths: [],
        });
        expect(blurredPlan).toEqual({
            launcherTargets: [],
            recentFilePaths: [],
        });
    });

    it("ignores blank keywords and entries that already have icons", () => {
        const plan = buildSearchIconHydrationPlan({
            keyword: "   ",
            visibilityState: "visible",
            isWindowFocused: true,
            launcherLimit: 3,
            recentFileLimit: 3,
            launcherResults: [
                {
                    primaryCategoryId: "cat-1",
                    item: { id: "item-1" },
                },
            ],
            recentFileResults: [
                {
                    path: "C:/Docs/Alpha.txt",
                    iconBase64: "cached",
                },
            ],
        });

        expect(plan).toEqual({
            launcherTargets: [],
            recentFilePaths: [],
        });
    });
});
