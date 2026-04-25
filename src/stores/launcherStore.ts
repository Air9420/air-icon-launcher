import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { useCategoryStore, type Category } from "./categoryStore";
import { useStatsStore } from "./statsStore";
import { createVersionedPersistConfig } from "../utils/versioned-persist";
import { mergeRustSearchResults } from "./launcher-search";
import {
    normalizeIconBase64,
    normalizeHasCustomIcon,
    normalizeDelaySeconds,
    normalizeLaunchDependencies,
    getNameFromPath,
    cacheOriginalIconForFileItem,
    getCachedOriginalIconForPath,
    applyCachedOriginalIcon,
    shouldRefreshDerivedIcon,
    normalizeImportedLauncherItem,
    useItemsHelper,
    type LauncherItemRef,
} from "../composables/useItemsHelper";
import { useSearchSync } from "../composables/useSearchSync";
import { usePinningHelper } from "../composables/usePinningHelper";
import { setCachedLauncherIcon } from "../utils/launcher-icon-cache";

export type LauncherItem = {
    id: string;
    name: string;
    path: string;
    url?: string;
    itemType: 'file' | 'url';
    isDirectory: boolean;
    iconBase64: string | null;
    hasCustomIcon?: boolean;
    isFavorite?: boolean;
    lastUsedAt?: number;
    launchDependencies: LaunchDependency[];
    launchDelaySeconds: number;
};

export type LaunchDependency = {
    categoryId: string;
    itemId: string;
    delayAfterSeconds: number;
};

export type GlobalSearchResult = {
    item: LauncherItem;
    categoryId: string;
    categoryName: string;
};

export type GlobalSearchMergedResult = {
    key: string;
    item: LauncherItem;
    primaryCategoryId: string;
    categories: Category[];
    matchType: RustSearchMatchType;
};

export type RecentUsedItem = {
    categoryId: string;
    itemId: string;
    usedAt: number;
    usageCount: number;
};

export type RecentUsedMergedItem = {
    key: string;
    usedAt: number;
    recent: RecentUsedItem;
    item: LauncherItem;
    categories: Category[];
};

export type PinnedMergedItem = {
    key: string;
    item: LauncherItem;
    primaryCategoryId: string;
    categories: Category[];
};

export type RustSearchMatchType =
    | "exact"
    | "prefix"
    | "substring"
    | "pinyin_full"
    | "pinyin_initial"
    | "fuzzy";

export type RustSearchResult = {
    id: string;
    name: string;
    path: string;
    category_id: string;
    match_type: RustSearchMatchType;
    fuzzy_score: number;
    matched_pinyin_initial: boolean;
    matched_pinyin_full: boolean;
    rank_score: number;
};

type ImportLauncherItemsOptions = {
    refreshDerivedIcons?: boolean;
};

type ImportLauncherSnapshotPayload = {
    items: Record<string, LauncherItem[]>;
    pinnedItemIds?: string[];
    recentUsedItems?: RecentUsedItem[];
};

export const useLauncherStore = defineStore(
    "launcher",
    () => {
        const searchKeyword = ref<string>("");
        const pinnedItemIds = ref<string[]>([]);
        const recentUsedItems = ref<RecentUsedItem[]>([]);
        const launcherItemsByCategoryId = ref<Record<string, LauncherItem[]>>({});

        const rustSearchResults = ref<RustSearchResult[]>([]);
        const isRustSearchReady = ref(false);

        function createLauncherItemId() {
            return `item-${crypto.randomUUID()}`;
        }

        function getLauncherItemsByCategoryId(categoryId: string) {
            return launcherItemsByCategoryId.value[categoryId] || [];
        }

        function setLauncherItemsByCategoryId(categoryId: string, items: LauncherItem[]) {
            launcherItemsByCategoryId.value = {
                ...launcherItemsByCategoryId.value,
                [categoryId]: items,
            };
        }

        function getLauncherItemById(categoryId: string, itemId: string) {
            return getLauncherItemsByCategoryId(categoryId).find((x) => x.id === itemId) || null;
        }

        const {
            hydrateMissingIconsForItems,
            refreshLauncherItemUrlFavicon,
        } = useItemsHelper(
            getLauncherItemsByCategoryId,
            getLauncherItemById,
            setLauncherItemsByCategoryId
        );

        const {
            enqueueSearchChanges,
            enqueueSearchUpdateByRef,
            enqueueSearchUpdateByItemId,
            enqueueSearchRefreshForAllItems,
            syncSearchIndexInternal,
            syncSearchIndex,
            searchLauncherItems,
            toSearchIndexItem,
        } = useSearchSync(
            getLauncherItemsByCategoryId,
            getLauncherItemById,
            pinnedItemIds,
            recentUsedItems,
            isRustSearchReady
        );

        const {
            togglePinned,
            isItemPinned,
            recordItemUsage,
            clearRecentUsed,
            importPinnedItemIds,
            reorderPinnedItemIds,
            importRecentUsedItems,
            getRecentUsedItems,
            getRecentUsedItemInfo,
            getRecentUsedMergedItems,
            getPinnedMergedItems,
            getSmartSortedItems,
            getLauncherItemMergeKey,
        } = usePinningHelper(
            getLauncherItemsByCategoryId,
            getLauncherItemById,
            pinnedItemIds,
            recentUsedItems,
            enqueueSearchUpdateByItemId,
            enqueueSearchUpdateByRef,
            enqueueSearchRefreshForAllItems
        );

        function updateLauncherItem(
            categoryId: string,
            itemId: string,
            patch: Partial<Pick<LauncherItem, "name" | "url" | "path" | "launchDependencies" | "launchDelaySeconds">>
        ) {
            const list = getLauncherItemsByCategoryId(categoryId);
            const index = list.findIndex((x) => x.id === itemId);
            if (index === -1) return;
            const next = [...list];
            next[index] = {
                ...next[index],
                ...patch,
                launchDependencies:
                    patch.launchDependencies !== undefined
                        ? normalizeLaunchDependencies(patch.launchDependencies, { categoryId, itemId })
                        : next[index].launchDependencies,
                launchDelaySeconds:
                    patch.launchDelaySeconds !== undefined
                        ? normalizeDelaySeconds(patch.launchDelaySeconds)
                        : next[index].launchDelaySeconds,
            };
            setLauncherItemsByCategoryId(categoryId, next);
            enqueueSearchChanges({
                updated: [toSearchIndexItem(categoryId, next[index])],
            });
        }

        function removeDependenciesMatching(
            predicate: (dependency: LaunchDependency) => boolean
        ) {
            const nextByCategoryId: Record<string, LauncherItem[]> = {};

            for (const [categoryId, items] of Object.entries(launcherItemsByCategoryId.value)) {
                nextByCategoryId[categoryId] = items.map((item) => {
                    const nextDependencies = item.launchDependencies.filter(
                        (dependency) => !predicate(dependency)
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
            }>
        ) {
            if (mappings.length === 0) return;

            const categoryIdByDependencyKey = new Map(
                mappings.map((mapping) => [
                    `${mapping.fromCategoryId}:${mapping.itemId}`,
                    mapping.toCategoryId,
                ])
            );

            let changed = false;
            const nextByCategoryId: Record<string, LauncherItem[]> = {};

            for (const [categoryId, items] of Object.entries(launcherItemsByCategoryId.value)) {
                nextByCategoryId[categoryId] = items.map((item) => {
                    let itemChanged = false;
                    const nextDependencies = item.launchDependencies.map((dependency) => {
                        const nextCategoryId = categoryIdByDependencyKey.get(
                            `${dependency.categoryId}:${dependency.itemId}`
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

        function deleteLauncherItem(categoryId: string, itemId: string) {
            const list = getLauncherItemsByCategoryId(categoryId);
            const index = list.findIndex((x) => x.id === itemId);
            if (index === -1) return;
            const stats = useStatsStore();
            const next = [...list];
            next.splice(index, 1);
            setLauncherItemsByCategoryId(categoryId, next);
            pinnedItemIds.value = pinnedItemIds.value.filter((id) => id !== itemId);
            recentUsedItems.value = recentUsedItems.value.filter(
                (x) => !(x.categoryId === categoryId && x.itemId === itemId)
            );
            stats.removeLaunchEventsForItems(categoryId, [itemId]);
            removeDependenciesMatching(
                (dependency) =>
                    dependency.categoryId === categoryId && dependency.itemId === itemId
            );
            enqueueSearchChanges({
                deleted: [{ category_id: categoryId, id: itemId }],
            });
        }

        function deleteLauncherItems(categoryId: string, itemIds: string[]) {
            const targetIds = new Set(itemIds);
            if (targetIds.size === 0) return;

            const list = getLauncherItemsByCategoryId(categoryId);
            const removedItems = list.filter((item) => targetIds.has(item.id));
            if (removedItems.length === 0) return;
            const stats = useStatsStore();

            setLauncherItemsByCategoryId(
                categoryId,
                list.filter((item) => !targetIds.has(item.id))
            );

            pinnedItemIds.value = pinnedItemIds.value.filter((id) => !targetIds.has(id));
            recentUsedItems.value = recentUsedItems.value.filter(
                (item) => !(item.categoryId === categoryId && targetIds.has(item.itemId))
            );
            stats.removeLaunchEventsForItems(categoryId, [...targetIds]);
            removeDependenciesMatching(
                (dependency) =>
                    dependency.categoryId === categoryId && targetIds.has(dependency.itemId)
            );
            enqueueSearchChanges({
                deleted: removedItems.map((item) => ({
                    category_id: categoryId,
                    id: item.id,
                })),
            });
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
                    launchDelaySeconds:
                        patch.launchDelaySeconds !== undefined
                            ? normalizeDelaySeconds(patch.launchDelaySeconds)
                            : item.launchDelaySeconds,
                };

                updatedItems.push(updatedItem);
                changed = true;
                return updatedItem;
            });

            if (!changed) return;

            setLauncherItemsByCategoryId(categoryId, next);
            enqueueSearchChanges({
                updated: updatedItems.map((item) => toSearchIndexItem(categoryId, item)),
            });
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

            const stats = useStatsStore();
            const movedIds = new Set(movedItems.map((item) => item.id));
            setLauncherItemsByCategoryId(
                sourceCategoryId,
                sourceItems.filter((item) => !movedIds.has(item.id))
            );
            setLauncherItemsByCategoryId(targetCategoryId, [...targetItems, ...movedItems]);

            recentUsedItems.value = recentUsedItems.value.map((recentItem) => {
                if (
                    recentItem.categoryId !== sourceCategoryId ||
                    !movedIds.has(recentItem.itemId)
                ) {
                    return recentItem;
                }

                return {
                    ...recentItem,
                    categoryId: targetCategoryId,
                };
            });

            remapDependencyCategoryRefs(
                movedItems.map((item) => ({
                    fromCategoryId: sourceCategoryId,
                    toCategoryId: targetCategoryId,
                    itemId: item.id,
                }))
            );
            stats.remapLaunchEventCategoryRefs(
                movedItems.map((item) => ({
                    fromCategoryId: sourceCategoryId,
                    toCategoryId: targetCategoryId,
                    itemId: item.id,
                }))
            );

            enqueueSearchChanges({
                deleted: movedItems.map((item) => ({
                    category_id: sourceCategoryId,
                    id: item.id,
                })),
                added: movedItems.map((item) => toSearchIndexItem(targetCategoryId, item)),
            });
        }

        function addLauncherItemsToCategory(
            categoryId: string,
            payload: {
                paths: string[];
                directories: string[];
                icon_base64s: Array<string | null>;
                itemTypes?: Array<'file' | 'url'>;
            }
        ) {
            const existing = getLauncherItemsByCategoryId(categoryId);
            const directorySet = new Set(payload.directories);

            const nextItems: LauncherItem[] = payload.paths.map((path, index) => {
                const iconBase64 = normalizeIconBase64(
                    payload.icon_base64s[index] !== undefined
                        ? payload.icon_base64s[index]
                        : null
                );
                const itemType = payload.itemTypes?.[index] ?? 'file';
                cacheOriginalIconForFileItem(itemType, path, iconBase64);
                return {
                    id: createLauncherItemId(),
                    name: getNameFromPath(path),
                    path: itemType === 'url' ? '' : path,
                    url: itemType === 'url' ? path : undefined,
                    itemType,
                    isDirectory: directorySet.has(path),
                    iconBase64,
                    hasCustomIcon: false,
                    launchDependencies: [],
                    launchDelaySeconds: 0,
                };
            });

            setLauncherItemsByCategoryId(categoryId, [...existing, ...nextItems]);
            enqueueSearchChanges({
                added: nextItems.map((item) => toSearchIndexItem(categoryId, item)),
            });
        }

        async function addLauncherItemsToCategoryBatched(
            categoryId: string,
            payload: {
                paths: string[];
                directories: string[];
                icon_base64s: Array<string | null>;
                itemTypes?: Array<'file' | 'url'>;
            },
            batchSize: number = 20
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
                    const itemType = itemTypes?.[i] ?? 'file';
                    cacheOriginalIconForFileItem(itemType, paths[i], iconBase64);
                    const id = createLauncherItemId();
                    allIds.push(id);
                    batchItems.push({
                        id,
                        name: getNameFromPath(paths[i]),
                        path: itemType === 'url' ? '' : paths[i],
                        url: itemType === 'url' ? paths[i] : undefined,
                        itemType,
                        isDirectory: directorySet.has(paths[i]),
                        iconBase64,
                        hasCustomIcon: false,
                        launchDependencies: [],
                        launchDelaySeconds: 0,
                    });
                }

                setLauncherItemsByCategoryId(categoryId, [...existing, ...batchItems]);
                enqueueSearchChanges({
                    added: batchItems.map((item) => toSearchIndexItem(categoryId, item)),
                });

                if (batch < totalBatches - 1) {
                    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
                }
            }

            return allIds;
        }

        function applyDropIcons(categoryId: string, paths: string[], iconBase64s: Array<string | null>) {
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
            const next = list.map(item => {
                const icon = pathToIcon.get(item.path);
                if (icon === undefined) return item;
                changed = true;
                const updated = { ...item, iconBase64: icon, hasCustomIcon: false };
                updatedItems.push(updated);
                return updated;
            });

            if (changed) {
                setLauncherItemsByCategoryId(categoryId, next);
                enqueueSearchChanges({
                    updated: updatedItems.map((item) => toSearchIndexItem(categoryId, item)),
                });
            }
        }

        function addUrlLauncherItemToCategory(
            categoryId: string,
            payload: {
                name: string;
                url: string;
                icon_base64?: string | null;
            }
        ): string {
            const existing = getLauncherItemsByCategoryId(categoryId);
            const iconBase64 = normalizeIconBase64(payload.icon_base64 ?? null);
            const newItem: LauncherItem = {
                id: createLauncherItemId(),
                name: payload.name,
                path: '',
                url: payload.url,
                itemType: 'url',
                isDirectory: false,
                iconBase64,
                hasCustomIcon: iconBase64 !== null,
                launchDependencies: [],
                launchDelaySeconds: 0,
            };
            setLauncherItemsByCategoryId(categoryId, [...existing, newItem]);
            enqueueSearchChanges({
                added: [toSearchIndexItem(categoryId, newItem)],
            });
            return newItem.id;
        }

        function createLauncherItemInCategory(
            categoryId: string,
            payload: {
                name: string;
                path?: string;
                url?: string;
                itemType: 'file' | 'url';
                isDirectory?: boolean;
                iconBase64?: string | null;
                launchDependencies?: LaunchDependency[];
                launchDelaySeconds?: number;
            }
        ): string {
            const existing = getLauncherItemsByCategoryId(categoryId);
            const iconBase64 = normalizeIconBase64(payload.iconBase64 ?? null);
            const id = createLauncherItemId();

            if (payload.itemType === 'file' && payload.path) {
                cacheOriginalIconForFileItem(payload.itemType, payload.path, iconBase64);
            }

            const newItem: LauncherItem = {
                id,
                name: payload.name,
                path: payload.itemType === 'url' ? '' : (payload.path ?? ''),
                url: payload.itemType === 'url' ? payload.url : undefined,
                itemType: payload.itemType,
                isDirectory: payload.itemType === 'file' ? !!payload.isDirectory : false,
                iconBase64,
                hasCustomIcon: iconBase64 !== null,
                launchDependencies: normalizeLaunchDependencies(payload.launchDependencies, {
                    categoryId,
                    itemId: id,
                }),
                launchDelaySeconds: normalizeDelaySeconds(payload.launchDelaySeconds),
            };

            setLauncherItemsByCategoryId(categoryId, [...existing, newItem]);
            enqueueSearchChanges({
                added: [toSearchIndexItem(categoryId, newItem)],
            });

            return id;
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

        function deleteCategoryCleanup(categoryId: string) {
            const next = { ...launcherItemsByCategoryId.value };
            const removedItems = next[categoryId] || [];
            const removedItemIds = removedItems.map((x) => x.id);
            const stats = useStatsStore();
            delete next[categoryId];
            launcherItemsByCategoryId.value = next;
            if (removedItemIds.length) {
                const removedSet = new Set(removedItemIds);
                pinnedItemIds.value = pinnedItemIds.value.filter(
                    (id) => !removedSet.has(id)
                );
            }
            recentUsedItems.value = recentUsedItems.value.filter(
                (x) => x.categoryId !== categoryId
            );
            stats.removeLaunchEventsForCategory(categoryId);
            removeDependenciesMatching(
                (dependency) => dependency.categoryId === categoryId
            );
            if (removedItems.length > 0) {
                enqueueSearchChanges({
                    deleted: removedItems.map((item) => ({
                        category_id: categoryId,
                        id: item.id,
                    })),
                });
            }
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
                void refreshLauncherItemUrlFavicon(categoryId, itemId, currentItem.url, updateLauncherItemIcon);
            }
        }

        function hasCustomIcon(categoryId: string, itemId: string): boolean {
            const item = getLauncherItemById(categoryId, itemId);
            if (!item) return false;
            return normalizeHasCustomIcon(item.hasCustomIcon);
        }

        async function rustSearch(keyword: string, limit: number = 20): Promise<void> {
            rustSearchResults.value = await searchLauncherItems({ keyword, limit });
        }

        function setRustSearchResults(results: RustSearchResult[]) {
            rustSearchResults.value = results;
        }

        const rustSearchMergedResults = computed<GlobalSearchMergedResult[]>(() => {
            const categoryStore = useCategoryStore();
            return mergeRustSearchResults(
                rustSearchResults.value,
                (categoryId) => categoryStore.getCategoryById(categoryId),
                getLauncherItemById
            );
        });

        function clearSearch() {
            searchKeyword.value = "";
            rustSearchResults.value = [];
        }

        function importLauncherItems(
            items: Record<string, LauncherItem[]>,
            options: ImportLauncherItemsOptions = {}
        ) {
            const nextItems: Record<string, LauncherItem[]> = {};
            const refreshTargets: LauncherItemRef[] = [];
            for (const [categoryId, categoryItems] of Object.entries(items)) {
                nextItems[categoryId] = categoryItems.map((item) => {
                    const nextItem = applyCachedOriginalIcon(
                        normalizeImportedLauncherItem(
                            item as LauncherItem & { originalIconBase64?: string | null }
                        )
                    );
                    if (options.refreshDerivedIcons && shouldRefreshDerivedIcon(nextItem)) {
                        refreshTargets.push({
                            categoryId,
                            itemId: nextItem.id,
                        });
                    }
                    return nextItem;
                });
            }
            launcherItemsByCategoryId.value = nextItems;
            if (options.refreshDerivedIcons && refreshTargets.length > 0) {
                void hydrateMissingIconsForItems(refreshTargets, {
                    forceReplace: true,
                    skipCache: true,
                });
            }
            if (isRustSearchReady.value) {
                void syncSearchIndexInternal(true);
            }
        }

        function importLauncherSnapshot(
            snapshot: ImportLauncherSnapshotPayload,
            options: ImportLauncherItemsOptions = {}
        ) {
            importLauncherItems(snapshot.items, options);
            pinnedItemIds.value = [...new Set(snapshot.pinnedItemIds ?? [])];
            recentUsedItems.value = [...(snapshot.recentUsedItems ?? [])];
            const stats = useStatsStore();
            stats.clearLaunchHistory();
            enqueueSearchRefreshForAllItems();
        }

        function recordConfirmedSearch() {
            const keyword = searchKeyword.value.trim();
            if (keyword.length >= 2) {
                const stats = useStatsStore();
                stats.recordSearch(keyword);
            }
        }

        return {
            searchKeyword,
            pinnedItemIds,
            recentUsedItems,
            launcherItemsByCategoryId,
            rustSearchResults,
            isRustSearchReady,
            createLauncherItemId,
            getNameFromPath,
            getLauncherItemsByCategoryId,
            setLauncherItemsByCategoryId,
            getLauncherItemById,
            updateLauncherItem,
            updateLauncherItems,
            deleteLauncherItem,
            deleteLauncherItems,
            moveLauncherItems,
            addLauncherItemsToCategory,
            addLauncherItemsToCategoryBatched,
            applyDropIcons,
            addUrlLauncherItemToCategory,
            createLauncherItemInCategory,
            updateLauncherItemIcon,
            deleteCategoryCleanup,
            setLauncherItemIcon,
            resetLauncherItemIcon,
            hasCustomIcon,
            hydrateMissingIconsForItems,
            rustSearchMergedResults,
            clearSearch,
            getLauncherItemMergeKey,
            togglePinned,
            isItemPinned,
            recordItemUsage,
            clearRecentUsed,
            importLauncherItems,
            importLauncherSnapshot,
            importPinnedItemIds,
            reorderPinnedItemIds,
            importRecentUsedItems,
            getRecentUsedItems,
            getRecentUsedItemInfo,
            getRecentUsedMergedItems,
            getPinnedMergedItems,
            syncSearchIndex,
            searchLauncherItems,
            rustSearch,
            setRustSearchResults,
            getSmartSortedItems: (categoryId: string) => getSmartSortedItems(categoryId, launcherItemsByCategoryId.value),
            recordConfirmedSearch,
        };
    },
    { persist: createVersionedPersistConfig("launcher", ["launcherItemsByCategoryId", "pinnedItemIds", "recentUsedItems"]) }
);
