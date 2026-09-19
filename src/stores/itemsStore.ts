import { defineStore } from "pinia";
import { ref } from "vue";
import { createVersionedPersistConfig } from "../utils/versioned-persist";
import { getKernelContext } from "../kernel/context-access";
import type { AppsService } from "../kernel/services/apps-service";
import {
    normalizeIconBase64,
    normalizeHasCustomIcon,
    getNameFromPath,
    getCachedOriginalIconForPath,
} from "../composables/useItemsHelper";
import {
    getCachedLauncherIcon,
    setCachedLauncherIcon,
    removeCachedLauncherIcons,
} from "../utils/launcher-icon-cache";

function getAppsService(): AppsService | undefined {
    return getKernelContext()?.apps;
}

export type LauncherItem = {
    id: string;
    name: string;
    path: string;
    url?: string;
    itemType: "file" | "url";
    isDirectory: boolean;
    iconBase64: string | null;
    hasCustomIcon?: boolean;
    isFavorite?: boolean;
    lastUsedAt?: number;
    usageCount?: number;
    launchDependencies: LaunchDependency[];
    launchDelaySeconds: number;
};

export type LaunchDependency = {
    categoryId: string;
    itemId: string;
    delayAfterSeconds: number;
};

/**
 * Deprecated thin adapter over AppsService (`ctx.apps`).
 *
 * P6+ slim: core CRUD/launch writes are AppsService's job. This store keeps
 * the historical pinia API for iconCache and older call sites. When `ctx.apps`
 * is absent (unit tests), a local ref fallback keeps basic reads/writes working.
 */
export const useItemsStore = defineStore(
    "items",
    () => {
        const launcherItemsByCategoryId = ref<Record<string, LauncherItem[]>>({});

        function createLauncherItemId() {
            return getAppsService()?.createItemId() ?? `item-${crypto.randomUUID()}`;
        }

        function getLauncherItemsByCategoryId(categoryId: string): LauncherItem[] {
            const apps = getAppsService();
            if (apps) return apps.getItems(categoryId) as LauncherItem[];
            return launcherItemsByCategoryId.value[categoryId] || [];
        }

        function setLauncherItemsByCategoryId(categoryId: string, items: LauncherItem[]) {
            const apps = getAppsService();
            if (apps) {
                apps.setItemsByCategoryId(categoryId, items as never);
                return;
            }
            launcherItemsByCategoryId.value = {
                ...launcherItemsByCategoryId.value,
                [categoryId]: items,
            };
        }

        function getLauncherItemById(categoryId: string, itemId: string): LauncherItem | null {
            const apps = getAppsService();
            if (apps) return apps.getItemById(categoryId, itemId) as LauncherItem | null;
            return getLauncherItemsByCategoryId(categoryId).find((x) => x.id === itemId) || null;
        }

        function createLauncherItemInCategory(
            categoryId: string,
            payload: {
                name: string;
                path?: string;
                url?: string;
                itemType: "file" | "url";
                isDirectory?: boolean;
                iconBase64?: string | null;
                launchDependencies?: LaunchDependency[];
                launchDelaySeconds?: number;
            },
        ): string {
            const apps = getAppsService();
            if (!apps) {
                console.warn("[itemsStore] createLauncherItemInCategory without ctx.apps");
                return createLauncherItemId();
            }
            return apps.upsertItem(categoryId, {
                name: payload.name,
                path: payload.path,
                url: payload.url,
                itemType: payload.itemType,
                isDirectory: payload.isDirectory,
                iconBase64: payload.iconBase64,
                launchDependencies: payload.launchDependencies as never,
                launchDelaySeconds: payload.launchDelaySeconds,
            });
        }

        function updateLauncherItem(
            categoryId: string,
            itemId: string,
            patch: Partial<
                Pick<LauncherItem, "name" | "url" | "path" | "launchDependencies" | "launchDelaySeconds">
            >,
        ) {
            getAppsService()?.updateItem(categoryId, itemId, {
                ...patch,
                launchDependencies: patch.launchDependencies as never,
            });
        }

        function updateLauncherItems(
            categoryId: string,
            itemIds: string[],
            patch: Partial<Pick<LauncherItem, "launchDelaySeconds">>,
        ) {
            const apps = getAppsService();
            if (!apps) return;
            for (const itemId of itemIds) {
                apps.updateItem(categoryId, itemId, {
                    launchDelaySeconds: patch.launchDelaySeconds,
                });
            }
        }

        function deleteLauncherItem(categoryId: string, itemId: string) {
            getAppsService()?.removeItem(categoryId, itemId);
        }

        function deleteLauncherItems(categoryId: string, itemIds: string[]) {
            getAppsService()?.removeItems(categoryId, itemIds);
        }

        function moveLauncherItems(
            sourceCategoryId: string,
            targetCategoryId: string,
            itemIds: string[],
        ) {
            getAppsService()?.moveItems(sourceCategoryId, targetCategoryId, itemIds);
        }

        function addLauncherItemsToCategory(
            categoryId: string,
            payload: {
                paths: string[];
                directories: string[];
                icon_base64s: Array<string | null>;
                itemTypes?: Array<"file" | "url">;
            },
        ): string[] {
            const apps = getAppsService();
            if (!apps) return [];
            const directorySet = new Set(payload.directories);
            const ids: string[] = [];
            for (let i = 0; i < payload.paths.length; i++) {
                const path = payload.paths[i];
                const itemType = payload.itemTypes?.[i] ?? "file";
                ids.push(
                    apps.upsertItem(categoryId, {
                        name: getNameFromPath(path),
                        path: itemType === "url" ? undefined : path,
                        url: itemType === "url" ? path : undefined,
                        itemType,
                        isDirectory: directorySet.has(path),
                        iconBase64: normalizeIconBase64(payload.icon_base64s[i] ?? null),
                        hasCustomIcon: false,
                    }),
                );
            }
            return ids;
        }

        async function addLauncherItemsToCategoryBatched(
            categoryId: string,
            payload: {
                paths: string[];
                directories: string[];
                icon_base64s: Array<string | null>;
                itemTypes?: Array<"file" | "url">;
            },
            batchSize: number = 20,
        ): Promise<string[]> {
            const apps = getAppsService();
            if (!apps) return [];
            const directorySet = new Set(payload.directories);
            const allIds: string[] = [];
            const totalBatches = Math.ceil(payload.paths.length / batchSize);

            for (let batch = 0; batch < totalBatches; batch++) {
                const start = batch * batchSize;
                const end = Math.min(start + batchSize, payload.paths.length);
                for (let i = start; i < end; i++) {
                    const path = payload.paths[i];
                    const itemType = payload.itemTypes?.[i] ?? "file";
                    allIds.push(
                        apps.upsertItem(categoryId, {
                            name: getNameFromPath(path),
                            path: itemType === "url" ? undefined : path,
                            url: itemType === "url" ? path : undefined,
                            itemType,
                            isDirectory: directorySet.has(path),
                            iconBase64: normalizeIconBase64(payload.icon_base64s[i] ?? null),
                            hasCustomIcon: false,
                        }),
                    );
                }
                if (batch < totalBatches - 1) {
                    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
                }
            }
            return allIds;
        }

        function applyDropIcons(
            categoryId: string,
            paths: string[],
            iconBase64s: Array<string | null>,
        ) {
            const apps = getAppsService();
            if (!apps) return;
            const list = getLauncherItemsByCategoryId(categoryId);
            const pathToIcon = new Map<string, string>();
            for (let i = 0; i < paths.length; i++) {
                const icon = normalizeIconBase64(iconBase64s[i]);
                if (!icon) continue;
                pathToIcon.set(paths[i], icon);
                setCachedLauncherIcon(paths[i], icon);
            }
            if (pathToIcon.size === 0) return;
            for (const item of list) {
                const icon = pathToIcon.get(item.path);
                if (icon === undefined) continue;
                apps.updateItem(categoryId, item.id, { iconBase64: icon, hasCustomIcon: false });
            }
        }

        function addUrlLauncherItemToCategory(
            categoryId: string,
            payload: { name: string; url: string; icon_base64?: string | null },
        ): string {
            const apps = getAppsService();
            if (!apps) return createLauncherItemId();
            return apps.upsertItem(categoryId, {
                name: payload.name,
                url: payload.url,
                itemType: "url",
                iconBase64: payload.icon_base64 ?? null,
                hasCustomIcon: payload.icon_base64 != null,
            });
        }

        function updateLauncherItemIcon(categoryId: string, itemId: string, iconBase64: string) {
            const apps = getAppsService();
            const normalizedIcon = normalizeIconBase64(iconBase64);
            if (!apps) return;
            apps.updateItem(categoryId, itemId, {
                iconBase64: normalizedIcon,
                hasCustomIcon: false,
            });
        }

        function setLauncherItemIcon(categoryId: string, itemId: string, iconBase64: string) {
            const apps = getAppsService();
            if (!apps) return;
            apps.updateItem(categoryId, itemId, {
                iconBase64: normalizeIconBase64(iconBase64),
                hasCustomIcon: true,
            });
        }

        function resetLauncherItemIcon(categoryId: string, itemId: string) {
            const currentItem = getLauncherItemById(categoryId, itemId);
            if (!currentItem) return;
            const restoredIcon =
                currentItem.itemType === "file"
                    ? getCachedOriginalIconForPath(currentItem.path)
                    : null;
            getAppsService()?.updateItem(categoryId, itemId, {
                iconBase64: restoredIcon,
                hasCustomIcon: false,
            });
        }

        function removeDependenciesMatching(predicate: (d: LaunchDependency) => boolean) {
            const apps = getAppsService();
            if (!apps) return;
            const nextByCategoryId: Record<string, LauncherItem[]> = {};
            for (const [categoryId, items] of Object.entries(apps.itemsByCategoryId.value)) {
                nextByCategoryId[categoryId] = (items as LauncherItem[]).map((item) => {
                    const nextDeps = item.launchDependencies.filter((d) => !predicate(d));
                    if (nextDeps.length === item.launchDependencies.length) return item;
                    return { ...item, launchDependencies: nextDeps };
                });
            }
            apps.itemsByCategoryId.value = nextByCategoryId as never;
        }

        function remapDependencyCategoryRefs(
            mappings: Array<{ fromCategoryId: string; toCategoryId: string; itemId: string }>,
        ) {
            if (mappings.length === 0) return;
            const apps = getAppsService();
            if (!apps) return;
            const keyMap = new Map(
                mappings.map((m) => [`${m.fromCategoryId}:${m.itemId}`, m.toCategoryId]),
            );
            const nextByCategoryId: Record<string, LauncherItem[]> = {};
            for (const [categoryId, items] of Object.entries(apps.itemsByCategoryId.value)) {
                nextByCategoryId[categoryId] = (items as LauncherItem[]).map((item) => {
                    let changed = false;
                    const nextDeps = item.launchDependencies.map((d) => {
                        const to = keyMap.get(`${d.categoryId}:${d.itemId}`);
                        if (!to || to === d.categoryId) return d;
                        changed = true;
                        return { ...d, categoryId: to };
                    });
                    return changed ? { ...item, launchDependencies: nextDeps } : item;
                });
            }
            apps.itemsByCategoryId.value = nextByCategoryId as never;
        }

        function deleteCategoryCleanup(categoryId: string) {
            const apps = getAppsService();
            if (!apps) return;
            const removedItems = apps.getItems(categoryId);
            removeCachedLauncherIcons(removedItems.map((x) => x.path));
            apps.deleteCategoryCleanup(categoryId);
        }

        function hasCustomIcon(categoryId: string, itemId: string): boolean {
            const item = getLauncherItemById(categoryId, itemId);
            if (!item) return false;
            return normalizeHasCustomIcon(item.hasCustomIcon);
        }

        function getLauncherItemMergeKey(item: LauncherItem): string | null {
            return `${item.itemType}:${item.url || item.path}:${item.name}`;
        }

        function toggleFavorite(categoryId: string, itemId: string) {
            getAppsService()?.togglePin(categoryId, itemId);
        }

        function isItemPinned(itemId: string): boolean {
            return getAppsService()?.isPinned(itemId) ?? false;
        }

        function recordUsage(categoryId: string, itemId: string) {
            getAppsService()?.recordUsage(categoryId, itemId);
        }

        function getAllItems(): LauncherItem[] {
            const apps = getAppsService();
            if (apps) return Object.values(apps.itemsByCategoryId.value).flat() as LauncherItem[];
            return Object.values(launcherItemsByCategoryId.value).flat();
        }

        function getFavoriteItems(): LauncherItem[] {
            return getAllItems().filter((x) => x.isFavorite);
        }

        function getRecentItems(limit: number = 10): LauncherItem[] {
            return getAllItems()
                .filter((x) => x.lastUsedAt)
                .sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0))
                .slice(0, limit);
        }

        function getPinnedMergedItems(limit: number = 10) {
            return getFavoriteItems().slice(0, limit);
        }

        function getRecentUsedMergedItems(limit: number = 5) {
            return getRecentItems(limit);
        }

        function clearRecentUsed() {
            getAppsService()?.clearRecentUsed();
        }

        function importLauncherItems(
            items: Record<string, LauncherItem[]>,
            _options: { refreshDerivedIcons?: boolean } = {},
        ) {
            getAppsService()?.importItems(items as never, { emitEvents: true });
        }

        return {
            launcherItemsByCategoryId,
            getLauncherItemsByCategoryId,
            setLauncherItemsByCategoryId,
            getLauncherItemById,
            createLauncherItemInCategory,
            updateLauncherItem,
            updateLauncherItems,
            deleteLauncherItem,
            deleteLauncherItems,
            moveLauncherItems,
            addLauncherItemsToCategory,
            addLauncherItemsToCategoryBatched,
            applyDropIcons,
            addUrlLauncherItemToCategory,
            updateLauncherItemIcon,
            setLauncherItemIcon,
            resetLauncherItemIcon,
            removeDependenciesMatching,
            remapDependencyCategoryRefs,
            deleteCategoryCleanup,
            hasCustomIcon,
            getLauncherItemMergeKey,
            toggleFavorite,
            isItemPinned,
            recordUsage,
            getFavoriteItems,
            getRecentItems,
            getPinnedMergedItems,
            getRecentUsedMergedItems,
            clearRecentUsed,
            importLauncherItems,
            getAllItems,
            createLauncherItemId,
        };
    },
    {
        persist: createVersionedPersistConfig("items", ["launcherItemsByCategoryId"]),
    },
);

export { getCachedLauncherIcon, setCachedLauncherIcon };
