import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { invoke } from "../utils/invoke-wrapper";
import { useCategoryStore, type Category } from "./categoryStore";
import { useUIStore } from "./uiStore";
import { useStatsStore } from "./statsStore";
import { createVersionedPersistConfig } from "../utils/versioned-persist";
import {
    fuzzyMatchLauncherText,
    mergeLauncherItems,
    mergeRustSearchResults,
    normalizeLauncherItemKey,
} from "./launcher-search";

export type LauncherItem = {
    id: string;
    name: string;
    path: string;
    url?: string;
    itemType: 'file' | 'url';
    isDirectory: boolean;
    iconBase64: string | null;
    originalIconBase64?: string | null;
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

export type RustSearchResult = {
    id: string;
    name: string;
    path: string;
    category_id: string;
    fuzzy_score: number;
    matched_pinyin_initial: boolean;
    matched_pinyin_full: boolean;
    rank_score: number;
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
            return `item-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        }

        function normalizeDelaySeconds(value: number | undefined): number {
            if (!Number.isFinite(value)) return 0;
            return Math.max(0, Math.floor(value ?? 0));
        }

        function normalizeLaunchDependencies(
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

        function deleteLauncherItem(categoryId: string, itemId: string) {
            const list = getLauncherItemsByCategoryId(categoryId);
            const index = list.findIndex((x) => x.id === itemId);
            if (index === -1) return;
            const next = [...list];
            next.splice(index, 1);
            setLauncherItemsByCategoryId(categoryId, next);
            pinnedItemIds.value = pinnedItemIds.value.filter((id) => id !== itemId);
            recentUsedItems.value = recentUsedItems.value.filter(
                (x) => !(x.categoryId === categoryId && x.itemId === itemId)
            );
            removeDependenciesMatching(
                (dependency) =>
                    dependency.categoryId === categoryId && dependency.itemId === itemId
            );
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
                const iconBase64 =
                    payload.icon_base64s[index] !== undefined
                        ? payload.icon_base64s[index]
                        : null;
                const itemType = payload.itemTypes?.[index] ?? 'file';
                return {
                    id: createLauncherItemId(),
                    name: getNameFromPath(path),
                    path: itemType === 'url' ? '' : path,
                    url: itemType === 'url' ? path : undefined,
                    itemType,
                    isDirectory: directorySet.has(path),
                    iconBase64,
                    originalIconBase64: iconBase64,
                    launchDependencies: [],
                    launchDelaySeconds: 0,
                };
            });

            setLauncherItemsByCategoryId(categoryId, [...existing, ...nextItems]);
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
            const iconBase64 = payload.icon_base64 ?? null;
            const newItem: LauncherItem = {
                id: createLauncherItemId(),
                name: payload.name,
                path: '',
                url: payload.url,
                itemType: 'url',
                isDirectory: false,
                iconBase64,
                originalIconBase64: iconBase64,
                launchDependencies: [],
                launchDelaySeconds: 0,
            };
            setLauncherItemsByCategoryId(categoryId, [...existing, newItem]);
            return newItem.id;
        }

        function updateLauncherItemIcon(categoryId: string, itemId: string, iconBase64: string) {
            const list = getLauncherItemsByCategoryId(categoryId);
            const index = list.findIndex((x) => x.id === itemId);
            if (index === -1) return;
            const next = [...list];
            next[index] = {
                ...next[index],
                iconBase64,
                originalIconBase64: iconBase64,
            };
            setLauncherItemsByCategoryId(categoryId, next);
        }

        function deleteCategoryCleanup(categoryId: string) {
            const next = { ...launcherItemsByCategoryId.value };
            const removedItemIds = (next[categoryId] || []).map((x) => x.id);
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
            removeDependenciesMatching(
                (dependency) => dependency.categoryId === categoryId
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

        async function syncSearchIndex() {
            try {
                const categoryStore = useCategoryStore();
                const items: Array<{
                    id: string;
                    name: string;
                    path: string;
                    category_id: string;
                    usage_count: number;
                    last_used_at: number;
                    is_pinned: boolean;
                    search_tokens: string[];
                    rank_score: number;
                }> = [];

                const pinnedSet = new Set(pinnedItemIds.value);
                const usageMap = new Map<string, number>();
                const lastUsedMap = new Map<string, number>();

                for (const recent of recentUsedItems.value) {
                    const key = `${recent.categoryId}-${recent.itemId}`;
                    const existingUsage = usageMap.get(key) || 0;
                    usageMap.set(key, existingUsage + recent.usageCount);
                    if (!lastUsedMap.has(key) || lastUsedMap.get(key)! < recent.usedAt) {
                        lastUsedMap.set(key, recent.usedAt);
                    }
                }

                for (const cat of categoryStore.categories) {
                    const catItems = getLauncherItemsByCategoryId(cat.id);
                    for (const item of catItems) {
                        const key = `${cat.id}-${item.id}`;
                        items.push({
                            id: item.id,
                            name: item.name,
                            path: item.path,
                            category_id: cat.id,
                            usage_count: usageMap.get(key) || 0,
                            last_used_at: lastUsedMap.get(key) || 0,
                            is_pinned: pinnedSet.has(item.id),
                            search_tokens: [],
                            rank_score: 0,
                        });
                    }
                }

                const result = await invoke("update_search_items", { items });
                if (!result.ok) {
                    console.error("Failed to sync search index:", result.error);
                    isRustSearchReady.value = false;
                    return;
                }
                isRustSearchReady.value = true;
            } catch (e) {
                console.error("Failed to sync search index:", e);
                isRustSearchReady.value = false;
            }
        }

        async function rustSearch(keyword: string, limit: number = 20): Promise<void> {
            if (!keyword.trim()) {
                rustSearchResults.value = [];
                return;
            }
            try {
                const result = await invoke<RustSearchResult[]>("search_apps", {
                    query: { keyword, limit },
                });
                if (!result.ok) {
                    console.error("Rust search failed:", result.error);
                    rustSearchResults.value = [];
                    return;
                }
                rustSearchResults.value = result.value;
            } catch (e) {
                console.error("Rust search failed:", e);
                rustSearchResults.value = [];
            }
        }

        const globalSearchMergedResults = computed<GlobalSearchMergedResult[]>(() => {
            const keyword = searchKeyword.value.trim();
            if (!keyword) return [];

            const categoryStore = useCategoryStore();
            const matches: Array<{ item: LauncherItem; categoryId: string }> = [];

            for (const cat of categoryStore.categories) {
                const items = getLauncherItemsByCategoryId(cat.id);
                for (const item of items) {
                    const matchName = fuzzyMatchLauncherText(item.name, keyword);
                    const matchPath = item.path
                        ? fuzzyMatchLauncherText(item.path, keyword)
                        : false;
                    if (!matchName && !matchPath) continue;
                    matches.push({ item, categoryId: cat.id });
                }
            }

            return mergeLauncherItems(matches, (categoryId) =>
                categoryStore.getCategoryById(categoryId)
            );
        });

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
        }

        function getLauncherItemMergeKey(item: LauncherItem): string | null {
            return normalizeLauncherItemKey(item);
        }

        function togglePinned(categoryId: string, itemId: string) {
            const item = getLauncherItemById(categoryId, itemId);
            if (!item) return;
            const isPinned = pinnedItemIds.value.includes(itemId);
            if (isPinned) {
                pinnedItemIds.value = pinnedItemIds.value.filter((id) => id !== itemId);
            } else {
                pinnedItemIds.value = [...pinnedItemIds.value, itemId];
            }
        }

        function isItemPinned(itemId: string): boolean {
            return pinnedItemIds.value.includes(itemId);
        }

        function recordItemUsage(categoryId: string, itemId: string) {
            const now = Date.now();
            const existingIndex = recentUsedItems.value.findIndex(
                r => r.categoryId === categoryId && r.itemId === itemId
            );
            
            if (existingIndex !== -1) {
                const existing = recentUsedItems.value[existingIndex];
                const newList = recentUsedItems.value.filter((_, i) => i !== existingIndex);
                newList.unshift({
                    categoryId,
                    itemId,
                    usedAt: now,
                    usageCount: existing.usageCount + 1,
                });
                recentUsedItems.value = newList;
            } else {
                recentUsedItems.value = [
                    { categoryId, itemId, usedAt: now, usageCount: 1 },
                    ...recentUsedItems.value,
                ];
            }
            
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

        function importPinnedItemIds(newIds: string[]) {
            pinnedItemIds.value = [...new Set(newIds)];
        }

        function reorderPinnedItemIds(newOrder: string[]) {
            const validIds = newOrder.filter(id => pinnedItemIds.value.includes(id));
            const otherIds = pinnedItemIds.value.filter(id => !newOrder.includes(id));
            pinnedItemIds.value = [...validIds, ...otherIds];
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
                pinnedItemIds.value = pinnedItemIds.value.filter(id => allValidIds.has(id));
            }

            return result;
        }

        function getSmartSortedItems(categoryId: string): LauncherItem[] {
            const raw = launcherItemsByCategoryId.value[categoryId];
            if (!raw || raw.length === 0) return [];

            const stats = useStatsStore();
            const pinnedSet = new Set(pinnedItemIds.value);
            const orderMap = new Map(stats.getSmartSortOrder(categoryId, raw.map(i => i.id)).map((id, idx) => [id, idx]));

            return [...raw].sort((a, b) => {
                const aPinned = pinnedSet.has(a.id);
                const bPinned = pinnedSet.has(b.id);
                if (aPinned && !bPinned) return -1;
                if (!aPinned && bPinned) return 1;

                const aOrder = orderMap.get(a.id) ?? 9999;
                const bOrder = orderMap.get(b.id) ?? 9999;
                return aOrder - bOrder;
            });
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
            deleteLauncherItem,
            addLauncherItemsToCategory,
            addUrlLauncherItemToCategory,
            updateLauncherItemIcon,
            deleteCategoryCleanup,
            setLauncherItemIcon,
            resetLauncherItemIcon,
            hasCustomIcon,
            globalSearchMergedResults,
            rustSearchMergedResults,
            clearSearch,
            getLauncherItemMergeKey,
            togglePinned,
            isItemPinned,
            recordItemUsage,
            clearRecentUsed,
            importLauncherItems,
            importPinnedItemIds,
            reorderPinnedItemIds,
            importRecentUsedItems,
            getRecentUsedItems,
            getRecentUsedItemInfo,
            getRecentUsedMergedItems,
            getPinnedMergedItems,
            syncSearchIndex,
            rustSearch,
            getSmartSortedItems,
            recordConfirmedSearch,
        };
    },
    { persist: createVersionedPersistConfig("launcher", ["launcherItemsByCategoryId", "pinnedItemIds", "recentUsedItems"]) }
);
