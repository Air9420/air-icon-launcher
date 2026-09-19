import { ref, type Ref } from "vue";
import { Service, type Context } from "cordis";
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
  getTimeSlot,
  buildRecentConsecutiveScoreMap,
  SMART_SORT_WEIGHTS,
  type AppUsageStats,
  type SearchKeywordRecord,
  type LaunchEventRecord,
  type ExternalRecentLaunchRecord,
  type BlockedExternalLaunchRecord,
  type LegacyUsageSnapshotRecord,
  type LaunchEventCategoryRef,
  type ItemLookup,
  type TimeSlot,
} from "../../stores/stats-helpers";

/**
 * Cordis service bound to `ctx.stats`.
 *
 * Holds launch/search history truth. Pinia statsStore shares these refs when
 * kernel is present; unit tests fall back to local store refs.
 *
 * Item lookups go through `ctx.apps` — never imports pinia stores.
 */
export class StatsService extends Service {
  readonly searchHistory: Ref<SearchKeywordRecord[]> = ref([]);
  readonly launchEvents: Ref<LaunchEventRecord[]> = ref([]);
  readonly externalRecentLaunches: Ref<ExternalRecentLaunchRecord[]> = ref([]);
  readonly blockedExternalLaunches: Ref<BlockedExternalLaunchRecord[]> = ref([]);
  readonly launchTrackingStartedAt: Ref<number | null> = ref(null);
  readonly legacyUsageSnapshot: Ref<LegacyUsageSnapshotRecord[]> = ref([]);

  constructor(ctx: Context) {
    super(ctx, "stats");
    this.sanitizeExternalRecentLaunchHistory();
  }

  private lookupItem(categoryId: string, itemId: string): ItemLookup {
    const item = this.ctx.apps?.getItemById(categoryId, itemId);
    if (!item) return null;
    return { name: item.name, path: item.path };
  }

  get blockedExternalPathKeys(): Set<string> {
    const keys = new Set<string>();
    for (const record of this.blockedExternalLaunches.value) {
      const pathKey = normalizePathKey(record.path);
      if (pathKey) keys.add(pathKey);
    }
    return keys;
  }

  get blockedExternalIdentityKeys(): Set<string> {
    const keys = new Set<string>();
    for (const record of this.blockedExternalLaunches.value) {
      const identityKey = normalizeExecutableIdentityKey(record.path);
      if (identityKey) keys.add(identityKey);
    }
    return keys;
  }

  get appUsageStats(): AppUsageStats[] {
    return computeAppUsageStats({
      launchEvents: this.launchEvents.value,
      legacyUsageSnapshot: this.legacyUsageSnapshot.value,
      recentUsedItems: (this.ctx.apps?.recentUsedItems.value ?? []) as Array<{
        categoryId: string;
        itemId: string;
        usedAt: number;
        usageCount?: number;
      }>,
      launchTrackingStartedAt: this.launchTrackingStartedAt.value,
      getItem: (cid, iid) => this.lookupItem(cid, iid),
    });
  }

  recordSearch(keyword: string): void {
    this.searchHistory.value = recordSearchKeyword(this.searchHistory.value, keyword);
  }

  clearSearchHistory(): void {
    this.searchHistory.value = [];
  }

  removeSearchHistory(keyword: string): void {
    const trimmed = keyword.trim().toLowerCase();
    if (!trimmed) return;
    this.searchHistory.value = this.searchHistory.value.filter(
      (record) => record.keyword !== trimmed,
    );
  }

  ensureLaunchTrackingStarted(
    recentItems: Array<{ categoryId: string; itemId: string; usedAt: number; usageCount?: number }>,
    startedAt: number = Date.now(),
  ): void {
    if (this.launchTrackingStartedAt.value !== null) return;
    const normalizedSnapshot = normalizeLegacyUsageSnapshot(recentItems);
    const latestLegacyUsedAt = normalizedSnapshot.reduce(
      (max, record) => Math.max(max, record.usedAt),
      0,
    );
    const normalizedStartedAt = Number.isFinite(startedAt) && startedAt > 0
      ? Math.floor(startedAt)
      : Date.now();
    this.legacyUsageSnapshot.value = normalizedSnapshot;
    this.launchTrackingStartedAt.value =
      latestLegacyUsedAt > 0
        ? Math.max(normalizedStartedAt, latestLegacyUsedAt + 1)
        : normalizedStartedAt;
  }

  recordLaunchEvent(record: LaunchEventRecord): void {
    const normalized = normalizeLaunchEventRecord(record);
    if (!normalized) return;
    if (this.launchTrackingStartedAt.value === null) {
      this.launchTrackingStartedAt.value = normalized.usedAt;
      this.legacyUsageSnapshot.value = [];
    }
    this.launchEvents.value = pruneLaunchEvents([...this.launchEvents.value, normalized]);
  }

  clearLaunchHistory(): void {
    this.launchEvents.value = [];
    this.externalRecentLaunches.value = [];
    this.launchTrackingStartedAt.value = null;
    this.legacyUsageSnapshot.value = [];
  }

  isExternalLaunchBlocked(path: string): boolean {
    const pathKey = normalizePathKey(path);
    if (!pathKey) return false;
    if (this.blockedExternalPathKeys.has(pathKey)) return true;
    const identityKey = normalizeExecutableIdentityKey(path);
    return !!identityKey && this.blockedExternalIdentityKeys.has(identityKey);
  }

  recordExternalLaunch(record: {
    path: string;
    name: string;
    source?: string;
    iconBase64?: string | null;
    usedAt?: number;
  }): void {
    const normalized = normalizeExternalRecentLaunchRecord({
      path: record.path,
      name: record.name,
      source: record.source ?? "系统启动",
      iconBase64: record.iconBase64 ?? null,
      usedAt: record.usedAt ?? Date.now(),
      usageCount: 1,
    });
    if (!normalized) return;
    if (this.isExternalLaunchBlocked(normalized.path)) return;
    this.externalRecentLaunches.value = dedupExternalRecentOnRecord(
      [...this.externalRecentLaunches.value],
      normalized,
    );
  }

  blockExternalLaunchPath(record: { path: string; name?: string; source?: string }): void {
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

    const nextBlocked = [...this.blockedExternalLaunches.value];
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
    this.blockedExternalLaunches.value = sanitizeBlockedExternalLaunchRecords(nextBlocked);
    this.sanitizeExternalRecentLaunchHistory();
  }

  unblockExternalLaunchPath(path: string): void {
    const pathKey = normalizePathKey(path);
    if (!pathKey) return;
    const identityKey = normalizeExecutableIdentityKey(path);
    this.blockedExternalLaunches.value = sanitizeBlockedExternalLaunchRecords(
      this.blockedExternalLaunches.value.filter((entry) => {
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

  sanitizeExternalRecentLaunchHistory(): void {
    this.blockedExternalLaunches.value = sanitizeBlockedExternalLaunchRecords(
      this.blockedExternalLaunches.value,
    );
    this.externalRecentLaunches.value = sanitizeExternalRecentLaunchRecords(
      this.externalRecentLaunches.value,
      this.blockedExternalPathKeys,
      this.blockedExternalIdentityKeys,
    );
  }

  removeLaunchEventsForItems(categoryId: string, itemIds: string[]): void {
    const targetIds = new Set(itemIds);
    if (targetIds.size === 0) return;
    this.launchEvents.value = this.launchEvents.value.filter(
      (record) => !(record.categoryId === categoryId && targetIds.has(record.itemId)),
    );
    this.legacyUsageSnapshot.value = this.legacyUsageSnapshot.value.filter(
      (record) => !(record.categoryId === categoryId && targetIds.has(record.itemId)),
    );
  }

  removeLaunchEventsForCategory(categoryId: string): void {
    this.launchEvents.value = this.launchEvents.value.filter(
      (record) => record.categoryId !== categoryId,
    );
    this.legacyUsageSnapshot.value = this.legacyUsageSnapshot.value.filter(
      (record) => record.categoryId !== categoryId,
    );
  }

  remapLaunchEventCategoryRefs(refs: LaunchEventCategoryRef[]): void {
    if (refs.length === 0) return;
    const nextCategoryIdByKey = new Map<string, string>();
    for (const ref of refs) {
      if (!ref.fromCategoryId || !ref.toCategoryId || !ref.itemId) continue;
      nextCategoryIdByKey.set(`${ref.fromCategoryId}:${ref.itemId}`, ref.toCategoryId);
    }
    if (nextCategoryIdByKey.size === 0) return;

    this.launchEvents.value = pruneLaunchEvents(
      this.launchEvents.value.map((record) => {
        const nextCategoryId = nextCategoryIdByKey.get(`${record.categoryId}:${record.itemId}`);
        if (!nextCategoryId || nextCategoryId === record.categoryId) return record;
        return { ...record, categoryId: nextCategoryId };
      }),
    );
    this.legacyUsageSnapshot.value = normalizeLegacyUsageSnapshot(
      this.legacyUsageSnapshot.value.map((record) => {
        const nextCategoryId = nextCategoryIdByKey.get(`${record.categoryId}:${record.itemId}`);
        if (!nextCategoryId || nextCategoryId === record.categoryId) return record;
        return { ...record, categoryId: nextCategoryId };
      }),
    );
  }

  getCurrentTimeSlot(): TimeSlot {
    return getTimeSlot(new Date().getHours());
  }

  getSmartSortOrder(
    categoryId: string,
    itemIds: string[],
    pinnedItemIds: string[] = [],
  ): string[] {
    const currentSlot = this.getCurrentTimeSlot();
    const pinnedSet = new Set(pinnedItemIds);
    const statsList = this.appUsageStats;
    const categoryStatsMap = new Map(
      statsList
        .filter((stats) => stats.categoryId === categoryId)
        .map((stats) => [stats.itemId, stats] as const),
    );
    const recentConsecutiveScoreMap = buildRecentConsecutiveScoreMap(
      (cid, iid) => this.lookupItem(cid, iid),
      this.launchEvents.value,
      this.legacyUsageSnapshot.value,
      this.launchTrackingStartedAt.value,
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
      const currentSlotNorm = stats ? (stats.timeSlotCounts[currentSlot] || 0) / safeSlotMax : 0;
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
}
