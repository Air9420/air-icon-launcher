import { invoke } from "../utils/invoke-wrapper";
import {
    getCachedLauncherIcon,
    setCachedLauncherIcon,
} from "../utils/launcher-icon-cache";
import type { LauncherItem, LaunchDependency } from "../stores/launcherStore";

export type LauncherItemRef = {
    categoryId: string;
    itemId: string;
};

export function normalizeIconBase64(value: string | null | undefined): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

export function normalizeHasCustomIcon(value: unknown): boolean {
    return value === true;
}

export function resolveLegacyHasCustomIcon(
    item: Pick<LauncherItem, "iconBase64" | "hasCustomIcon"> & {
        originalIconBase64?: string | null;
    }
): boolean {
    if (typeof item.hasCustomIcon === "boolean") {
        return item.hasCustomIcon;
    }

    const originalIcon = normalizeIconBase64(item.originalIconBase64);
    if (originalIcon === null) {
        return false;
    }

    return normalizeIconBase64(item.iconBase64) !== originalIcon;
}

export function normalizeDelaySeconds(value: number | undefined): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.floor(value ?? 0));
}

export function normalizeLaunchDependencies(
    dependencies: LaunchDependency[] | undefined,
    currentRef?: { categoryId: string; itemId: string }
): LaunchDependency[] {
    if (!Array.isArray(dependencies)) return [];

    const seen = new Set<string>();
    const normalized: LaunchDependency[] = [];

    for (const dependency of dependencies) {
        if (!dependency?.categoryId || !dependency?.itemId) continue;
        if (
            currentRef &&
            dependency.categoryId === currentRef.categoryId &&
            dependency.itemId === currentRef.itemId
        ) {
            continue;
        }

        const key = `${dependency.categoryId}:${dependency.itemId}`;
        if (seen.has(key)) continue;
        seen.add(key);

        normalized.push({
            categoryId: dependency.categoryId,
            itemId: dependency.itemId,
            delayAfterSeconds: normalizeDelaySeconds(dependency.delayAfterSeconds),
        });
    }

    return normalized;
}

export function getNameFromPath(path: string) {
    const normalized = path.replace(/\\/g, "/");
    const segments = normalized.split("/").filter(Boolean);
    const base = segments[segments.length - 1] || path;
    const lower = base.toLowerCase();
    if (lower.endsWith(".lnk")) return base.slice(0, -4);
    if (lower.endsWith(".exe")) return base.slice(0, -4);
    return base;
}

export function cacheOriginalIconForFileItem(
    itemType: LauncherItem["itemType"],
    path: string,
    iconBase64: string | null | undefined
): void {
    if (itemType !== "file") return;
    const normalizedPath = typeof path === "string" ? path.trim() : "";
    const normalizedIcon = normalizeIconBase64(iconBase64);
    if (!normalizedPath || !normalizedIcon) return;
    setCachedLauncherIcon(normalizedPath, normalizedIcon);
}

export function getCachedOriginalIconForPath(path: string): string | null {
    const normalizedPath = typeof path === "string" ? path.trim() : "";
    if (!normalizedPath) return null;
    return normalizeIconBase64(getCachedLauncherIcon(normalizedPath));
}

export function applyCachedOriginalIcon(item: LauncherItem): LauncherItem {
    if (item.itemType !== "file") return item;

    const currentIcon = normalizeIconBase64(item.iconBase64);
    if (currentIcon || normalizeHasCustomIcon(item.hasCustomIcon)) return item;

    const cachedIcon = getCachedOriginalIconForPath(item.path);
    if (!cachedIcon) return item;

    return {
        ...item,
        iconBase64: cachedIcon,
        hasCustomIcon: false,
    };
}

export function shouldRefreshDerivedIcon(item: LauncherItem): boolean {
    if (item.itemType !== "file") return false;

    const normalizedPath = typeof item.path === "string" ? item.path.trim() : "";
    if (!normalizedPath) return false;

    const currentIcon = normalizeIconBase64(item.iconBase64);
    return !!currentIcon && !normalizeHasCustomIcon(item.hasCustomIcon);
}

export function normalizeImportedLauncherItem(
    item: LauncherItem & { originalIconBase64?: string | null }
): LauncherItem {
    const { originalIconBase64: _legacyOriginalIcon, ...rest } = item;
    const normalizedIcon = normalizeIconBase64(item.iconBase64);
    const hasCustomIcon = resolveLegacyHasCustomIcon(item);

    if (rest.itemType === "file" && !hasCustomIcon) {
        cacheOriginalIconForFileItem(rest.itemType, rest.path, normalizedIcon);
    }

    return {
        ...rest,
        iconBase64: normalizedIcon,
        hasCustomIcon,
    };
}

export function isHttpUrl(url: string): boolean {
    return url.startsWith("http://") || url.startsWith("https://");
}

type IconHydrationOptions = {
    forceReplace?: boolean;
    skipCache?: boolean;
};

export function useItemsHelper(getLauncherItemsByCategoryId: (categoryId: string) => LauncherItem[], getLauncherItemById: (categoryId: string, itemId: string) => LauncherItem | null, setLauncherItemsByCategoryId: (categoryId: string, items: LauncherItem[]) => void) {
    const iconHydrationInFlight = new Set<string>();

    async function refreshLauncherItemUrlFavicon(
        categoryId: string,
        itemId: string,
        currentUrl: string,
        updateIcon: (categoryId: string, itemId: string, iconBase64: string) => void
    ): Promise<void> {
        const normalizedUrl = currentUrl.trim();
        if (!isHttpUrl(normalizedUrl)) return;

        try {
            const result = await invoke<string | null>("fetch_favicon_from_url", {
                url: normalizedUrl,
            });
            if (!result.ok) return;

            const iconBase64 = result.value;
            if (!iconBase64) return;

            const item = getLauncherItemById(categoryId, itemId);
            if (!item || normalizeHasCustomIcon(item.hasCustomIcon)) return;

            updateIcon(categoryId, itemId, iconBase64);
        } catch (error) {
            console.warn("Failed to refresh launcher favicon:", error);
        }
    }

    async function hydrateMissingIconsForItems(
        targets: LauncherItemRef[],
        options: IconHydrationOptions = {}
    ): Promise<void> {
        if (!Array.isArray(targets) || targets.length === 0) return;
        const forceReplace = options.forceReplace === true;
        const skipCache = options.skipCache === true;

        const uniqueTargets: Array<{
            key: string;
            categoryId: string;
            itemId: string;
            path: string;
        }> = [];
        const seenTargetKeys = new Set<string>();

        for (const target of targets) {
            if (!target?.categoryId || !target?.itemId) continue;

            const targetKey = `${target.categoryId}:${target.itemId}`;
            if (seenTargetKeys.has(targetKey)) continue;
            seenTargetKeys.add(targetKey);

            if (iconHydrationInFlight.has(targetKey)) continue;

            const item = getLauncherItemById(target.categoryId, target.itemId);
            if (!item || item.itemType !== "file") continue;

            const currentIcon = normalizeIconBase64(item.iconBase64);
            const hasCustomIcon = normalizeHasCustomIcon(item.hasCustomIcon);
            if (!forceReplace) {
                if (currentIcon) continue;
                if (hasCustomIcon) continue;
            } else if (hasCustomIcon) {
                continue;
            }

            const path = typeof item.path === "string" ? item.path.trim() : "";
            if (!path) continue;

            if (!skipCache) {
                const cachedIcon = getCachedOriginalIconForPath(path);
                if (cachedIcon) {
                    const list = getLauncherItemsByCategoryId(target.categoryId);
                    const index = list.findIndex((x) => x.id === target.itemId);
                    if (index !== -1) {
                        const next = [...list];
                        next[index] = {
                            ...next[index],
                            iconBase64: cachedIcon,
                            hasCustomIcon: false,
                        };
                        setLauncherItemsByCategoryId(target.categoryId, next);
                    }
                    continue;
                }
            }

            uniqueTargets.push({
                key: targetKey,
                categoryId: target.categoryId,
                itemId: target.itemId,
                path,
            });
        }

        if (uniqueTargets.length === 0) return;

        const uniquePaths: string[] = [];
        const seenPaths = new Set<string>();
        for (const target of uniqueTargets) {
            if (seenPaths.has(target.path)) continue;
            seenPaths.add(target.path);
            uniquePaths.push(target.path);
        }

        if (uniquePaths.length === 0) return;

        for (const target of uniqueTargets) {
            iconHydrationInFlight.add(target.key);
        }

        try {
            const result = await invoke<Array<string | null>>("extract_icons_from_paths", {
                paths: uniquePaths,
            });

            if (!result.ok) {
                console.error("Failed to hydrate launcher icons:", result.error);
                return;
            }

            const iconByPath = new Map<string, string>();
            for (let i = 0; i < uniquePaths.length; i++) {
                const normalizedIcon = normalizeIconBase64(result.value[i]);
                if (!normalizedIcon) continue;
                iconByPath.set(uniquePaths[i], normalizedIcon);
                setCachedLauncherIcon(uniquePaths[i], normalizedIcon);
            }

            if (iconByPath.size === 0) return;

            const updatesByCategory = new Map<string, Map<string, string>>();
            for (const target of uniqueTargets) {
                const icon = iconByPath.get(target.path);
                if (!icon) continue;
                if (!updatesByCategory.has(target.categoryId)) {
                    updatesByCategory.set(target.categoryId, new Map<string, string>());
                }
                updatesByCategory.get(target.categoryId)!.set(target.itemId, icon);
            }

            for (const [categoryId, categoryUpdates] of updatesByCategory) {
                const list = getLauncherItemsByCategoryId(categoryId);
                let changed = false;
                const next = list.map((item) => {
                    const hydratedIcon = categoryUpdates.get(item.id);
                    if (!hydratedIcon) return item;
                    const currentIcon = normalizeIconBase64(item.iconBase64);
                    const hasCustomIcon = normalizeHasCustomIcon(item.hasCustomIcon);
                    if (!forceReplace && currentIcon) return item;
                    if (forceReplace && hasCustomIcon) {
                        return item;
                    }
                    changed = true;
                    return {
                        ...item,
                        iconBase64: hydratedIcon,
                        hasCustomIcon: false,
                    };
                });
                if (changed) {
                    setLauncherItemsByCategoryId(categoryId, next);
                }
            }
        } catch (e) {
            console.error("Failed to hydrate launcher icons:", e);
        } finally {
            for (const target of uniqueTargets) {
                iconHydrationInFlight.delete(target.key);
            }
        }
    }

    return {
        hydrateMissingIconsForItems,
        refreshLauncherItemUrlFavicon,
    };
}
