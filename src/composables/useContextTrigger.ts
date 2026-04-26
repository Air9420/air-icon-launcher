import { computed, ref } from "vue";
import { useStatsStore, type LaunchEventRecord } from "../stores/statsStore";

export type ContextTrigger = {
    triggerItemId: string;
    triggerCategoryId: string;
    recommendedItemId: string;
    recommendedCategoryId: string;
    frequency: number;
};

const CO_OCCURRENCE_WINDOW_MS = 5 * 60 * 1000;
const MIN_CO_OCCURRENCE_FREQUENCY = 2;
const MAX_TRIGGERS = 50;

export function useContextTrigger() {
    const statsStore = useStatsStore();
    const cachedTriggers = ref<ContextTrigger[]>([]);
    let lastCacheTime = 0;
    const CACHE_TTL_MS = 5 * 60 * 1000;

    const contextTriggers = computed<ContextTrigger[]>(() => {
        const now = Date.now();
        if (now - lastCacheTime > CACHE_TTL_MS) {
            cachedTriggers.value = discoverTriggers(statsStore.launchEvents);
            lastCacheTime = now;
        }
        return cachedTriggers.value;
    });

    function discoverTriggers(events: LaunchEventRecord[]): ContextTrigger[] {
        if (events.length < 2) return [];

        const coOccurrences = new Map<string, { count: number; trigger: { itemId: string; categoryId: string }; recommended: { itemId: string; categoryId: string } }>();

        const sortedEvents = [...events].sort((a, b) => a.usedAt - b.usedAt);

        for (let i = 0; i < sortedEvents.length; i++) {
            const current = sortedEvents[i];
            const windowEnd = current.usedAt + CO_OCCURRENCE_WINDOW_MS;

            for (let j = i + 1; j < sortedEvents.length && sortedEvents[j].usedAt <= windowEnd; j++) {
                const next = sortedEvents[j];

                if (current.itemId === next.itemId) continue;

                const key = `${current.itemId}:${next.itemId}`;
                const existing = coOccurrences.get(key);
                if (existing) {
                    existing.count++;
                } else {
                    coOccurrences.set(key, {
                        count: 1,
                        trigger: { itemId: current.itemId, categoryId: current.categoryId },
                        recommended: { itemId: next.itemId, categoryId: next.categoryId },
                    });
                }
            }
        }

        const triggers: ContextTrigger[] = [];
        for (const [, value] of coOccurrences) {
            if (value.count >= MIN_CO_OCCURRENCE_FREQUENCY) {
                triggers.push({
                    triggerItemId: value.trigger.itemId,
                    triggerCategoryId: value.trigger.categoryId,
                    recommendedItemId: value.recommended.itemId,
                    recommendedCategoryId: value.recommended.categoryId,
                    frequency: value.count,
                });
            }
        }

        triggers.sort((a, b) => b.frequency - a.frequency);
        return triggers.slice(0, MAX_TRIGGERS);
    }

    function getRecommendationsForItem(itemId: string): ContextTrigger[] {
        return contextTriggers.value.filter(t => t.triggerItemId === itemId);
    }

    function getRecommendationsForRecentLaunch(launchEvents: LaunchEventRecord[], limit = 3): ContextTrigger[] {
        if (launchEvents.length === 0) return [];

        const recentEvents = [...launchEvents]
            .sort((a, b) => b.usedAt - a.usedAt)
            .slice(0, 5);

        const recentItemIds = new Set(recentEvents.map(e => e.itemId));

        const recommendations = contextTriggers.value
            .filter(t => recentItemIds.has(t.triggerItemId))
            .sort((a, b) => b.frequency - a.frequency)
            .slice(0, limit);

        return recommendations;
    }

    function invalidateCache(): void {
        lastCacheTime = 0;
    }

    return {
        contextTriggers,
        discoverTriggers,
        getRecommendationsForItem,
        getRecommendationsForRecentLaunch,
        invalidateCache,
    };
}
