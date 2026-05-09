import { computed } from "vue";
import { useLauncherStore, type RecentUsedMergedItem, type PinnedMergedItem } from "../stores/launcherStore";
import {
    normalizeExternalExecutableIdentity,
    useStatsStore,
    type ExternalRecentLaunchRecord,
} from "../stores/statsStore";
import { useUIStore } from "../stores/uiStore";
import { useCategoryStore } from "../stores/categoryStore";
import { normalizePathKey } from "../utils/scan-fallback";
import {
    getRecentRecommendationTailQuota,
    splitRecentDisplayItems,
} from "../utils/home-recommendations";
import type { ScannedMatchType } from "../types/scan-cache";

export type RecentDisplayItem = RecentUsedMergedItem & {
    featureBadgeText?: string;
};

export type ExternalRecentDisplayItem = {
    key: string;
    usedAt: number;
    external: ExternalRecentLaunchRecord;
    featureBadgeText?: string;
    matchType?: ScannedMatchType;
};

export type HomeRecentDisplayItem = RecentDisplayItem | ExternalRecentDisplayItem;

export function useHomePageState() {
    const store = useLauncherStore();
    const statsStore = useStatsStore();
    const uiStore = useUIStore();
    const categoryStore = useCategoryStore();

    function toPathKey(path: string | null | undefined): string {
        if (!path) return "";
        const trimmed = path.trim();
        if (!trimmed) return "";
        return normalizePathKey(trimmed);
    }

    function toIdentityKey(path: string | null | undefined): string {
        const key = toPathKey(path);
        if (!key) return "";
        return normalizeExternalExecutableIdentity(key);
    }

    function collectAllLauncherPathKeys(): Set<string> {
        const keys = new Set<string>();
        for (const [, items] of Object.entries(store.launcherItemsByCategoryId)) {
            for (const item of items) {
                const rawPathKey = toPathKey(item.path);
                if (!rawPathKey) continue;
                keys.add(rawPathKey);
                const rawIdentityKey = toIdentityKey(item.path);
                if (rawIdentityKey) {
                    keys.add(rawIdentityKey);
                }

                const persistedResolved = toPathKey(item.resolvedPath);
                if (persistedResolved) {
                    keys.add(persistedResolved);
                    const persistedIdentity = toIdentityKey(item.resolvedPath);
                    if (persistedIdentity) {
                        keys.add(persistedIdentity);
                    }
                    continue;
                }
            }
        }
        return keys;
    }

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

    const mergedRecentDisplayItems = computed<HomeRecentDisplayItem[]>(() => {
        const recentLimit = uiStore.getHomeSectionLimit("recent");
        if (recentLimit <= 0) return [];

        const internalItems = recentDisplayItems.value;
        const launcherPathKeys = collectAllLauncherPathKeys();
        for (const item of internalItems) {
            const internalPathKey = toPathKey(item.item.path);
            if (internalPathKey) {
                launcherPathKeys.add(internalPathKey);
            }
            const internalIdentityKey = toIdentityKey(item.item.path);
            if (internalIdentityKey) {
                launcherPathKeys.add(internalIdentityKey);
            }
        }

        const externalItems: ExternalRecentDisplayItem[] = statsStore.externalRecentLaunches
            .map((entry) => ({
                key: `external:${toPathKey(entry.path) || entry.path.replace(/\//g, "\\").toLowerCase()}`,
                usedAt: entry.usedAt,
                external: entry,
                featureBadgeText: "外部",
            }))
            .filter((entry) => !statsStore.isExternalLaunchBlocked(entry.external.path))
            .filter((entry) => {
                const externalPathKey = toPathKey(entry.external.path);
                const externalIdentityKey = toIdentityKey(entry.external.path);
                if (externalPathKey && launcherPathKeys.has(externalPathKey)) return false;
                if (externalIdentityKey && launcherPathKeys.has(externalIdentityKey)) return false;
                return true;
            });

        return [...internalItems, ...externalItems]
            .sort((a, b) => {
                const usedAtDiff = b.usedAt - a.usedAt;
                if (usedAtDiff !== 0) return usedAtDiff;
                return a.key.localeCompare(b.key);
            })
            .slice(0, recentLimit);
    });

    return {
        recentMergedItems,
        pinnedMergedItems,
        timeBasedTailCandidates,
        recentDisplayItems,
        mergedRecentDisplayItems,
    };
}
