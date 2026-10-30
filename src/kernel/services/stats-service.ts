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
  isPathWithinDirectory,
  getTimeSlot,
  buildRecentConsecutiveScoreMap,
  SMART_SORT_WEIGHTS,
  getLifetimeCountKey,
  incrementLifetimeLaunchCount,
  incrementLifetimeTimeSlotCount,
  splitLifetimeCountKey,
  type AppUsageStats,
  type SearchKeywordRecord,
  type LaunchEventRecord,
  type ExternalRecentLaunchRecord,
  type BlockedExternalLaunchRecord,
  type LegacyUsageSnapshotRecord,
  type LaunchEventCategoryRef,
  type LifetimeLaunchCounts,
  type LifetimeTimeSlotCounts,
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
  /** 终身启动计数，独立于 launchEvents 持久化，事件裁剪不会使其回退。 */
  readonly lifetimeLaunchCounts: Ref<LifetimeLaunchCounts> = ref({});
  /** 终身时段分布，同样独立持久化，保证时段推荐不随事件裁剪失真。 */
  readonly lifetimeTimeSlotCounts: Ref<LifetimeTimeSlotCounts> = ref({});

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
      if (record.isDirectory) continue;
      const pathKey = normalizePathKey(record.path);
      if (pathKey) keys.add(pathKey);
    }
    return keys;
  }

  get blockedExternalIdentityKeys(): Set<string> {
    const keys = new Set<string>();
    for (const record of this.blockedExternalLaunches.value) {
      if (record.isDirectory) continue;
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
      lifetimeLaunchCounts: this.lifetimeLaunchCounts.value,
      lifetimeTimeSlotCounts: this.lifetimeTimeSlotCounts.value,
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
    // 迁移旧版聚合次数为终身计数起点，否则历史次数会随事件流裁剪消失。
    const seededCounts = { ...this.lifetimeLaunchCounts.value };
    for (const record of normalizedSnapshot) {
      const key = getLifetimeCountKey(record.categoryId, record.itemId);
      seededCounts[key] = Math.max(seededCounts[key] ?? 0, record.usageCount);
    }
    this.lifetimeLaunchCounts.value = seededCounts;
  }

  recordLaunchEvent(record: LaunchEventRecord): void {
    const normalized = normalizeLaunchEventRecord(record);
    if (!normalized) return;
    if (this.launchTrackingStartedAt.value === null) {
      this.launchTrackingStartedAt.value = normalized.usedAt;
      this.legacyUsageSnapshot.value = [];
    }
    // 终身计数先于事件裁剪累加，保证不随 5000 条 / 180 天窗口缩水。
    this.lifetimeLaunchCounts.value = incrementLifetimeLaunchCount(
      this.lifetimeLaunchCounts.value,
      normalized.categoryId,
      normalized.itemId,
    );
    this.lifetimeTimeSlotCounts.value = incrementLifetimeTimeSlotCount(
      this.lifetimeTimeSlotCounts.value,
      normalized.categoryId,
      normalized.itemId,
      getTimeSlot(new Date(normalized.usedAt).getHours()),
    );
    this.launchEvents.value = pruneLaunchEvents([...this.launchEvents.value, normalized]);
  }

  clearLaunchHistory(): void {
    this.launchEvents.value = [];
    this.externalRecentLaunches.value = [];
    this.launchTrackingStartedAt.value = null;
    this.legacyUsageSnapshot.value = [];
    this.lifetimeLaunchCounts.value = {};
    this.lifetimeTimeSlotCounts.value = {};
  }

  isExternalLaunchBlocked(path: string): boolean {
    const pathKey = normalizePathKey(path);
    if (!pathKey) return false;
    if (this.blockedExternalPathKeys.has(pathKey)) return true;
    const identityKey = normalizeExecutableIdentityKey(path);
    if (identityKey && this.blockedExternalIdentityKeys.has(identityKey)) return true;
    return this.blockedExternalLaunches.value.some(
      (record) => record.isDirectory && isPathWithinDirectory(path, record.path),
    );
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
      if (entry.isDirectory) return false;
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

  blockExternalLaunchDirectory(path: string): void {
    const normalized = normalizeBlockedExternalLaunchRecord({
      path,
      name: path.split(/[\\/]/).filter(Boolean).pop() || path,
      source: "目录",
      blockedAt: Date.now(),
      isDirectory: true,
    });
    if (!normalized) return;
    normalized.isDirectory = true;
    const pathKey = normalizePathKey(normalized.path);
    if (!pathKey) return;
    this.blockedExternalLaunches.value = sanitizeBlockedExternalLaunchRecords([
      normalized,
      ...this.blockedExternalLaunches.value,
    ]);
    this.sanitizeExternalRecentLaunchHistory();
  }

  unblockExternalLaunchPath(path: string, isDirectory = false): void {
    const pathKey = normalizePathKey(path);
    if (!pathKey) return;
    const identityKey = normalizeExecutableIdentityKey(path);
    this.blockedExternalLaunches.value = sanitizeBlockedExternalLaunchRecords(
      this.blockedExternalLaunches.value.filter((entry) => {
        if (entry.isDirectory !== isDirectory) return true;
        const existingPathKey = normalizePathKey(entry.path);
        if (
          isDirectory &&
          isPathWithinDirectory(existingPathKey, pathKey) &&
          isPathWithinDirectory(pathKey, existingPathKey)
        ) {
          return false;
        }
        if (existingPathKey === pathKey) return false;
        if (isDirectory) return true;
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
    ).filter((entry) => !this.isExternalLaunchBlocked(entry.path));
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
    const nextCounts = { ...this.lifetimeLaunchCounts.value };
    const nextSlots = { ...this.lifetimeTimeSlotCounts.value };
    for (const itemId of targetIds) {
      const key = getLifetimeCountKey(categoryId, itemId);
      delete nextCounts[key];
      delete nextSlots[key];
    }
    this.lifetimeLaunchCounts.value = nextCounts;
    this.lifetimeTimeSlotCounts.value = nextSlots;
  }

  removeLaunchEventsForCategory(categoryId: string): void {
    this.launchEvents.value = this.launchEvents.value.filter(
      (record) => record.categoryId !== categoryId,
    );
    this.legacyUsageSnapshot.value = this.legacyUsageSnapshot.value.filter(
      (record) => record.categoryId !== categoryId,
    );
    const prefix = `${categoryId}:`;
    const nextCounts: LifetimeLaunchCounts = {};
    for (const [key, count] of Object.entries(this.lifetimeLaunchCounts.value)) {
      if (key.startsWith(prefix)) continue;
      nextCounts[key] = count;
    }
    this.lifetimeLaunchCounts.value = nextCounts;

    const nextSlots: LifetimeTimeSlotCounts = {};
    for (const [key, slots] of Object.entries(this.lifetimeTimeSlotCounts.value)) {
      if (key.startsWith(prefix)) continue;
      nextSlots[key] = slots;
    }
    this.lifetimeTimeSlotCounts.value = nextSlots;
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

    // 计数表随条目一起搬迁，避免换分类后累计次数归零。
    const remappedCounts: LifetimeLaunchCounts = {};
    for (const [key, count] of Object.entries(this.lifetimeLaunchCounts.value)) {
      const nextKey = nextCategoryIdByKey.get(key);
      if (!nextKey) {
        remappedCounts[key] = count;
        continue;
      }
      const itemId = key.slice(key.indexOf(":") + 1);
      remappedCounts[getLifetimeCountKey(nextKey, itemId)] =
        (remappedCounts[getLifetimeCountKey(nextKey, itemId)] ?? 0) + count;
    }
    this.lifetimeLaunchCounts.value = remappedCounts;

    const remappedSlots: LifetimeTimeSlotCounts = {};
    for (const [key, slots] of Object.entries(this.lifetimeTimeSlotCounts.value)) {
      const nextKey = nextCategoryIdByKey.get(key);
      if (!nextKey) {
        remappedSlots[key] = slots;
        continue;
      }
      const parsed = splitLifetimeCountKey(key);
      if (!parsed) continue;
      const targetKey = getLifetimeCountKey(nextKey, parsed.itemId);
      const existing = remappedSlots[targetKey];
      if (!existing) {
        remappedSlots[targetKey] = { ...slots };
        continue;
      }
      remappedSlots[targetKey] = {
        morning: existing.morning + slots.morning,
        afternoon: existing.afternoon + slots.afternoon,
        evening: existing.evening + slots.evening,
        night: existing.night + slots.night,
      };
    }
    this.lifetimeTimeSlotCounts.value = remappedSlots;
  }

  getCurrentTimeSlot(): TimeSlot {
    return getTimeSlot(new Date().getHours());
  }

  /**
   * @param pinnedItemIds 保留参数以兼容既有调用方；置顶分组由 `getSmartSortedItems`
   *   在调用前完成，组内相对排序不再依赖该集合。
   */
  getSmartSortOrder(
    categoryId: string,
    itemIds: string[],
    pinnedItemIds: string[] = [],
  ): string[] {
    void pinnedItemIds;
    const currentSlot = this.getCurrentTimeSlot();
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
        maxLongTermFrequency = Math.max(maxLongTermFrequency, stats.lifetimeLaunches);
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
      const longTermFrequencyNorm = stats ? stats.lifetimeLaunches / safeLongTermMax : 0;
      const currentSlotNorm = stats ? (stats.timeSlotCounts[currentSlot] || 0) / safeSlotMax : 0;
      const recentConsecutiveNorm =
        (recentConsecutiveScoreMap.get(`${categoryId}:${id}`) ?? 0) / safeConsecutiveMax;
      // 置顶条目在调用方（getSmartSortedItems）已整组前置，组内 pinnedNorm 恒等，
      // 此处不再计入，避免同一事实被重复加权。
      const score =
        recentFrequencyNorm * SMART_SORT_WEIGHTS.recentFrequency +
        longTermFrequencyNorm * SMART_SORT_WEIGHTS.longTermFrequency +
        currentSlotNorm * SMART_SORT_WEIGHTS.currentTimeSlot +
        recentConsecutiveNorm * SMART_SORT_WEIGHTS.recentConsecutive;
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
