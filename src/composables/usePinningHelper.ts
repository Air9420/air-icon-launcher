import { computed } from "vue";
import { useCategoryStore, type Category } from "../stores/categoryStore";
import { useStatsStore } from "../stores/statsStore";
import { useUIStore } from "../stores/uiStore";
import { normalizeLauncherItemKey } from "../stores/launcher-search";
import { itemEventBus } from "../events/itemEvents";
import type {
    LauncherItem,
    RecentUsedItem,
    RecentUsedMergedItem,
    PinnedMergedItem,
} from "../stores/launcherStore";

export function usePinningHelper(
    getLauncherItemsByCategoryId: (categoryId: string) => LauncherItem[],
    getLauncherItemById: (categoryId: string, itemId: string) => LauncherItem | null,
    pinnedItemIds: { value: string[] },
    recentUsedItems: { value: RecentUsedItem[] },
    onRefreshAllItems?: () => void
) {
    function buildLauncherItemIndexes(categories: Category[]) {
        const itemById = new Map<string, { item: LauncherItem; categoryId: string }>();
        const itemByCompositeKey = new Map<string, LauncherItem>();

        for (const category of categories) {
            const items = getLauncherItemsByCategoryId(category.id);
            for (const item of items) {
                if (!itemById.has(item.id)) {
                    itemById.set(item.id, { item, categoryId: category.id });
                }
                itemByCompositeKey.set(`${category.id}:${item.id}`, item);
            }
        }

        return {
            itemById,
            itemByCompositeKey,
        };
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
        itemEventBus.emit({ type: 'item:pinningToggled', categoryId, itemId, isPinned: !isPinned });
    }

    function isItemPinned(itemId: string): boolean {
        return pinnedItemIds.value.includes(itemId);
    }

    function recordItemUsage(categoryId: string, itemId: string, usedAtOverride?: number) {
        const now = Number.isFinite(usedAtOverride)
            ? Math.floor(usedAtOverride as number)
            : Date.now();
        const stats = useStatsStore();
        stats.ensureLaunchTrackingStarted(recentUsedItems.value, now);
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

        stats.recordLaunchEvent({
            categoryId,
            itemId,
            usedAt: now,
        });
        const record: RecentUsedItem = recentUsedItems.value[0];
        itemEventBus.emit({
            type: 'item:usageRecorded',
            categoryId,
            itemId,
            usageCount: record?.usageCount ?? 1,
            lastUsedAt: now,
        });
    }

    function clearRecentUsed() {
        recentUsedItems.value = [];
        const stats = useStatsStore();
        stats.clearLaunchHistory();
        onRefreshAllItems?.();
    }

    function importPinnedItemIds(newIds: string[]) {
        pinnedItemIds.value = [...new Set(newIds)];
        onRefreshAllItems?.();
    }

    function reorderPinnedItemIds(newOrder: string[]) {
        const pinnedSet = new Set(pinnedItemIds.value);
        const newOrderSet = new Set(newOrder);
        const validIds = newOrder.filter(id => pinnedSet.has(id));
        const otherIds = pinnedItemIds.value.filter(id => !newOrderSet.has(id));
        pinnedItemIds.value = [...validIds, ...otherIds];
    }

    function importRecentUsedItems(newItems: RecentUsedItem[]) {
        recentUsedItems.value = newItems;
        const stats = useStatsStore();
        stats.clearLaunchHistory();
        onRefreshAllItems?.();
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

    const pinnedMergedItemsBase = computed<PinnedMergedItem[]>(() => {
        const categoryStore = useCategoryStore();
        const categories = categoryStore.categories;
        const categoryById = new Map(categories.map((category) => [category.id, category] as const));
        const { itemById } = buildLauncherItemIndexes(categories);
        const pinnedSet = new Set(pinnedItemIds.value);

        const mergedByKey = new Map<
            string,
            {
                key: string;
                item: LauncherItem;
                primaryCategoryId: string;
                categoryIds: Set<string>;
            }
        >();

        for (const category of categories) {
            const items = getLauncherItemsByCategoryId(category.id);
            for (const item of items) {
                if (!pinnedSet.has(item.id)) continue;
                const key = getLauncherItemMergeKey(item);
                if (!key) continue;

                const existing = mergedByKey.get(key);
                if (!existing) {
                    mergedByKey.set(key, {
                        key,
                        item,
                        primaryCategoryId: category.id,
                        categoryIds: new Set([category.id]),
                    });
                } else {
                    existing.categoryIds.add(category.id);
                }
            }
        }

        const validPinnedIds: string[] = [];
        const emittedKeys = new Set<string>();
        const mergedItems: PinnedMergedItem[] = [];

        for (const itemId of pinnedItemIds.value) {
            const entry = itemById.get(itemId);
            if (!entry) {
                continue;
            }

            validPinnedIds.push(itemId);
            const key = getLauncherItemMergeKey(entry.item);
            if (!key || emittedKeys.has(key)) {
                continue;
            }

            const merged = mergedByKey.get(key);
            if (!merged) {
                continue;
            }

            const mergedCategories: Category[] = [];
            for (const categoryId of merged.categoryIds) {
                const category = categoryById.get(categoryId);
                if (category) {
                    mergedCategories.push(category);
                }
            }

            mergedItems.push({
                key: merged.key,
                item: merged.item,
                primaryCategoryId: merged.primaryCategoryId,
                categories: mergedCategories,
            });
            emittedKeys.add(key);
        }

        if (validPinnedIds.length !== pinnedItemIds.value.length) {
            pinnedItemIds.value = validPinnedIds;
        }

        return mergedItems;
    });

    const recentUsedMergedItemsBase = computed<RecentUsedMergedItem[]>(() => {
        const categoryStore = useCategoryStore();
        const categories = categoryStore.categories;
        const categoryById = new Map(categories.map((category) => [category.id, category] as const));
        const { itemByCompositeKey } = buildLauncherItemIndexes(categories);

        const mergedByKey = new Map<
            string,
            {
                key: string;
                usedAt: number;
                recent: RecentUsedItem;
                item: LauncherItem;
                categoryIds: Set<string>;
            }
        >();

        for (const recent of recentUsedItems.value) {
            const item = itemByCompositeKey.get(`${recent.categoryId}:${recent.itemId}`);
            if (!item) continue;

            const key = getLauncherItemMergeKey(item);
            if (!key) continue;

            const existing = mergedByKey.get(key);
            if (!existing) {
                mergedByKey.set(key, {
                    key,
                    usedAt: recent.usedAt,
                    recent,
                    item,
                    categoryIds: new Set([recent.categoryId]),
                });
            } else {
                existing.categoryIds.add(recent.categoryId);
            }
        }

        const mergedItems: RecentUsedMergedItem[] = [];
        for (const entry of mergedByKey.values()) {
            const mergedCategories: Category[] = [];
            for (const categoryId of entry.categoryIds) {
                const category = categoryById.get(categoryId);
                if (category) {
                    mergedCategories.push(category);
                }
            }

            mergedItems.push({
                key: entry.key,
                usedAt: entry.usedAt,
                recent: entry.recent,
                item: entry.item,
                categories: mergedCategories,
            });
        }

        return mergedItems;
    });

    function getRecentUsedMergedItems(limit: number = 5, excludePinned?: { visible: boolean }): RecentUsedMergedItem[] {
        const uiStore = useUIStore();
        let mergedItems = recentUsedMergedItemsBase.value;

        if (excludePinned?.visible) {
            const visibleLimit = uiStore.getHomeSectionLimit("pinned");
            const pinnedKeys = new Set(
                pinnedMergedItemsBase.value
                    .slice(0, visibleLimit)
                    .map((item) => item.key)
            );
            mergedItems = mergedItems.filter((item) => !pinnedKeys.has(item.key));
        }

        return mergedItems.slice(0, limit);
    }

    function getPinnedMergedItems(limit: number = 10): PinnedMergedItem[] {
        return pinnedMergedItemsBase.value.slice(0, limit);
    }

    function getSmartSortedItems(
        categoryId: string,
        launcherItemsByCategoryId: Record<string, LauncherItem[]>
    ): LauncherItem[] {
        const raw = launcherItemsByCategoryId[categoryId];
        if (!raw || raw.length === 0) return [];

        const stats = useStatsStore();
        const pinnedSet = new Set(pinnedItemIds.value);
        const pinnedItems = raw.filter((item) => pinnedSet.has(item.id));
        const unpinnedItems = raw.filter((item) => !pinnedSet.has(item.id));

        const pinnedOrderMap = new Map(
            stats
                .getSmartSortOrder(categoryId, pinnedItems.map((i) => i.id), pinnedItemIds.value)
                .map((id, idx) => [id, idx] as const)
        );
        const unpinnedOrderMap = new Map(
            stats
                .getSmartSortOrder(categoryId, unpinnedItems.map((i) => i.id), pinnedItemIds.value)
                .map((id, idx) => [id, idx] as const)
        );

        return [...raw].sort((a, b) => {
            const aPinned = pinnedSet.has(a.id);
            const bPinned = pinnedSet.has(b.id);
            if (aPinned !== bPinned) return aPinned ? -1 : 1;

            const orderMap = aPinned ? pinnedOrderMap : unpinnedOrderMap;
            const aOrder = orderMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
            const bOrder = orderMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;
            return aOrder - bOrder;
        });
    }

    return {
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
        buildLauncherItemIndexes,
    };
}
