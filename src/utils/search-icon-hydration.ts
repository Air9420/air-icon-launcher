import {
    shouldSkipVisibleHydration,
    type WindowVisibilityState,
} from "./window-visibility";

type LauncherHydrationInput = {
    primaryCategoryId: string;
    item: {
        id: string;
    };
};

type RecentFileHydrationInput = {
    path: string;
    iconBase64: string | null;
};

type SearchIconHydrationPlanInput = {
    keyword: string;
    visibilityState: WindowVisibilityState;
    isWindowFocused: boolean;
    launcherLimit: number;
    recentFileLimit: number;
    launcherResults: LauncherHydrationInput[];
    recentFileResults: RecentFileHydrationInput[];
    visibleLauncherTargets?: LauncherHydrationTarget[];
    visibleRecentFilePaths?: string[];
};

type LauncherHydrationTarget = {
    categoryId: string;
    itemId: string;
};

type SearchIconHydrationPlan = {
    launcherTargets: LauncherHydrationTarget[];
    recentFilePaths: string[];
};

function normalizeIconBase64(value: string | null | undefined): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function normalizePathKey(path: string): string {
    return path.trim().replace(/\//g, "\\").toLowerCase();
}

export function buildSearchIconHydrationPlan(
    input: SearchIconHydrationPlanInput,
): SearchIconHydrationPlan {
    if (!input.keyword.trim()) {
        return {
            launcherTargets: [],
            recentFilePaths: [],
        };
    }

    if (shouldSkipVisibleHydration(input.visibilityState, input.isWindowFocused)) {
        return {
            launcherTargets: [],
            recentFilePaths: [],
        };
    }

    const launcherTargets = input.launcherResults
        .map((result) => ({
            categoryId: result.primaryCategoryId,
            itemId: result.item.id,
        }));

    const visibleLauncherTargetKeys = new Set(
        (input.visibleLauncherTargets ?? []).map((target) => `${target.categoryId}:${target.itemId}`)
    );
    const prioritizedLauncherTargets = visibleLauncherTargetKeys.size > 0
        ? launcherTargets.filter((target) => visibleLauncherTargetKeys.has(`${target.categoryId}:${target.itemId}`))
        : launcherTargets;
    const limitedLauncherTargets = prioritizedLauncherTargets.slice(0, Math.max(0, input.launcherLimit));

    const recentFilePaths: string[] = [];
    const seenRecentFilePaths = new Set<string>();
    const recentFileLimit = Math.max(0, input.recentFileLimit);
    const visibleRecentFilePathKeys = new Set(
        (input.visibleRecentFilePaths ?? []).map((path) => normalizePathKey(path))
    );
    const prioritizedRecentFileResults = visibleRecentFilePathKeys.size > 0
        ? input.recentFileResults.filter((row) => visibleRecentFilePathKeys.has(normalizePathKey(row.path)))
        : input.recentFileResults;

    for (const row of prioritizedRecentFileResults.slice(0, recentFileLimit)) {
        if (normalizeIconBase64(row.iconBase64)) continue;
        const normalizedPath = normalizePathKey(row.path);
        if (!normalizedPath || seenRecentFilePaths.has(normalizedPath)) continue;
        seenRecentFilePaths.add(normalizedPath);
        recentFilePaths.push(row.path);
    }

    return {
        launcherTargets: limitedLauncherTargets,
        recentFilePaths,
    };
}
