import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { useCategoryStore, type Category } from "./categoryStore";
import { useUIStore } from "./uiStore";
import { createVersionedPersistConfig } from "../utils/versioned-persist";

export type LauncherItem = {
    id: string;
    name: string;
    path: string;
    isDirectory: boolean;
    iconBase64: string | null;
    originalIconBase64?: string | null;
    isFavorite?: boolean;
    lastUsedAt?: number;
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
};

export type RecentUsedItem = {
    categoryId: string;
    itemId: string;
    usedAt: number;
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

export const useLauncherStore = defineStore(
    "launcher",
    () => {
        const searchKeyword = ref<string>("");
        const favoriteItemIds = ref<string[]>([]);
        const pinnedItemIds = computed<string[]>(() => favoriteItemIds.value);
        const recentUsedItems = ref<RecentUsedItem[]>([]);
        const launcherItemsByCategoryId = ref<Record<string, LauncherItem[]>>({});

        function createLauncherItemId() {
            return `item-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        }

        function getNameFromPath(path: string) {
            const normalized = path.replace(/\\/g, "/");
            const segments = normalized.split("/").filter(Boolean);
            const base = segments[segments.length - 1] || path;
            const lower = base.toLowerCase();
            if (lower.endsWith(".lnk")) return base.slice(0, -4);
            if (lower.endsWith(".exe")) return base.slice(0, -4);
            return base;
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

        function updateLauncherItem(
            categoryId: string,
            itemId: string,
            patch: Partial<Pick<LauncherItem, "name">>
        ) {
            const list = getLauncherItemsByCategoryId(categoryId);
            const index = list.findIndex((x) => x.id === itemId);
            if (index === -1) return;
            const next = [...list];
            next[index] = { ...next[index], ...patch };
            setLauncherItemsByCategoryId(categoryId, next);
        }

        function deleteLauncherItem(categoryId: string, itemId: string) {
            const list = getLauncherItemsByCategoryId(categoryId);
            const index = list.findIndex((x) => x.id === itemId);
            if (index === -1) return;
            const next = [...list];
            next.splice(index, 1);
            setLauncherItemsByCategoryId(categoryId, next);
            favoriteItemIds.value = favoriteItemIds.value.filter((id) => id !== itemId);
            recentUsedItems.value = recentUsedItems.value.filter(
                (x) => !(x.categoryId === categoryId && x.itemId === itemId)
            );
        }

        function addLauncherItemsToCategory(
            categoryId: string,
            payload: {
                paths: string[];
                directories: string[];
                icon_base64s: Array<string | null>;
            }
        ) {
            const existing = getLauncherItemsByCategoryId(categoryId);
            const directorySet = new Set(payload.directories);

            const nextItems: LauncherItem[] = payload.paths.map((path, index) => {
                const iconBase64 =
                    payload.icon_base64s[index] !== undefined
                        ? payload.icon_base64s[index]
                        : null;
                return {
                    id: createLauncherItemId(),
                    name: getNameFromPath(path),
                    path,
                    isDirectory: directorySet.has(path),
                    iconBase64,
                    originalIconBase64: iconBase64,
                };
            });

            setLauncherItemsByCategoryId(categoryId, [...existing, ...nextItems]);
        }

        function deleteCategoryCleanup(categoryId: string) {
            const next = { ...launcherItemsByCategoryId.value };
            const removedItemIds = (next[categoryId] || []).map((x) => x.id);
            delete next[categoryId];
            launcherItemsByCategoryId.value = next;
            if (removedItemIds.length) {
                const removedSet = new Set(removedItemIds);
                favoriteItemIds.value = favoriteItemIds.value.filter(
                    (id) => !removedSet.has(id)
                );
            }
            recentUsedItems.value = recentUsedItems.value.filter(
                (x) => x.categoryId !== categoryId
            );
        }

        function setLauncherItemIcon(categoryId: string, itemId: string, iconBase64: string) {
            const list = getLauncherItemsByCategoryId(categoryId);
            const index = list.findIndex((x) => x.id === itemId);
            if (index === -1) return;
            const next = [...list];
            next[index] = { ...next[index], iconBase64 };
            setLauncherItemsByCategoryId(categoryId, next);
        }

        function resetLauncherItemIcon(categoryId: string, itemId: string) {
            const list = getLauncherItemsByCategoryId(categoryId);
            const index = list.findIndex((x) => x.id === itemId);
            if (index === -1) return;
            const next = [...list];
            next[index] = { 
                ...next[index], 
                iconBase64: next[index].originalIconBase64 ?? null 
            };
            setLauncherItemsByCategoryId(categoryId, next);
        }

        function hasCustomIcon(categoryId: string, itemId: string): boolean {
            const item = getLauncherItemById(categoryId, itemId);
            if (!item) return false;
            return item.iconBase64 !== item.originalIconBase64;
        }

        function fuzzyMatch(text: string, keyword: string): boolean {
            const lowerText = text.toLowerCase();
            const lowerKeyword = keyword.toLowerCase();
            if (lowerText.includes(lowerKeyword)) return true;
            let keywordIndex = 0;
            for (let i = 0; i < lowerText.length && keywordIndex < lowerKeyword.length; i++) {
                if (lowerText[i] === lowerKeyword[keywordIndex]) {
                    keywordIndex++;
                }
            }
            return keywordIndex === lowerKeyword.length;
        }

        const globalSearchResults = computed<GlobalSearchResult[]>(() => {
            const keyword = searchKeyword.value.trim();
            if (!keyword) return [];
            const results: GlobalSearchResult[] = [];
            const categoryStore = useCategoryStore();
            for (const cat of categoryStore.categories) {
                const items = getLauncherItemsByCategoryId(cat.id);
                for (const item of items) {
                    const matchName = fuzzyMatch(item.name, keyword);
                    const matchPath = item.path ? fuzzyMatch(item.path, keyword) : false;
                    if (matchName || matchPath) {
                        results.push({
                            item,
                            categoryId: cat.id,
                            categoryName: cat.name,
                        });
                    }
                }
            }
            return results;
        });

        const globalSearchMergedResults = computed<GlobalSearchMergedResult[]>(() => {
            const keyword = searchKeyword.value.trim();
            if (!keyword) return [];

            const categoryStore = useCategoryStore();

            const map = new Map<
                string,
                {
                    key: string;
                    item: LauncherItem;
                    primaryCategoryId: string;
                    categoryIds: string[];
                }
            >();

            for (const cat of categoryStore.categories) {
                const items = getLauncherItemsByCategoryId(cat.id);
                for (const item of items) {
                    const matchName = fuzzyMatch(item.name, keyword);
                    const matchPath = item.path ? fuzzyMatch(item.path, keyword) : false;
                    if (!matchName && !matchPath) continue;

                    const normalizedPath = item.path?.trim().replace(/\\/g, "/").toLowerCase();
                    const normalizedName = item.name?.trim().toLowerCase();
                    const key = normalizedPath || normalizedName;
                    if (!key) continue;

                    const existing = map.get(key);
                    if (!existing) {
                        map.set(key, {
                            key,
                            item,
                            primaryCategoryId: cat.id,
                            categoryIds: [cat.id],
                        });
                    } else if (!existing.categoryIds.includes(cat.id)) {
                        existing.categoryIds.push(cat.id);
                    }
                }
            }

            return [...map.values()].map((x) => ({
                key: x.key,
                item: x.item,
                primaryCategoryId: x.primaryCategoryId,
                categories: x.categoryIds
                    .map((id) => categoryStore.getCategoryById(id))
                    .filter((c): c is Category => c !== null),
            }));
        });

        function clearSearch() {
            searchKeyword.value = "";
        }

        function getLauncherItemMergeKey(item: LauncherItem): string | null {
            const normalizedPath = item.path?.trim().replace(/\\/g, "/").toLowerCase();
            const normalizedName = item.name?.trim().toLowerCase();
            return normalizedPath || normalizedName || null;
        }

        function togglePinned(categoryId: string, itemId: string) {
            const item = getLauncherItemById(categoryId, itemId);
            if (!item) return;
            const isPinned = favoriteItemIds.value.includes(itemId);
            if (isPinned) {
                favoriteItemIds.value = favoriteItemIds.value.filter((id) => id !== itemId);
            } else {
                favoriteItemIds.value = [...favoriteItemIds.value, itemId];
            }
        }

        function isItemPinned(itemId: string): boolean {
            return favoriteItemIds.value.includes(itemId);
        }

        function toggleFavorite(categoryId: string, itemId: string) {
            togglePinned(categoryId, itemId);
        }

        function isItemFavorite(itemId: string): boolean {
            return isItemPinned(itemId);
        }

        function recordItemUsage(categoryId: string, itemId: string) {
            const now = Date.now();
            const existingIndex = recentUsedItems.value.findIndex(
                r => r.categoryId === categoryId && r.itemId === itemId
            );
            if (existingIndex !== -1) {
                recentUsedItems.value.splice(existingIndex, 1);
            }
            recentUsedItems.value.unshift({ categoryId, itemId, usedAt: now });
            if (recentUsedItems.value.length > 50) {
                recentUsedItems.value = recentUsedItems.value.slice(0, 50);
            }
        }

        function clearRecentUsed() {
            recentUsedItems.value = [];
        }

        function importLauncherItems(items: Record<string, LauncherItem[]>) {
            launcherItemsByCategoryId.value = items;
        }

        function importFavoriteItemIds(newIds: string[]) {
            favoriteItemIds.value = [...new Set(newIds)];
        }

        function importPinnedItemIds(newIds: string[]) {
            favoriteItemIds.value = [...new Set(newIds)];
        }

        function reorderPinnedItemIds(newOrder: string[]) {
            const validIds = newOrder.filter(id => favoriteItemIds.value.includes(id));
            const otherIds = favoriteItemIds.value.filter(id => !newOrder.includes(id));
            favoriteItemIds.value = [...validIds, ...otherIds];
        }

        function importRecentUsedItems(newItems: RecentUsedItem[]) {
            recentUsedItems.value = newItems;
        }

        function getRecentUsedItems(limit: number = 5): RecentUsedItem[] {
            return recentUsedItems.value.slice(0, limit);
        }

        function getRecentUsedItemInfo(recentItem: RecentUsedItem): { item: LauncherItem | null; category: Category | null } {
            const categoryStore = useCategoryStore();
            const category = categoryStore.getCategoryById(recentItem.categoryId);
            const item = getLauncherItemById(recentItem.categoryId, recentItem.itemId);
            return { item, category };
        }

        function getRecentUsedMergedItems(limit: number = 5, excludePinned?: { visible: boolean }): RecentUsedMergedItem[] {
            const categoryStore = useCategoryStore();
            const uiStore = useUIStore();

            const pinnedKeys = new Set<string>();
            if (excludePinned?.visible) {
                const visibleLimit = uiStore.getHomeSectionLimit("pinned");
                const visiblePinnedIds = pinnedItemIds.value.slice(0, visibleLimit);
                for (const itemId of visiblePinnedIds) {
                    for (const cat of categoryStore.categories) {
                        const items = getLauncherItemsByCategoryId(cat.id);
                        const item = items.find(i => i.id === itemId);
                        if (item) {
                            const key = getLauncherItemMergeKey(item);
                            if (key) pinnedKeys.add(key);
                            break;
                        }
                    }
                }
            }

            const map = new Map<
                string,
                {
                    key: string;
                    usedAt: number;
                    recent: RecentUsedItem;
                    item: LauncherItem;
                    categoryIds: string[];
                }
            >();

            for (const recent of recentUsedItems.value) {
                const item = getLauncherItemById(recent.categoryId, recent.itemId);
                if (!item) continue;

                const key = getLauncherItemMergeKey(item);
                if (!key) continue;
                if (pinnedKeys.has(key)) continue;

                const existing = map.get(key);
                if (!existing) {
                    map.set(key, {
                        key,
                        usedAt: recent.usedAt,
                        recent,
                        item,
                        categoryIds: [recent.categoryId],
                    });
                } else if (!existing.categoryIds.includes(recent.categoryId)) {
                    existing.categoryIds.push(recent.categoryId);
                }
            }

            return [...map.values()]
                .slice(0, limit)
                .map((x) => ({
                    key: x.key,
                    usedAt: x.usedAt,
                    recent: x.recent,
                    item: x.item,
                    categories: x.categoryIds
                        .map((id) => categoryStore.getCategoryById(id))
                        .filter((c): c is Category => c !== null),
                }));
        }

        function getPinnedMergedItems(limit: number = 10): PinnedMergedItem[] {
            const categoryStore = useCategoryStore();

            const map = new Map<
                string,
                {
                    key: string;
                    item: LauncherItem;
                    primaryCategoryId: string;
                    categoryIds: string[];
                }
            >();

            for (const cat of categoryStore.categories) {
                const items = getLauncherItemsByCategoryId(cat.id);
                for (const item of items) {
                    if (!isItemPinned(item.id)) continue;
                    const key = getLauncherItemMergeKey(item);
                    if (!key) continue;

                    const existing = map.get(key);
                    if (!existing) {
                        map.set(key, {
                            key,
                            item,
                            primaryCategoryId: cat.id,
                            categoryIds: [cat.id],
                        });
                    } else if (!existing.categoryIds.includes(cat.id)) {
                        existing.categoryIds.push(cat.id);
                    }
                }
            }

            const result = pinnedItemIds.value
                .slice(0, limit)
                .map(id => {
                    let found = null;
                    for (const cat of categoryStore.categories) {
                        const items = getLauncherItemsByCategoryId(cat.id);
                        const item = items.find(i => i.id === id);
                        if (item) {
                            const key = getLauncherItemMergeKey(item);
                            const existing = map.get(key || "");
                            if (existing) {
                                found = {
                                    key: existing.key,
                                    item: existing.item,
                                    primaryCategoryId: existing.primaryCategoryId,
                                    categories: existing.categoryIds
                                        .map((cid: string) => categoryStore.getCategoryById(cid))
                                        .filter((c): c is Category => c !== null),
                                };
                                break;
                            }
                        }
                    }
                    return found;
                })
                .filter((x): x is PinnedMergedItem => x !== null);

            const allValidIds = new Set<string>();
            for (const id of pinnedItemIds.value) {
                let found = false;
                for (const cat of categoryStore.categories) {
                    const items = getLauncherItemsByCategoryId(cat.id);
                    if (items.some(i => i.id === id)) {
                        found = true;
                        break;
                    }
                }
                if (found) {
                    allValidIds.add(id);
                }
            }
            const invalidIds = pinnedItemIds.value.filter(id => !allValidIds.has(id));
            if (invalidIds.length > 0) {
                console.log("[PinnedItems] removing invalid ids:", invalidIds);
                favoriteItemIds.value = pinnedItemIds.value.filter(id => allValidIds.has(id));
            }

            return result;
        }

        return {
            searchKeyword,
            favoriteItemIds,
            pinnedItemIds,
            recentUsedItems,
            launcherItemsByCategoryId,
            createLauncherItemId,
            getNameFromPath,
            getLauncherItemsByCategoryId,
            setLauncherItemsByCategoryId,
            getLauncherItemById,
            updateLauncherItem,
            deleteLauncherItem,
            addLauncherItemsToCategory,
            deleteCategoryCleanup,
            setLauncherItemIcon,
            resetLauncherItemIcon,
            hasCustomIcon,
            fuzzyMatch,
            globalSearchResults,
            globalSearchMergedResults,
            clearSearch,
            getLauncherItemMergeKey,
            togglePinned,
            isItemPinned,
            toggleFavorite,
            isItemFavorite,
            recordItemUsage,
            clearRecentUsed,
            importLauncherItems,
            importFavoriteItemIds,
            importPinnedItemIds,
            reorderPinnedItemIds,
            importRecentUsedItems,
            getRecentUsedItems,
            getRecentUsedItemInfo,
            getRecentUsedMergedItems,
            getPinnedMergedItems,
        };
    },
    { persist: createVersionedPersistConfig("launcher", ["launcherItemsByCategoryId", "favoriteItemIds", "recentUsedItems"]) as any }
);
