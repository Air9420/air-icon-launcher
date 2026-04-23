import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { useLauncherStore } from "./launcherStore";
import { useCategoryStore } from "./categoryStore";
import { createVersionedPersistConfig } from "../utils/versioned-persist";

type TimeSlot = "morning" | "afternoon" | "evening" | "night";

export type SearchKeywordRecord = {
  keyword: string;
  displayKeyword?: string;
  count: number;
  lastUsedAt: number;
};

type AppUsageStats = {
  itemId: string;
  name: string;
  path: string;
  categoryId: string;
  totalLaunches: number;
  weekLaunches: number;
  lastUsedAt: number;
  timeSlotCounts: Record<TimeSlot, number>;
};

function getTimeSlot(hour: number): TimeSlot {
  if (isNaN(hour)) return "morning";
  if (hour >= 6 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 23) return "evening";
  return "night";
}

function getHour(timestamp: number): number {
  if (!timestamp || isNaN(timestamp)) return new Date().getHours();
  return new Date(timestamp).getHours();
}

function isWithinWeek(timestamp: number): boolean {
  if (!timestamp || isNaN(timestamp)) return false;
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  return timestamp >= weekAgo;
}

export const useStatsStore = defineStore(
  "stats",
  () => {
    const searchHistory = ref<SearchKeywordRecord[]>([]);

    function recordSearch(keyword: string) {
      const displayKeyword = keyword.trim();
      const trimmed = displayKeyword.toLowerCase();
      if (!trimmed || displayKeyword.length > 50) return;

      let newHistory = [...searchHistory.value];
      const existingIndex = newHistory.findIndex((r) => r.keyword === trimmed);
      if (existingIndex !== -1) {
        const existing = { ...newHistory[existingIndex] };
        existing.count++;
        existing.displayKeyword = displayKeyword;
        existing.lastUsedAt = Date.now();
        newHistory[existingIndex] = existing;
      } else {
        newHistory.unshift({
          keyword: trimmed,
          displayKeyword,
          count: 1,
          lastUsedAt: Date.now(),
        });
      }

      newHistory.sort((a, b) => b.count - a.count);
      if (newHistory.length > 200) {
        newHistory = newHistory.slice(0, 200);
      }
      searchHistory.value = newHistory;
    }

    function clearSearchHistory() {
      searchHistory.value = [];
    }

    const appUsageStats = computed<AppUsageStats[]>(() => {
      const launcher = useLauncherStore();

      const usageMap = new Map<
        string,
        {
          name: string;
          path: string;
          categoryId: string;
          totalLaunches: number;
          weekLaunches: number;
          lastUsedAt: number;
          timeSlotCounts: Record<TimeSlot, number>;
        }
      >();

      for (const recent of launcher.recentUsedItems) {
        const item = launcher.getLauncherItemById(recent.categoryId, recent.itemId);
        if (!item) continue;

        const key = `${recent.categoryId}-${recent.itemId}`;
        const hour = getHour(recent.usedAt);
        const slot = getTimeSlot(hour);

        let entry = usageMap.get(key);
        if (!entry) {
          entry = {
            name: item.name,
            path: item.path,
            categoryId: recent.categoryId,
            totalLaunches: 0,
            weekLaunches: 0,
            lastUsedAt: 0,
            timeSlotCounts: { morning: 0, afternoon: 0, evening: 0, night: 0 },
          };
          usageMap.set(key, entry);
        }

        entry.totalLaunches += recent.usageCount || 0;
        if (isWithinWeek(recent.usedAt)) {
          entry.weekLaunches += recent.usageCount || 0;
        }
        if (recent.usedAt > entry.lastUsedAt) {
          entry.lastUsedAt = recent.usedAt;
        }
        entry.timeSlotCounts[slot] += recent.usageCount || 0;
      }

      return Array.from(usageMap.entries()).map(([key, stats]) => ({
        itemId: key.split("-").slice(1).join("-"),
        ...stats,
      }));
    });

    const weeklyTopApps = computed(() => {
      return [...appUsageStats.value]
        .filter((s) => s.weekLaunches > 0)
        .sort((a, b) => b.weekLaunches - a.weekLaunches)
        .slice(0, 10);
    });

    const allTimeTopApps = computed(() => {
      return [...appUsageStats.value]
        .sort((a, b) => b.totalLaunches - a.totalLaunches)
        .slice(0, 10);
    });

    function getCurrentTimeSlot(): TimeSlot {
      return getTimeSlot(new Date().getHours());
    }

    const timeBasedRecommendations = computed(() => {
      const currentSlot = getCurrentTimeSlot();

      return [...appUsageStats.value]
        .filter((s) => s.timeSlotCounts[currentSlot] > 0)
        .sort((a, b) => b.timeSlotCounts[currentSlot] - a.timeSlotCounts[currentSlot])
        .slice(0, 8);
    });

    const frequentlyUsedApps = computed(() => {
      const now = Date.now();
      const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1000;

      return [...appUsageStats.value]
        .filter((s) => s.lastUsedAt >= threeDaysAgo && s.totalLaunches >= 3)
        .sort((a, b) => {
          const scoreA = a.totalLaunches + (isWithinWeek(a.lastUsedAt) ? a.weekLaunches * 2 : 0);
          const scoreB = b.totalLaunches + (isWithinWeek(b.lastUsedAt) ? b.weekLaunches * 2 : 0);
          return scoreB - scoreA;
        })
        .slice(0, 12);
    });

    const categoryUsageDistribution = computed(() => {
      const categoryStore = useCategoryStore();
      const dist = new Map<string, { name: string; launches: number; percentage: number }>();

      let total = 0;
      for (const stats of appUsageStats.value) {
        total += stats.weekLaunches || 0;
      }

      for (const stats of appUsageStats.value) {
        const cat = categoryStore.getCategoryById(stats.categoryId);
        const catName = cat?.name || "未知";
        const existing = dist.get(stats.categoryId);
        const launches = stats.weekLaunches || 0;

        if (existing) {
          existing.launches += launches;
        } else {
          dist.set(stats.categoryId, { name: catName, launches, percentage: 0 });
        }
      }

      for (const [, entry] of dist) {
        entry.percentage = total > 0 ? (entry.launches / total) * 100 : 0;
      }

      return Array.from(dist.values())
        .sort((a, b) => b.launches - a.launches);
    });

    const topSearchKeywords = computed(() => {
      return searchHistory.value
        .slice(0, 15)
        .map((r) => ({ keyword: r.displayKeyword || r.keyword, count: r.count }));
    });

    const totalLaunchesThisWeek = computed(() => {
      return appUsageStats.value.reduce((sum, s) => sum + s.weekLaunches, 0);
    });

    const totalLaunchesAllTime = computed(() => {
      return appUsageStats.value.reduce((sum, s) => sum + s.totalLaunches, 0);
    });

    function getAppUsageForItem(itemId: string): AppUsageStats | undefined {
      return appUsageStats.value.find((s) => s.itemId === itemId);
    }

    function getSmartSortOrder(categoryId: string, itemIds: string[]): string[] {
      const currentSlot = getCurrentTimeSlot();
      const now = Date.now();
      const dayAgo = now - 24 * 60 * 60 * 1000;
      const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

      const scored = itemIds.map((id) => {
        const stats = appUsageStats.value.find(
          (s) => s.itemId === id && s.categoryId === categoryId
        );
        if (!stats) return { id, score: 0 };

        let score = 0;
        score += Math.min(stats.weekLaunches * 10, 500);
        score += Math.min(stats.timeSlotCounts[currentSlot] * 20, 200);
        if (stats.lastUsedAt >= dayAgo) score += 100;
        if (stats.lastUsedAt >= weekAgo) score += 50;

        return { id, score };
      });

      return scored.sort((a, b) => b.score - a.score).map((s) => s.id);
    }

    return {
      searchHistory,
      recordSearch,
      clearSearchHistory,
      appUsageStats,
      weeklyTopApps,
      allTimeTopApps,
      timeBasedRecommendations,
      frequentlyUsedApps,
      categoryUsageDistribution,
      topSearchKeywords,
      totalLaunchesThisWeek,
      totalLaunchesAllTime,
      getAppUsageForItem,
      getSmartSortOrder,
      getCurrentTimeSlot,
    };
  },
  {
    persist: createVersionedPersistConfig("stats", ["searchHistory"]),
  }
);
