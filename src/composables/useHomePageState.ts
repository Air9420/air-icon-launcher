import { computed } from "vue";
import { useLauncherStore, type RecentUsedMergedItem, type PinnedMergedItem } from "../stores/launcherStore";
import { useStatsStore } from "../stores/statsStore";
import { useUIStore } from "../stores/uiStore";
import { useCategoryStore } from "../stores/categoryStore";
import {
    getRecentRecommendationTailQuota,
    splitRecentDisplayItems,
} from "../utils/home-recommendations";

export type RecentDisplayItem = RecentUsedMergedItem & {
    featureBadgeText?: string;
};

export function useHomePageState() {
    const store = useLauncherStore();
    const statsStore = useStatsStore();
    const uiStore = useUIStore();
    const categoryStore = useCategoryStore();

    const recentMergedItems = computed<RecentUsedMergedItem[]>(() => {
        return store.getRecentUsedMergedItems(
            Math.max(uiStore.getHomeSectionLimit("recent") * 3, uiStore.getHomeSectionLimit("recent") + 12),
            { visible: true }
        );
    });

    const pinnedMergedItems = computed<PinnedMergedItem[]>(() => {
        return store.getPinnedMergedItems(uiStore.getHomeSectionLimit("pinned"));
    });

    const currentTimeSlot = computed(() => statsStore.getCurrentTimeSlot());

    const timeBasedTailCandidates = computed<RecentUsedMergedItem[]>(() => {
        const visiblePinnedKeys = new Set(pinnedMergedItems.value.map((item) => item.key));
        const mergedItems = new Map<string, RecentUsedMergedItem>();

        for (const recommendation of statsStore.timeBasedRecommendations) {
            const item = store.getLauncherItemById(recommendation.categoryId, recommendation.itemId);
            const category = categoryStore.getCategoryById(recommendation.categoryId);
            if (!item || !category) continue;

            const key = store.getLauncherItemMergeKey(item) ?? `${recommendation.categoryId}:${recommendation.itemId}`;
            if (visiblePinnedKeys.has(key)) continue;

            const existing = mergedItems.get(key);
            if (existing) {
                if (!existing.categories.some((entry) => entry.id === category.id)) {
                    existing.categories = [...existing.categories, category];
                }
                continue;
            }

            mergedItems.set(key, {
                key,
                usedAt: recommendation.lastUsedAt,
                recent: {
                    categoryId: recommendation.categoryId,
                    itemId: recommendation.itemId,
                    usedAt: recommendation.lastUsedAt,
                    usageCount: recommendation.timeSlotCounts[currentTimeSlot.value] || 1,
                },
                item,
                categories: [category],
            });
        }

        return [...mergedItems.values()];
    });

    const recentDisplayItems = computed<RecentDisplayItem[]>(() => {
        const recentLimit = uiStore.getHomeSectionLimit("recent");
        const tailQuota = getRecentRecommendationTailQuota(recentLimit);
        const { headItems, tailItems } = splitRecentDisplayItems(
            recentMergedItems.value,
            timeBasedTailCandidates.value,
            recentLimit,
            tailQuota
        );

        const displayTailItems: RecentDisplayItem[] = tailItems
            .map((candidate) => ({
                ...candidate,
                featureBadgeText: "时段",
            }));

        return [...headItems, ...displayTailItems];
    });

    return {
        recentMergedItems,
        pinnedMergedItems,
        timeBasedTailCandidates,
        recentDisplayItems,
    };
}
