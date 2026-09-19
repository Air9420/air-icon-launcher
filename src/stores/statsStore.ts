import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { useLauncherStore, type RecentUsedItem } from "./launcherStore";
import { useCategoryStore } from "./categoryStore";
import { createVersionedPersistConfig } from "../utils/versioned-persist";
import { getKernelContext } from "../kernel/context-access";
import type { StatsService } from "../kernel/services/stats-service";
import {
  computeAppUsageStats,
  recordSearchKeyword,
  pruneLaunchEvents,
  normalizeLaunchEventRecord,
  normalizeLegacyUsageSnapshot,
  normalizeExternalRecentLaunchRecord,
  normalizeBlockedExternalLaunchRecord,
  normalizePathKey,
  normalizeExecutableIdentityKey,
  sanitizeBlockedExternalLaunchRecords,
  sanitizeExternalRecentLaunchRecords,
  dedupExternalRecentOnRecord,
  buildRecentConsecutiveScoreMap,
  getTimeSlot,
  getTimeBasedThreshold,
  getTimeBasedRecommendationScore,
  isWithinWeek,
  SMART_SORT_WEIGHTS,
  DAY_MS,
  normalizeExternalExecutableIdentity,
  type AppUsageStats,
  type SearchKeywordRecord,
  type LaunchEventRecord,
  type ExternalRecentLaunchRecord,
  type BlockedExternalLaunchRecord,
  type LegacyUsageSnapshotRecord,
  type LaunchEventCategoryRef,
  type ItemLookup,
} from "./stats-helpers";

export type {
  SearchKeywordRecord,
  LaunchEventRecord,
  ExternalRecentLaunchRecord,
  BlockedExternalLaunchRecord,
  LegacyUsageSnapshotRecord,
  AppUsageStats,
};

export { normalizeExternalExecutableIdentity };

function getStatsService(): StatsService | undefined {
  return getKernelContext()?.stats;
}

function launcherItemLookup(categoryId: string, itemId: string): ItemLookup {
  const launcher = useLauncherStore();
  const item = launcher.getLauncherItemById(categoryId, itemId);
  if (!item) return null;
  return { name: item.name, path: item.path };
}

export const useStatsStore = defineStore(
  "stats",
  () => {
    // Share StatsService refs when kernel is present; local fallback for tests.
    const statsService = getStatsService();

    const searchHistory =
      statsService?.searchHistory ?? ref<SearchKeywordRecord[]>([]);
    const launchEvents =
      statsService?.launchEvents ?? ref<LaunchEventRecord[]>([]);
    const externalRecentLaunches =
      statsService?.externalRecentLaunches ?? ref<ExternalRecentLaunchRecord[]>([]);
    const blockedExternalLaunches =
      statsService?.blockedExternalLaunches ?? ref<BlockedExternalLaunchRecord[]>([]);
    const launchTrackingStartedAt =
      statsService?.launchTrackingStartedAt ?? ref<number | null>(null);
    const legacyUsageSnapshot =
      statsService?.legacyUsageSnapshot ?? ref<LegacyUsageSnapshotRecord[]>([]);

    const blockedExternalPathKeys = computed(() => {
      const keys = new Set<string>();
      for (const record of blockedExternalLaunches.value) {
        const pathKey = normalizePathKey(record.path);
        if (pathKey) keys.add(pathKey);
      }
      return keys;
    });

    const blockedExternalIdentityKeys = computed(() => {
      const keys = new Set<string>();
      for (const record of blockedExternalLaunches.value) {
        const identityKey = normalizeExecutableIdentityKey(record.path);
        if (identityKey) keys.add(identityKey);
      }
      return keys;
    });

    function recordSearch(keyword: string) {
      if (statsService) {
        statsService.recordSearch(keyword);
        return;
      }
      searchHistory.value = recordSearchKeyword(searchHistory.value, keyword);
    }

    function clearSearchHistory() {
      searchHistory.value = [];
    }

    function removeSearchHistory(keyword: string) {
      const trimmed = keyword.trim().toLowerCase();
      if (!trimmed) return;
      searchHistory.value = searchHistory.value.filter((r) => r.keyword !== trimmed);
    }

    function ensureLaunchTrackingStarted(
      recentItems: RecentUsedItem[],
      startedAt: number = Date.now(),
    ): void {
      if (statsService) {
        statsService.ensureLaunchTrackingStarted(recentItems, startedAt);
        return;
      }
      if (launchTrackingStartedAt.value !== null) return;
      const normalizedSnapshot = normalizeLegacyUsageSnapshot(recentItems);
      const latestLegacyUsedAt = normalizedSnapshot.reduce(
        (max, record) => Math.max(max, record.usedAt),
        0,
      );
      const normalizedStartedAt =
        Number.isFinite(startedAt) && startedAt > 0 ? Math.floor(startedAt) : Date.now();
      legacyUsageSnapshot.value = normalizedSnapshot;
      launchTrackingStartedAt.value =
        latestLegacyUsedAt > 0
          ? Math.max(normalizedStartedAt, latestLegacyUsedAt + 1)
          : normalizedStartedAt;
    }

    function recordLaunchEvent(record: LaunchEventRecord): void {
      if (statsService) {
        statsService.recordLaunchEvent(record);
        return;
      }
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
      externalRecentLaunches.value = [];
      launchTrackingStartedAt.value = null;
      legacyUsageSnapshot.value = [];
    }

    function isExternalLaunchBlocked(path: string): boolean {
      if (statsService) return statsService.isExternalLaunchBlocked(path);
      const pathKey = normalizePathKey(path);
      if (!pathKey) return false;
      if (blockedExternalPathKeys.value.has(pathKey)) return true;
      const identityKey = normalizeExecutableIdentityKey(path);
      return !!identityKey && blockedExternalIdentityKeys.value.has(identityKey);
    }

    function recordExternalLaunch(record: {
      path: string;
      name: string;
      source?: string;
      iconBase64?: string | null;
      usedAt?: number;
    }): void {
      if (statsService) {
        statsService.recordExternalLaunch(record);
        return;
      }
      const normalized = normalizeExternalRecentLaunchRecord({
        path: record.path,
        name: record.name,
        source: record.source ?? "系统启动",
        iconBase64: record.iconBase64 ?? null,
        usedAt: record.usedAt ?? Date.now(),
        usageCount: 1,
      });
      if (!normalized) return;
      if (isExternalLaunchBlocked(normalized.path)) return;
      externalRecentLaunches.value = dedupExternalRecentOnRecord(
        [...externalRecentLaunches.value],
        normalized,
      );
    }

    function blockExternalLaunchPath(record: {
      path: string;
      name?: string;
      source?: string;
    }): void {
      if (statsService) {
        statsService.blockExternalLaunchPath(record);
        return;
      }
      const normalized = normalizeBlockedExternalLaunchRecord({
        path: record.path,
        name: record.name,
        source: record.source,
        blockedAt: Date.now(),
      });
      if (!normalized) return;
      const pathKey = normalizePathKey(normalized.path);
      const identityKey = normalizeExecutableIdentityKey(normalized.path);
      if (!pathKey || !identityKey) return;

      const nextBlocked = [...blockedExternalLaunches.value];
      const existingIndex = nextBlocked.findIndex((entry) => {
        const existingPathKey = normalizePathKey(entry.path);
        if (!existingPathKey) return false;
        if (existingPathKey === pathKey) return true;
        const existingIdentityKey = normalizeExecutableIdentityKey(entry.path);
        return !!existingIdentityKey && existingIdentityKey === identityKey;
      });
      if (existingIndex >= 0) {
        const existing = nextBlocked[existingIndex];
        nextBlocked[existingIndex] = {
          ...existing,
          path: normalized.path,
          name: normalized.name || existing.name,
          source: normalized.source || existing.source,
          blockedAt: Math.max(existing.blockedAt, normalized.blockedAt),
        };
      } else {
        nextBlocked.unshift(normalized);
      }
      blockedExternalLaunches.value = sanitizeBlockedExternalLaunchRecords(nextBlocked);
      sanitizeExternalRecentLaunchHistory();
    }

    function unblockExternalLaunchPath(path: string): void {
      if (statsService) {
        statsService.unblockExternalLaunchPath(path);
        return;
      }
      const pathKey = normalizePathKey(path);
      if (!pathKey) return;
      const identityKey = normalizeExecutableIdentityKey(path);
      blockedExternalLaunches.value = sanitizeBlockedExternalLaunchRecords(
        blockedExternalLaunches.value.filter((entry) => {
          const existingPathKey = normalizePathKey(entry.path);
          if (existingPathKey === pathKey) return false;
          if (identityKey) {
            const existingIdentityKey = normalizeExecutableIdentityKey(entry.path);
            if (existingIdentityKey === identityKey) return false;
          }
          return true;
        }),
      );
    }

    function sanitizeExternalRecentLaunchHistory(): void {
      if (statsService) {
        statsService.sanitizeExternalRecentLaunchHistory();
        return;
      }
      blockedExternalLaunches.value = sanitizeBlockedExternalLaunchRecords(
        blockedExternalLaunches.value,
      );
      externalRecentLaunches.value = sanitizeExternalRecentLaunchRecords(
        externalRecentLaunches.value,
        blockedExternalPathKeys.value,
        blockedExternalIdentityKeys.value,
      );
    }

    sanitizeExternalRecentLaunchHistory();

    function removeLaunchEventsForItems(categoryId: string, itemIds: string[]): void {
      if (statsService) {
        statsService.removeLaunchEventsForItems(categoryId, itemIds);
        return;
      }
      const targetIds = new Set(itemIds);
      if (targetIds.size === 0) return;
      launchEvents.value = launchEvents.value.filter(
        (r) => !(r.categoryId === categoryId && targetIds.has(r.itemId)),
      );
      legacyUsageSnapshot.value = legacyUsageSnapshot.value.filter(
        (r) => !(r.categoryId === categoryId && targetIds.has(r.itemId)),
      );
    }

    function removeLaunchEventsForCategory(categoryId: string): void {
      if (statsService) {
        statsService.removeLaunchEventsForCategory(categoryId);
        return;
      }
      launchEvents.value = launchEvents.value.filter((r) => r.categoryId !== categoryId);
      legacyUsageSnapshot.value = legacyUsageSnapshot.value.filter(
        (r) => r.categoryId !== categoryId,
      );
    }

    function remapLaunchEventCategoryRefs(refs: LaunchEventCategoryRef[]): void {
      if (statsService) {
        statsService.remapLaunchEventCategoryRefs(refs);
        return;
      }
      if (refs.length === 0) return;
      const nextCategoryIdByKey = new Map<string, string>();
      for (const ref of refs) {
        if (!ref.fromCategoryId || !ref.toCategoryId || !ref.itemId) continue;
        nextCategoryIdByKey.set(`${ref.fromCategoryId}:${ref.itemId}`, ref.toCategoryId);
      }
      if (nextCategoryIdByKey.size === 0) return;
      launchEvents.value = pruneLaunchEvents(
        launchEvents.value.map((record) => {
          const next = nextCategoryIdByKey.get(`${record.categoryId}:${record.itemId}`);
          if (!next || next === record.categoryId) return record;
          return { ...record, categoryId: next };
        }),
      );
      legacyUsageSnapshot.value = normalizeLegacyUsageSnapshot(
        legacyUsageSnapshot.value.map((record) => {
          const next = nextCategoryIdByKey.get(`${record.categoryId}:${record.itemId}`);
          if (!next || next === record.categoryId) return record;
          return { ...record, categoryId: next };
        }),
      );
    }

    const appUsageStats = computed<AppUsageStats[]>(() => {
      const launcher = useLauncherStore();
      return computeAppUsageStats({
        launchEvents: launchEvents.value,
        legacyUsageSnapshot: legacyUsageSnapshot.value,
        recentUsedItems: launcher.recentUsedItems,
        launchTrackingStartedAt: launchTrackingStartedAt.value,
        getItem: launcherItemLookup,
      });
    });

    const weeklyTopApps = computed(() =>
      [...appUsageStats.value]
        .filter((s) => s.weekLaunches > 0)
        .sort((a, b) => b.weekLaunches - a.weekLaunches)
        .slice(0, 10),
    );

    const allTimeTopApps = computed(() =>
      [...appUsageStats.value]
        .sort((a, b) => b.totalLaunches - a.totalLaunches)
        .slice(0, 10),
    );

    function getCurrentTimeSlot() {
      return getTimeSlot(new Date().getHours());
    }

    const timeBasedRecommendations = computed(() => {
      const currentSlot = getCurrentTimeSlot();
      const now = Date.now();
      return appUsageStats.value
        .map((stats) => {
          const currentSlotLaunches = stats.timeSlotCounts[currentSlot];
          const slotShare =
            stats.totalLaunches > 0 ? currentSlotLaunches / stats.totalLaunches : 0;
          return {
            stats,
            score: getTimeBasedRecommendationScore(stats, currentSlot, now),
            currentSlotLaunches,
            slotShare,
          };
        })
        .filter(({ stats, currentSlotLaunches, slotShare }) => {
          const threshold = getTimeBasedThreshold(stats.totalLaunches);
          return (
            currentSlotLaunches >= threshold.minSlotLaunches &&
            stats.totalLaunches >= threshold.minTotalLaunches &&
            slotShare >= threshold.minSlotShare
          );
        })
        .sort((a, b) => {
          const scoreDiff = b.score - a.score;
          if (scoreDiff !== 0) return scoreDiff;
          const slotDiff = b.currentSlotLaunches - a.currentSlotLaunches;
          if (slotDiff !== 0) return slotDiff;
          return b.stats.lastUsedAt - a.stats.lastUsedAt;
        })
        .map(({ stats }) => stats)
        .slice(0, 8);
    });

    const frequentlyUsedApps = computed(() => {
      const threeDaysAgo = Date.now() - 3 * DAY_MS;
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
      for (const stats of appUsageStats.value) total += stats.weekLaunches || 0;
      for (const stats of appUsageStats.value) {
        const cat = categoryStore.getCategoryById(stats.categoryId);
        const catName = cat?.name || "未知";
        const launches = stats.weekLaunches || 0;
        const existing = dist.get(stats.categoryId);
        if (existing) existing.launches += launches;
        else dist.set(stats.categoryId, { name: catName, launches, percentage: 0 });
      }
      for (const [, entry] of dist) {
        entry.percentage = total > 0 ? (entry.launches / total) * 100 : 0;
      }
      return Array.from(dist.values()).sort((a, b) => b.launches - a.launches);
    });

    const topSearchKeywords = computed(() =>
      searchHistory.value
        .slice(0, 15)
        .map((r) => ({ keyword: r.displayKeyword || r.keyword, count: r.count })),
    );

    const totalLaunchesThisWeek = computed(() =>
      appUsageStats.value.reduce((sum, s) => sum + s.weekLaunches, 0),
    );

    const totalLaunchesAllTime = computed(() =>
      appUsageStats.value.reduce((sum, s) => sum + s.totalLaunches, 0),
    );

    function getAppUsageForItem(itemId: string): AppUsageStats | undefined {
      return appUsageStats.value.find((s) => s.itemId === itemId);
    }

    function getSmartSortOrder(
      categoryId: string,
      itemIds: string[],
      pinnedItemIds: string[] = [],
    ): string[] {
      if (statsService) {
        return statsService.getSmartSortOrder(categoryId, itemIds, pinnedItemIds);
      }
      const currentSlot = getCurrentTimeSlot();
      const pinnedSet = new Set(pinnedItemIds);
      const categoryStatsMap = new Map(
        appUsageStats.value
          .filter((stats) => stats.categoryId === categoryId)
          .map((stats) => [stats.itemId, stats] as const),
      );
      const recentConsecutiveScoreMap = buildRecentConsecutiveScoreMap(
        launcherItemLookup,
        launchEvents.value,
        legacyUsageSnapshot.value,
        launchTrackingStartedAt.value,
      );

      let maxRecentFrequency = 0;
      let maxLongTermFrequency = 0;
      let maxCurrentSlotFrequency = 0;
      let maxRecentConsecutiveScore = 0;
      for (const itemId of itemIds) {
        const stats = categoryStatsMap.get(itemId);
        if (stats) {
          maxRecentFrequency = Math.max(maxRecentFrequency, stats.weekLaunches);
          maxLongTermFrequency = Math.max(maxLongTermFrequency, stats.totalLaunches);
          maxCurrentSlotFrequency = Math.max(
            maxCurrentSlotFrequency,
            stats.timeSlotCounts[currentSlot],
          );
        }
        maxRecentConsecutiveScore = Math.max(
          maxRecentConsecutiveScore,
          recentConsecutiveScoreMap.get(`${categoryId}:${itemId}`) ?? 0,
        );
      }

      const safeRecentMax = maxRecentFrequency || 1;
      const safeLongTermMax = maxLongTermFrequency || 1;
      const safeSlotMax = maxCurrentSlotFrequency || 1;
      const safeConsecutiveMax = maxRecentConsecutiveScore || 1;

      const scored = itemIds.map((id, originalIndex) => {
        const stats = categoryStatsMap.get(id);
        const recentFrequencyNorm = stats ? stats.weekLaunches / safeRecentMax : 0;
        const longTermFrequencyNorm = stats ? stats.totalLaunches / safeLongTermMax : 0;
        const currentSlotNorm = stats
          ? (stats.timeSlotCounts[currentSlot] || 0) / safeSlotMax
          : 0;
        const recentConsecutiveNorm =
          (recentConsecutiveScoreMap.get(`${categoryId}:${id}`) ?? 0) / safeConsecutiveMax;
        const pinnedNorm = pinnedSet.has(id) ? 1 : 0;
        const score =
          recentFrequencyNorm * SMART_SORT_WEIGHTS.recentFrequency +
          longTermFrequencyNorm * SMART_SORT_WEIGHTS.longTermFrequency +
          currentSlotNorm * SMART_SORT_WEIGHTS.currentTimeSlot +
          recentConsecutiveNorm * SMART_SORT_WEIGHTS.recentConsecutive +
          pinnedNorm * SMART_SORT_WEIGHTS.pinned;
        return { id, score, originalIndex };
      });

      return scored
        .sort((a, b) => {
          const scoreDiff = b.score - a.score;
          if (scoreDiff !== 0) return scoreDiff;
          return a.originalIndex - b.originalIndex;
        })
        .map((entry) => entry.id);
    }

    return {
      searchHistory,
      launchEvents,
      externalRecentLaunches,
      blockedExternalLaunches,
      launchTrackingStartedAt,
      legacyUsageSnapshot,
      recordSearch,
      removeSearchHistory,
      clearSearchHistory,
      ensureLaunchTrackingStarted,
      recordLaunchEvent,
      recordExternalLaunch,
      blockExternalLaunchPath,
      unblockExternalLaunchPath,
      isExternalLaunchBlocked,
      sanitizeExternalRecentLaunchHistory,
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
      "externalRecentLaunches",
      "blockedExternalLaunches",
      "launchTrackingStartedAt",
      "legacyUsageSnapshot",
    ]),
  },
);
