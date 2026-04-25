import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { useLauncherStore, type RecentUsedItem } from "./launcherStore";
import { useCategoryStore } from "./categoryStore";
import { createVersionedPersistConfig } from "../utils/versioned-persist";

type TimeSlot = "morning" | "afternoon" | "evening" | "night";

const MAX_LAUNCH_EVENTS = 5000;
const MAX_LAUNCH_EVENT_AGE_MS = 180 * 24 * 60 * 60 * 1000;

export type SearchKeywordRecord = {
  keyword: string;
  displayKeyword?: string;
  count: number;
  lastUsedAt: number;
};

export type LaunchEventRecord = {
  categoryId: string;
  itemId: string;
  usedAt: number;
};

export type LegacyUsageSnapshotRecord = {
  categoryId: string;
  itemId: string;
  usedAt: number;
  usageCount: number;
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

type UsageAccumulator = AppUsageStats;

type LaunchEventCategoryRef = {
  fromCategoryId: string;
  toCategoryId: string;
  itemId: string;
};

function createEmptyTimeSlotCounts(): Record<TimeSlot, number> {
  return { morning: 0, afternoon: 0, evening: 0, night: 0 };
}

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

function normalizeTimestamp(value: number, fallback: number = Date.now()): number {
  if (!Number.isFinite(value) || value <= 0) {
    return Math.floor(fallback);
  }
  return Math.floor(value);
}

function normalizeUsageCount(value: number | undefined): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value ?? 1));
}

function normalizeLaunchEventRecord(record: Partial<LaunchEventRecord> | null | undefined): LaunchEventRecord | null {
  const categoryId = typeof record?.categoryId === "string" ? record.categoryId.trim() : "";
  const itemId = typeof record?.itemId === "string" ? record.itemId.trim() : "";
  if (!categoryId || !itemId) return null;

  return {
    categoryId,
    itemId,
    usedAt: normalizeTimestamp(record?.usedAt ?? Date.now()),
  };
}

function normalizeLegacyUsageRecord(
  record: Partial<LegacyUsageSnapshotRecord> | RecentUsedItem | null | undefined
): LegacyUsageSnapshotRecord | null {
  const normalizedEvent = normalizeLaunchEventRecord(record);
  if (!normalizedEvent) return null;

  return {
    ...normalizedEvent,
    usageCount: normalizeUsageCount((record as LegacyUsageSnapshotRecord | undefined)?.usageCount),
  };
}

function normalizeLegacyUsageSnapshot(
  records: Array<Partial<LegacyUsageSnapshotRecord> | RecentUsedItem>
): LegacyUsageSnapshotRecord[] {
  const snapshotMap = new Map<string, LegacyUsageSnapshotRecord>();

  for (const record of records) {
    const normalized = normalizeLegacyUsageRecord(record);
    if (!normalized) continue;

    const key = `${normalized.categoryId}:${normalized.itemId}`;
    const existing = snapshotMap.get(key);
    if (!existing) {
      snapshotMap.set(key, normalized);
      continue;
    }

    snapshotMap.set(key, {
      ...existing,
      usedAt: Math.max(existing.usedAt, normalized.usedAt),
      usageCount: existing.usageCount + normalized.usageCount,
    });
  }

  return [...snapshotMap.values()].sort((a, b) => b.usedAt - a.usedAt);
}

function pruneLaunchEvents(records: LaunchEventRecord[]): LaunchEventRecord[] {
  const cutoff = Date.now() - MAX_LAUNCH_EVENT_AGE_MS;
  const normalized = records
    .map((record) => normalizeLaunchEventRecord(record))
    .filter((record): record is LaunchEventRecord => !!record && record.usedAt >= cutoff)
    .sort((a, b) => a.usedAt - b.usedAt);

  if (normalized.length <= MAX_LAUNCH_EVENTS) {
    return normalized;
  }

  return normalized.slice(-MAX_LAUNCH_EVENTS);
}

function getUsageAccumulator(
  usageMap: Map<string, UsageAccumulator>,
  launcher: ReturnType<typeof useLauncherStore>,
  categoryId: string,
  itemId: string
): UsageAccumulator | null {
  const key = `${categoryId}-${itemId}`;
  let entry = usageMap.get(key);

  if (!entry) {
    const item = launcher.getLauncherItemById(categoryId, itemId);
    if (!item) return null;

    entry = {
      itemId,
      name: item.name,
      path: item.path,
      categoryId,
      totalLaunches: 0,
      weekLaunches: 0,
      lastUsedAt: 0,
      timeSlotCounts: createEmptyTimeSlotCounts(),
    };
    usageMap.set(key, entry);
  }

  return entry;
}

function applyUsageCount(
  usageMap: Map<string, UsageAccumulator>,
  launcher: ReturnType<typeof useLauncherStore>,
  record: { categoryId: string; itemId: string; usedAt: number },
  count: number
): void {
  if (count <= 0) return;

  const entry = getUsageAccumulator(usageMap, launcher, record.categoryId, record.itemId);
  if (!entry) return;
  const slot = getTimeSlot(getHour(record.usedAt));

  entry.totalLaunches += count;
  if (isWithinWeek(record.usedAt)) {
    entry.weekLaunches += count;
  }
  if (record.usedAt > entry.lastUsedAt) {
    entry.lastUsedAt = record.usedAt;
  }
  entry.timeSlotCounts[slot] += count;
}

export const useStatsStore = defineStore(
  "stats",
  () => {
    const searchHistory = ref<SearchKeywordRecord[]>([]);
    const launchEvents = ref<LaunchEventRecord[]>([]);
    const launchTrackingStartedAt = ref<number | null>(null);
    const legacyUsageSnapshot = ref<LegacyUsageSnapshotRecord[]>([]);

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

    function removeSearchHistory(keyword: string) {
      const trimmed = keyword.trim().toLowerCase();
      if (!trimmed) return;

      searchHistory.value = searchHistory.value.filter((record) => record.keyword !== trimmed);
    }

    function ensureLaunchTrackingStarted(
      recentItems: RecentUsedItem[],
      startedAt: number = Date.now()
    ): void {
      if (launchTrackingStartedAt.value !== null) return;

      const normalizedSnapshot = normalizeLegacyUsageSnapshot(recentItems);
      const latestLegacyUsedAt = normalizedSnapshot.reduce(
        (max, record) => Math.max(max, record.usedAt),
        0
      );
      const normalizedStartedAt = normalizeTimestamp(startedAt);

      legacyUsageSnapshot.value = normalizedSnapshot;
      launchTrackingStartedAt.value =
        latestLegacyUsedAt > 0
          ? Math.max(normalizedStartedAt, latestLegacyUsedAt + 1)
          : normalizedStartedAt;
    }

    function recordLaunchEvent(record: LaunchEventRecord): void {
      const normalized = normalizeLaunchEventRecord(record);
      if (!normalized) return;

      if (launchTrackingStartedAt.value === null) {
        launchTrackingStartedAt.value = normalized.usedAt;
        legacyUsageSnapshot.value = [];
      }

      launchEvents.value = pruneLaunchEvents([...launchEvents.value, normalized]);
    }

    function clearLaunchHistory(): void {
      launchEvents.value = [];
      launchTrackingStartedAt.value = null;
      legacyUsageSnapshot.value = [];
    }

    function removeLaunchEventsForItems(categoryId: string, itemIds: string[]): void {
      const targetIds = new Set(itemIds);
      if (targetIds.size === 0) return;

      launchEvents.value = launchEvents.value.filter(
        (record) => !(record.categoryId === categoryId && targetIds.has(record.itemId))
      );
      legacyUsageSnapshot.value = legacyUsageSnapshot.value.filter(
        (record) => !(record.categoryId === categoryId && targetIds.has(record.itemId))
      );
    }

    function removeLaunchEventsForCategory(categoryId: string): void {
      launchEvents.value = launchEvents.value.filter((record) => record.categoryId !== categoryId);
      legacyUsageSnapshot.value = legacyUsageSnapshot.value.filter(
        (record) => record.categoryId !== categoryId
      );
    }

    function remapLaunchEventCategoryRefs(refs: LaunchEventCategoryRef[]): void {
      if (refs.length === 0) return;

      const nextCategoryIdByKey = new Map<string, string>();
      for (const ref of refs) {
        if (!ref.fromCategoryId || !ref.toCategoryId || !ref.itemId) continue;
        nextCategoryIdByKey.set(`${ref.fromCategoryId}:${ref.itemId}`, ref.toCategoryId);
      }
      if (nextCategoryIdByKey.size === 0) return;

      launchEvents.value = pruneLaunchEvents(
        launchEvents.value.map((record) => {
          const nextCategoryId = nextCategoryIdByKey.get(`${record.categoryId}:${record.itemId}`);
          if (!nextCategoryId || nextCategoryId === record.categoryId) {
            return record;
          }

          return {
            ...record,
            categoryId: nextCategoryId,
          };
        })
      );

      legacyUsageSnapshot.value = normalizeLegacyUsageSnapshot(
        legacyUsageSnapshot.value.map((record) => {
          const nextCategoryId = nextCategoryIdByKey.get(`${record.categoryId}:${record.itemId}`);
          if (!nextCategoryId || nextCategoryId === record.categoryId) {
            return record;
          }

          return {
            ...record,
            categoryId: nextCategoryId,
          };
        })
      );
    }

    const appUsageStats = computed<AppUsageStats[]>(() => {
      const launcher = useLauncherStore();
      const usageMap = new Map<string, UsageAccumulator>();

      if (launchTrackingStartedAt.value === null) {
        for (const recent of launcher.recentUsedItems) {
          const normalized = normalizeLegacyUsageRecord(recent);
          if (!normalized) continue;
          applyUsageCount(usageMap, launcher, normalized, normalized.usageCount);
        }
      } else {
        for (const record of legacyUsageSnapshot.value) {
          applyUsageCount(usageMap, launcher, record, record.usageCount);
        }

        for (const record of launchEvents.value) {
          applyUsageCount(usageMap, launcher, record, 1);
        }
      }

      return Array.from(usageMap.values());
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

      return Array.from(dist.values()).sort((a, b) => b.launches - a.launches);
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
      launchEvents,
      launchTrackingStartedAt,
      legacyUsageSnapshot,
      recordSearch,
      removeSearchHistory,
      clearSearchHistory,
      ensureLaunchTrackingStarted,
      recordLaunchEvent,
      clearLaunchHistory,
      removeLaunchEventsForItems,
      removeLaunchEventsForCategory,
      remapLaunchEventCategoryRefs,
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
    persist: createVersionedPersistConfig("stats", [
      "searchHistory",
      "launchEvents",
      "launchTrackingStartedAt",
      "legacyUsageSnapshot",
    ]),
  }
);
