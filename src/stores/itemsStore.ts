import { defineStore } from "pinia";
import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { createVersionedPersistConfig } from "../utils/versioned-persist";
import { itemEventBus } from "../events/itemEvents";
import {
    normalizeIconBase64,
    normalizeHasCustomIcon,
    normalizeDelaySeconds,
    normalizeLaunchDependencies,
    getNameFromPath,
    cacheOriginalIconForFileItem,
    getCachedOriginalIconForPath,
} from "../composables/useItemsHelper";
import {
    getCachedLauncherIcon,
    setCachedLauncherIcon,
    removeCachedLauncherIcons,
} from "../utils/launcher-icon-cache";

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

export const useItemsStore = defineStore(
    "items",
    () => {
        const launcherItemsByCategoryId = ref<Record<string, LauncherItem[]>>({});

        function notifyCreated(categoryId: string, item: LauncherItem) {
            itemEventBus.emit({ type: 'item:created', categoryId, item });
        }

        function notifyUpdated(categoryId: string, item: LauncherItem) {
            itemEventBus.emit({ type: 'item:updated', categoryId, item });
        }

        function notifyDeleted(categoryId: string, itemId: string) {
            itemEventBus.emit({ type: 'item:deleted', categoryId, itemId });
        }

        function notifyMoved(fromCategoryId: string, toCategoryId: string, itemIds: string[]) {
            itemEventBus.emit({ type: 'item:moved', fromCategoryId, toCategoryId, itemIds });
        }

        function notifyIconUpdated(categoryId: string, itemId: string, iconBase64: string | null) {
            itemEventBus.emit({ type: 'item:iconUpdated', categoryId, itemId, iconBase64 });
        }

        function createLauncherItemId() {
            return `item-${crypto.randomUUID()}`;
        }

        function getLauncherItemsByCategoryId(categoryId: string): LauncherItem[] {
            return launcherItemsByCategoryId.value[categoryId] || [];
        }

        function setLauncherItemsByCategoryId(categoryId: string, items: LauncherItem[]) {
            launcherItemsByCategoryId.value = {
                ...launcherItemsByCategoryId.value,
                [categoryId]: items,
            };
        }

        function getLauncherItemById(categoryId: string, itemId: string): LauncherItem | null {
            const list = getLauncherItemsByCategoryId(categoryId);
            return list.find((x) => x.id === itemId) || null;
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
            }
        ): string {
            const existing = getLauncherItemsByCategoryId(categoryId);
            const iconBase64 = normalizeIconBase64(payload.iconBase64 ?? null);
            const id = createLauncherItemId();

            if (payload.itemType === "file" && payload.path) {
                cacheOriginalIconForFileItem(payload.itemType, payload.path, iconBase64);
            }

            const newItem: LauncherItem = {
                id,
                name: payload.name,
                path: payload.itemType === "url" ? "" : (payload.path ?? ""),
                url: payload.itemType === "url" ? payload.url : undefined,
                itemType: payload.itemType,
                isDirectory: payload.itemType === "file" ? !!payload.isDirectory : false,
                iconBase64,
                hasCustomIcon: iconBase64 !== null,
                isFavorite: false,
                lastUsedAt: undefined,
                usageCount: 0,
                launchDependencies: normalizeLaunchDependencies(payload.launchDependencies, {
                    categoryId,
                    itemId: id,
                }),
                launchDelaySeconds: normalizeDelaySeconds(payload.launchDelaySeconds),
            };

            setLauncherItemsByCategoryId(categoryId, [...existing, newItem]);
            notifyCreated(categoryId, newItem);

            return id;
        }

        function updateLauncherItem(
            categoryId: string,
            itemId: string,
            patch: Partial<Pick<LauncherItem, "name" | "url" | "path" | "launchDependencies" | "launchDelaySeconds">>
        ) {
            const list = getLauncherItemsByCategoryId(categoryId);
            const index = list.findIndex((x) => x.id === itemId);
            if (index === -1) return;

            const updated: LauncherItem = {
                ...list[index],
                ...patch,
                launchDependencies: patch.launchDependencies !== undefined
                    ? normalizeLaunchDependencies(patch.launchDependencies, { categoryId, itemId })
                    : list[index].launchDependencies,
                launchDelaySeconds: patch.launchDelaySeconds !== undefined
                    ? normalizeDelaySeconds(patch.launchDelaySeconds)
                    : list[index].launchDelaySeconds,
            };

            const next = [...list];
            next[index] = updated;
            setLauncherItemsByCategoryId(categoryId, next);
            notifyUpdated(categoryId, updated);
        }

        function updateLauncherItems(
            categoryId: string,
            itemIds: string[],
            patch: Partial<Pick<LauncherItem, "launchDelaySeconds">>
        ) {
            const targetIds = new Set(itemIds);
            if (targetIds.size === 0) return;

            const list = getLauncherItemsByCategoryId(categoryId);
            const updatedItems: LauncherItem[] = [];
            let changed = false;

            const next = list.map((item) => {
                if (!targetIds.has(item.id)) return item;

                const updatedItem: LauncherItem = {
                    ...item,
                    launchDelaySeconds: patch.launchDelaySeconds !== undefined
                        ? normalizeDelaySeconds(patch.launchDelaySeconds)
                        : item.launchDelaySeconds,
                };

                updatedItems.push(updatedItem);
                changed = true;
                return updatedItem;
            });

            if (!changed) return;

            setLauncherItemsByCategoryId(categoryId, next);
            for (const item of updatedItems) {
                notifyUpdated(categoryId, item);
            }
        }

        function deleteLauncherItem(categoryId: string, itemId: string) {
            const list = getLauncherItemsByCategoryId(categoryId);
            const index = list.findIndex((x) => x.id === itemId);
            if (index === -1) return;

            const next = list.filter((x) => x.id !== itemId);
            setLauncherItemsByCategoryId(categoryId, next);
            notifyDeleted(categoryId, itemId);
        }

        function deleteLauncherItems(categoryId: string, itemIds: string[]) {
            const targetIds = new Set(itemIds);
            if (targetIds.size === 0) return;

            const list = getLauncherItemsByCategoryId(categoryId);
            const next = list.filter((item) => !targetIds.has(item.id));
            setLauncherItemsByCategoryId(categoryId, next);

            for (const itemId of itemIds) {
                notifyDeleted(categoryId, itemId);
            }
        }

        function moveLauncherItems(
            sourceCategoryId: string,
            targetCategoryId: string,
            itemIds: string[]
        ) {
            if (sourceCategoryId === targetCategoryId) return;

            const requestedIds = new Set(itemIds);
            if (requestedIds.size === 0) return;

            const sourceItems = getLauncherItemsByCategoryId(sourceCategoryId);
            const targetItems = getLauncherItemsByCategoryId(targetCategoryId);
            const targetItemIds = new Set(targetItems.map((item) => item.id));

            const movedItems = sourceItems.filter(
                (item) => requestedIds.has(item.id) && !targetItemIds.has(item.id)
            );

            if (movedItems.length === 0) return;

            const movedIds = new Set(movedItems.map((item) => item.id));

            setLauncherItemsByCategoryId(
                sourceCategoryId,
                sourceItems.filter((item) => !movedIds.has(item.id))
            );
            setLauncherItemsByCategoryId(targetCategoryId, [...targetItems, ...movedItems]);

            notifyMoved(sourceCategoryId, targetCategoryId, itemIds);
        }

        function addLauncherItemsToCategory(
            categoryId: string,
            payload: {
                paths: string[];
                directories: string[];
                icon_base64s: Array<string | null>;
                itemTypes?: Array<"file" | "url">;
            }
        ) {
            const existing = getLauncherItemsByCategoryId(categoryId);
            const directorySet = new Set(payload.directories);

            const nextItems: LauncherItem[] = payload.paths.map((path, index) => {
                const iconBase64 = normalizeIconBase64(
                    payload.icon_base64s[index] !== undefined
                        ? payload.icon_base64s[index]
                        : null,
                );
                const itemType = payload.itemTypes?.[index] ?? "file";
                cacheOriginalIconForFileItem(itemType, path, iconBase64);
                return {
                    id: createLauncherItemId(),
                    name: getNameFromPath(path),
                    path: itemType === "url" ? "" : path,
                    url: itemType === "url" ? path : undefined,
                    itemType,
                    isDirectory: directorySet.has(path),
                    iconBase64,
                    hasCustomIcon: false,
                    isFavorite: false,
                    lastUsedAt: undefined,
                    usageCount: 0,
                    launchDependencies: [],
                    launchDelaySeconds: 0,
                };
            });

            setLauncherItemsByCategoryId(categoryId, [...existing, ...nextItems]);
            for (const item of nextItems) {
                notifyCreated(categoryId, item);
            }
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
            const { paths, directories, icon_base64s, itemTypes } = payload;
            const directorySet = new Set(directories);
            const allIds: string[] = [];
            const totalBatches = Math.ceil(paths.length / batchSize);

            for (let batch = 0; batch < totalBatches; batch++) {
                const start = batch * batchSize;
                const end = Math.min(start + batchSize, paths.length);

                const existing = getLauncherItemsByCategoryId(categoryId);
                const batchItems: LauncherItem[] = [];

                for (let i = start; i < end; i++) {
                    const iconBase64 = normalizeIconBase64(icon_base64s[i] ?? null);
                    const itemType = itemTypes?.[i] ?? "file";
                    cacheOriginalIconForFileItem(itemType, paths[i], iconBase64);
                    const id = createLauncherItemId();
                    allIds.push(id);
                    batchItems.push({
                        id,
                        name: getNameFromPath(paths[i]),
                        path: itemType === "url" ? "" : paths[i],
                        url: itemType === "url" ? paths[i] : undefined,
                        itemType,
                        isDirectory: directorySet.has(paths[i]),
                        iconBase64,
                        hasCustomIcon: false,
                        isFavorite: false,
                        lastUsedAt: undefined,
                        usageCount: 0,
                        launchDependencies: [],
                        launchDelaySeconds: 0,
                    });
                }

                setLauncherItemsByCategoryId(categoryId, [...existing, ...batchItems]);
                for (const item of batchItems) {
                    notifyCreated(categoryId, item);
                }

                if (batch < totalBatches - 1) {
                    await new Promise<void>((resolve) =>
                        requestAnimationFrame(() => resolve()),
                    );
                }
            }

            return allIds;
        }

        function applyDropIcons(
            categoryId: string,
            paths: string[],
            iconBase64s: Array<string | null>,
        ) {
            const list = getLauncherItemsByCategoryId(categoryId);
            const pathToIcon = new Map<string, string>();
            for (let i = 0; i < paths.length; i++) {
                const icon = normalizeIconBase64(iconBase64s[i]);
                if (!icon) continue;
                pathToIcon.set(paths[i], icon);
                setCachedLauncherIcon(paths[i], icon);
            }

            if (pathToIcon.size === 0) return;

            let changed = false;
            const updatedItems: LauncherItem[] = [];
            const next = list.map((item) => {
                const icon = pathToIcon.get(item.path);
                if (icon === undefined) return item;
                changed = true;
                const updated = { ...item, iconBase64: icon, hasCustomIcon: false };
                updatedItems.push(updated);
                return updated;
            });

            if (changed) {
                setLauncherItemsByCategoryId(categoryId, next);
                for (const item of updatedItems) {
                    notifyUpdated(categoryId, item);
                }
            }
        }

        function addUrlLauncherItemToCategory(
            categoryId: string,
            payload: {
                name: string;
                url: string;
                icon_base64?: string | null;
            },
        ): string {
            const existing = getLauncherItemsByCategoryId(categoryId);
            const iconBase64 = normalizeIconBase64(payload.icon_base64 ?? null);
            const newItem: LauncherItem = {
                id: createLauncherItemId(),
                name: payload.name,
                path: "",
                url: payload.url,
                itemType: "url",
                isDirectory: false,
                iconBase64,
                hasCustomIcon: iconBase64 !== null,
                isFavorite: false,
                lastUsedAt: undefined,
                usageCount: 0,
                launchDependencies: [],
                launchDelaySeconds: 0,
            };
            setLauncherItemsByCategoryId(categoryId, [...existing, newItem]);
            notifyCreated(categoryId, newItem);
            return newItem.id;
        }

        function updateLauncherItemIcon(categoryId: string, itemId: string, iconBase64: string) {
            const list = getLauncherItemsByCategoryId(categoryId);
            const index = list.findIndex((x) => x.id === itemId);
            if (index === -1) return;
            const normalizedIcon = normalizeIconBase64(iconBase64);
            const currentItem = list[index];
            if (currentItem.itemType === "file") {
                cacheOriginalIconForFileItem(currentItem.itemType, currentItem.path, normalizedIcon);
            }
            const next = [...list];
            next[index] = {
                ...currentItem,
                iconBase64: normalizedIcon,
                hasCustomIcon: false,
            };
            setLauncherItemsByCategoryId(categoryId, next);
        }

        function setLauncherItemIcon(categoryId: string, itemId: string, iconBase64: string) {
            const list = getLauncherItemsByCategoryId(categoryId);
            const index = list.findIndex((x) => x.id === itemId);
            if (index === -1) return;
            const normalizedIcon = normalizeIconBase64(iconBase64);
            const next = [...list];
            next[index] = {
                ...next[index],
                iconBase64: normalizedIcon,
                hasCustomIcon: true,
            };
            setLauncherItemsByCategoryId(categoryId, next);
            notifyIconUpdated(categoryId, itemId, normalizedIcon);
        }

        function resetLauncherItemIcon(categoryId: string, itemId: string) {
            const list = getLauncherItemsByCategoryId(categoryId);
            const index = list.findIndex((x) => x.id === itemId);
            if (index === -1) return;
            const currentItem = list[index];
            const next = [...list];
            const restoredIcon =
                currentItem.itemType === "file"
                    ? getCachedOriginalIconForPath(currentItem.path)
                    : null;
            next[index] = {
                ...currentItem,
                iconBase64: restoredIcon,
                hasCustomIcon: false,
            };
            setLauncherItemsByCategoryId(categoryId, next);

            if (currentItem.itemType === "file" && !restoredIcon) {
                void hydrateMissingIconsForItems([{ categoryId, itemId }], {
                    forceReplace: true,
                });
                return;
            }

            if (currentItem.itemType === "url" && currentItem.url) {
                void refreshLauncherItemUrlFavicon(
                    categoryId,
                    itemId,
                    currentItem.url,
                    updateLauncherItemIcon,
                );
            }
        }

        function removeDependenciesMatching(
            predicate: (dependency: LaunchDependency) => boolean,
        ) {
            const nextByCategoryId: Record<string, LauncherItem[]> = {};

            for (const [categoryId, items] of Object.entries(
                launcherItemsByCategoryId.value,
            )) {
                nextByCategoryId[categoryId] = items.map((item) => {
                    const nextDependencies = item.launchDependencies.filter(
                        (dependency) => !predicate(dependency),
                    );

                    if (nextDependencies.length === item.launchDependencies.length) {
                        return item;
                    }

                    return {
                        ...item,
                        launchDependencies: nextDependencies,
                    };
                });
            }

            launcherItemsByCategoryId.value = nextByCategoryId;
        }

        function remapDependencyCategoryRefs(
            mappings: Array<{
                fromCategoryId: string;
                toCategoryId: string;
                itemId: string;
            }>,
        ) {
            if (mappings.length === 0) return;

            const categoryIdByDependencyKey = new Map(
                mappings.map((mapping) => [
                    `${mapping.fromCategoryId}:${mapping.itemId}`,
                    mapping.toCategoryId,
                ]),
            );

            let changed = false;
            const nextByCategoryId: Record<string, LauncherItem[]> = {};

            for (const [categoryId, items] of Object.entries(
                launcherItemsByCategoryId.value,
            )) {
                nextByCategoryId[categoryId] = items.map((item) => {
                    let itemChanged = false;
                    const nextDependencies = item.launchDependencies.map((dependency) => {
                        const nextCategoryId = categoryIdByDependencyKey.get(
                            `${dependency.categoryId}:${dependency.itemId}`,
                        );
                        if (!nextCategoryId || nextCategoryId === dependency.categoryId) {
                            return dependency;
                        }

                        itemChanged = true;
                        return {
                            ...dependency,
                            categoryId: nextCategoryId,
                        };
                    });

                    if (!itemChanged) {
                        return item;
                    }

                    changed = true;
                    return {
                        ...item,
                        launchDependencies: nextDependencies,
                    };
                });
            }

            if (changed) {
                launcherItemsByCategoryId.value = nextByCategoryId;
            }
        }

        function deleteCategoryCleanup(categoryId: string) {
            const next = { ...launcherItemsByCategoryId.value };
            const removedItems = next[categoryId] || [];
            delete next[categoryId];
            launcherItemsByCategoryId.value = next;

            removeCachedLauncherIcons(removedItems.map((x) => x.path));

            for (const item of removedItems) {
                notifyDeleted(categoryId, item.id);
            }
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
            const list = getLauncherItemsByCategoryId(categoryId);
            const item = list.find((x) => x.id === itemId);
            if (!item) return;

            item.isFavorite = !item.isFavorite;
            notifyUpdated(categoryId, item);
        }

        function isItemPinned(itemId: string): boolean {
            for (const items of Object.values(launcherItemsByCategoryId.value)) {
                const item = items.find((x) => x.id === itemId);
                if (item?.isFavorite) return true;
            }
            return false;
        }

        function recordUsage(categoryId: string, itemId: string) {
            const list = getLauncherItemsByCategoryId(categoryId);
            const item = list.find((x) => x.id === itemId);
            if (!item) return;

            item.lastUsedAt = Date.now();
            item.usageCount = (item.usageCount || 0) + 1;
            notifyUpdated(categoryId, item);
        }

        function getFavoriteItems(): LauncherItem[] {
            const allItems = Object.values(launcherItemsByCategoryId.value).flat();
            return allItems.filter((x) => x.isFavorite);
        }

        function getRecentItems(limit: number = 10): LauncherItem[] {
            const allItems = Object.values(launcherItemsByCategoryId.value).flat();
            return allItems
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
            for (const items of Object.values(launcherItemsByCategoryId.value)) {
                for (const item of items) {
                    if (item.lastUsedAt) {
                        item.lastUsedAt = undefined;
                        item.usageCount = 0;
                    }
                }
            }
            const allItems = Object.values(launcherItemsByCategoryId.value).flat();
            for (const item of allItems) {
                notifyUpdated('', item);
            }
        }

        function importLauncherItems(
            items: Record<string, LauncherItem[]>,
            _options: { refreshDerivedIcons?: boolean } = {}
        ) {
            launcherItemsByCategoryId.value = items;
            for (const [categoryId, categoryItems] of Object.entries(items)) {
                for (const item of categoryItems) {
                    notifyCreated(categoryId, item);
                }
            }
        }

        function getAllItems(): LauncherItem[] {
            return Object.values(launcherItemsByCategoryId.value).flat();
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
    }
);

async function hydrateMissingIconsForItems(
    targets: Array<{ categoryId: string; itemId: string }>,
    options: { forceReplace?: boolean; skipCache?: boolean } = {},
): Promise<void> {
    if (!Array.isArray(targets) || targets.length === 0) return;
    const forceReplace = options.forceReplace === true;
    const skipCache = options.skipCache === true;

    const itemsStore = useItemsStore();
    const toHydrate: Array<{ categoryId: string; item: LauncherItem }> = [];

    for (const target of targets) {
        const item = itemsStore.getLauncherItemById(target.categoryId, target.itemId);
        if (!item) continue;
        if (item.hasCustomIcon && !forceReplace) continue;
        if (item.iconBase64 && !forceReplace) continue;
        if (!skipCache) {
            const cached = getCachedLauncherIcon(item.path);
            if (cached) {
                const normalizedCached = normalizeIconBase64(cached);
                if (normalizedCached) {
                    itemsStore.updateLauncherItemIcon(target.categoryId, target.itemId, normalizedCached);
                    continue;
                }
            }
        }
        toHydrate.push({ categoryId: target.categoryId, item });
    }

    if (toHydrate.length === 0) return;

    const fileItems = toHydrate.filter((t) => t.item.itemType === "file");
    if (fileItems.length > 0) {
        const paths = fileItems.map((t) => t.item.path);
        try {
            const result = await invoke<Array<string | null>>("extract_icons_from_paths", {
                paths,
                maxEdge: 128,
            });
            for (let i = 0; i < fileItems.length; i++) {
                const icon = result[i];
                if (icon) {
                    const normalized = normalizeIconBase64(icon);
                    if (normalized) {
                        setCachedLauncherIcon(fileItems[i].item.path, normalized);
                        itemsStore.updateLauncherItemIcon(fileItems[i].categoryId, fileItems[i].item.id, normalized);
                    }
                }
            }
        } catch (error) {
            console.warn("Failed to hydrate icons for items:", error);
        }
    }

    const urlItems = toHydrate.filter((t) => t.item.itemType === "url" && t.item.url);
    for (const target of urlItems) {
        if (target.item.url) {
            await refreshLauncherItemUrlFavicon(
                target.categoryId,
                target.item.id,
                target.item.url,
                itemsStore.updateLauncherItemIcon,
            );
        }
    }
}

async function refreshLauncherItemUrlFavicon(
    categoryId: string,
    itemId: string,
    url: string,
    callback: (categoryId: string, itemId: string, iconBase64: string) => void,
): Promise<void> {
    try {
        const result = await invoke<{ ok: boolean; value?: string }>("fetch_favicon_from_url", { url });
        if (result.ok && result.value) {
            const normalized = normalizeIconBase64(result.value);
            if (normalized) {
                callback(categoryId, itemId, normalized);
            }
        }
    } catch (error) {
        console.warn("Failed to refresh launcher favicon:", error);
    }
}
