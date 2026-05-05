import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { useLauncherStore, type RecentUsedItem } from "./launcherStore";
import { useCategoryStore } from "./categoryStore";
import { createVersionedPersistConfig } from "../utils/versioned-persist";

type TimeSlot = "morning" | "afternoon" | "evening" | "night";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const MAX_LAUNCH_EVENTS = 5000;
const MAX_LAUNCH_EVENT_AGE_MS = 180 * DAY_MS;
const MAX_EXTERNAL_RECENT_LAUNCHES = 50;
const EXTERNAL_RECENT_DEDUP_WINDOW_MS = 5000;
const VOLATILE_EXTERNAL_PATH_SEGMENTS = new Set(["current"]);
const VOLATILE_EXTERNAL_PATH_SEGMENT_PATTERNS = [
  /^app-\d+(?:\.\d+){1,4}(?:[-_.a-z0-9]+)?$/i,
];
const NOISY_EXTERNAL_EXECUTABLE_NAMES = new Set([
  "git.exe",
  "git-remote-http.exe",
  "git-remote-https.exe",
  "git-credential-manager.exe",
  "git-lfs.exe",
  "cargo.exe",
  "rustc.exe",
  "rustup.exe",
  "clippy-driver.exe",
  "rls.exe",
  "rust-analyzer.exe",
  "vite.exe",
  "vue-tsc.exe",
  "esbuild.exe",
  "node.exe",
  "npm.exe",
  "npx.exe",
  "pnpm.exe",
  "bun.exe",
  "bunx.exe",
  "powershell.exe",
  "pwsh.exe",
  "cmd.exe",
  "conhost.exe",
  "wsl.exe",
  "wslhost.exe",
  "winget.exe",
  "msbuild.exe",
  "dotnet.exe",
  "java.exe",
  "javaw.exe",
]);
const NOISY_EXTERNAL_PATH_PARTS = [
  "\\windows\\system32\\",
  "\\windows\\syswow64\\",
  "\\windows\\winsxs\\",
  "\\windows\\servicing\\",
  "\\windows\\microsoft.net\\",
  "\\windows\\assembly\\",
  "\\users\\air\\appdata\\local\\programs\\microsoft vs code\\",
];
const MIN_TIME_SLOT_RECOMMENDATION_LAUNCHES = 3;
const MIN_TIME_SLOT_RECOMMENDATION_TOTAL_LAUNCHES = 5;
const MIN_TIME_SLOT_RECOMMENDATION_SLOT_SHARE = 0.3;

function getTimeBasedThreshold(totalLaunches: number): {
  minSlotLaunches: number;
  minTotalLaunches: number;
  minSlotShare: number;
} {
  if (totalLaunches < 3) return { minSlotLaunches: 2, minTotalLaunches: 2, minSlotShare: 0.4 };
  if (totalLaunches < 10) return { minSlotLaunches: 2, minTotalLaunches: 3, minSlotShare: 0.3 };
  return { minSlotLaunches: MIN_TIME_SLOT_RECOMMENDATION_LAUNCHES, minTotalLaunches: MIN_TIME_SLOT_RECOMMENDATION_TOTAL_LAUNCHES, minSlotShare: MIN_TIME_SLOT_RECOMMENDATION_SLOT_SHARE };
}
const TIME_BASED_RECOMMENDATION_SLOT_WEIGHT = 5;
const TIME_BASED_RECOMMENDATION_WEEK_WEIGHT = 2;
const TIME_BASED_RECOMMENDATION_RECENT_DAY_SCORE = 50;
const TIME_BASED_RECOMMENDATION_RECENT_THREE_DAYS_SCORE = 30;
const TIME_BASED_RECOMMENDATION_RECENT_WEEK_SCORE = 10;

const SMART_SORT_STREAK_EVENT_WINDOW = 120;
const SMART_SORT_STREAK_RECENCY_MIN_FACTOR = 0.3;
const SMART_SORT_WEIGHTS = {
  recentFrequency: 0.4,
  longTermFrequency: 0.2,
  currentTimeSlot: 0.2,
  recentConsecutive: 0.1,
  pinned: 0.1,
} as const;

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

export type ExternalRecentLaunchRecord = {
  path: string;
  name: string;
  source: string;
  iconBase64: string | null;
  usedAt: number;
  usageCount: number;
};

export type BlockedExternalLaunchRecord = {
  path: string;
  name: string;
  source: string;
  blockedAt: number;
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
  const weekAgo = now - WEEK_MS;
  return timestamp >= weekAgo;
}

function getTimeBasedRecommendationRecencyScore(lastUsedAt: number, now: number): number {
  if (!Number.isFinite(lastUsedAt) || lastUsedAt <= 0) return 0;

  if (lastUsedAt >= now - DAY_MS) {
    return TIME_BASED_RECOMMENDATION_RECENT_DAY_SCORE;
  }
  if (lastUsedAt >= now - 3 * DAY_MS) {
    return TIME_BASED_RECOMMENDATION_RECENT_THREE_DAYS_SCORE;
  }
  if (lastUsedAt >= now - WEEK_MS) {
    return TIME_BASED_RECOMMENDATION_RECENT_WEEK_SCORE;
  }

  return 0;
}

function getTimeBasedRecommendationScore(
  stats: AppUsageStats,
  currentSlot: TimeSlot,
  now: number
): number {
  const currentSlotLaunches = stats.timeSlotCounts[currentSlot];
  const recencyScore = getTimeBasedRecommendationRecencyScore(stats.lastUsedAt, now);

  return (
    currentSlotLaunches * TIME_BASED_RECOMMENDATION_SLOT_WEIGHT +
    stats.weekLaunches * TIME_BASED_RECOMMENDATION_WEEK_WEIGHT +
    recencyScore
  );
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

function normalizePathKey(path: string): string {
  return path.trim().replace(/\//g, "\\").toLowerCase();
}

function normalizeExecutableIdentityKey(path: string): string {
  const pathKey = normalizePathKey(path);
  if (!pathKey) return "";

  const segments = pathKey.split("\\");
  if (segments.length <= 1) return pathKey;

  const executableName = segments[segments.length - 1] || "";
  if (!executableName.endsWith(".exe")) {
    return pathKey;
  }

  const normalizedSegments: string[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (!segment) continue;
    if (index === segments.length - 1) {
      normalizedSegments.push(segment);
      continue;
    }
    if (VOLATILE_EXTERNAL_PATH_SEGMENTS.has(segment)) continue;
    if (VOLATILE_EXTERNAL_PATH_SEGMENT_PATTERNS.some((pattern) => pattern.test(segment))) {
      continue;
    }
    normalizedSegments.push(segment);
  }

  return normalizedSegments.join("\\");
}

export function normalizeExternalExecutableIdentity(path: string): string {
  return normalizeExecutableIdentityKey(path);
}

function getExecutableNameFromPath(path: string): string {
  const normalized = normalizePathKey(path);
  if (!normalized) return "";
  const segments = normalized.split("\\");
  return segments[segments.length - 1] || "";
}

function isNoisyExternalPath(path: string): boolean {
  const pathKey = normalizePathKey(path);
  if (!pathKey) return true;
  if (!pathKey.endsWith(".exe")) return true;
  if (NOISY_EXTERNAL_PATH_PARTS.some((part) => pathKey.includes(part))) {
    return true;
  }
  const executableName = getExecutableNameFromPath(pathKey);
  return NOISY_EXTERNAL_EXECUTABLE_NAMES.has(executableName);
}

function normalizeExternalRecentLaunchRecord(
  record: Partial<ExternalRecentLaunchRecord> | null | undefined
): ExternalRecentLaunchRecord | null {
  const path = typeof record?.path === "string" ? record.path.trim() : "";
  if (!path) return null;
  if (isNoisyExternalPath(path)) return null;

  const name = typeof record?.name === "string" && record.name.trim()
    ? record.name.trim()
    : path.split(/[\\/]/).pop() || path;

  const source = typeof record?.source === "string" && record.source.trim()
    ? record.source.trim()
    : "系统启动";

  return {
    path,
    name,
    source,
    iconBase64: typeof record?.iconBase64 === "string" && record.iconBase64.trim()
      ? record.iconBase64
      : null,
    usedAt: normalizeTimestamp(record?.usedAt ?? Date.now()),
    usageCount: normalizeUsageCount(record?.usageCount),
  };
}

function normalizeBlockedExternalLaunchRecord(
  record: Partial<BlockedExternalLaunchRecord> | null | undefined
): BlockedExternalLaunchRecord | null {
  const path = typeof record?.path === "string" ? record.path.trim() : "";
  if (!path) return null;

  const name = typeof record?.name === "string" && record.name.trim()
    ? record.name.trim()
    : path.split(/[\\/]/).pop() || path;

  const source = typeof record?.source === "string" && record.source.trim()
    ? record.source.trim()
    : "系统启动";

  return {
    path,
    name,
    source,
    blockedAt: normalizeTimestamp(record?.blockedAt ?? Date.now()),
  };
}

function sanitizeBlockedExternalLaunchRecords(
  records: Array<Partial<BlockedExternalLaunchRecord> | null | undefined>
): BlockedExternalLaunchRecord[] {
  const mergedByPath = new Map<string, BlockedExternalLaunchRecord>();

  const sorted = [...records]
    .map((record) => normalizeBlockedExternalLaunchRecord(record))
    .filter((record): record is BlockedExternalLaunchRecord => !!record)
    .sort((a, b) => b.blockedAt - a.blockedAt);

  for (const record of sorted) {
    const pathKey = normalizePathKey(record.path);
    if (!pathKey) continue;
    const existing = mergedByPath.get(pathKey);
    if (!existing) {
      mergedByPath.set(pathKey, record);
      continue;
    }

    mergedByPath.set(pathKey, {
      ...existing,
      name: existing.name || record.name,
      source: existing.source || record.source,
      blockedAt: Math.max(existing.blockedAt, record.blockedAt),
    });
  }

  return [...mergedByPath.values()].sort((a, b) => b.blockedAt - a.blockedAt);
}

function sanitizeExternalRecentLaunchRecords(
  records: Array<Partial<ExternalRecentLaunchRecord> | null | undefined>,
  blockedPathKeys: Set<string> = new Set(),
  blockedIdentityKeys: Set<string> = new Set()
): ExternalRecentLaunchRecord[] {
  const mergedByIdentity = new Map<string, ExternalRecentLaunchRecord>();

  const sorted = [...records]
    .map((record) => normalizeExternalRecentLaunchRecord(record))
    .filter((record): record is ExternalRecentLaunchRecord => !!record)
    .sort((a, b) => b.usedAt - a.usedAt);

  for (const record of sorted) {
    const pathKey = normalizePathKey(record.path);
    if (!pathKey) continue;
    const identityKey = normalizeExecutableIdentityKey(pathKey) || pathKey;
    if (blockedPathKeys.has(pathKey)) continue;
    if (blockedIdentityKeys.has(identityKey)) continue;

    const existing = mergedByIdentity.get(identityKey);
    if (!existing) {
      mergedByIdentity.set(identityKey, record);
      continue;
    }

    mergedByIdentity.set(identityKey, {
      ...existing,
      name: existing.name || record.name,
      source: existing.source || record.source,
      iconBase64: existing.iconBase64 || record.iconBase64,
      usedAt: Math.max(existing.usedAt, record.usedAt),
      usageCount: Math.max(existing.usageCount, record.usageCount),
    });
  }

  return [...mergedByIdentity.values()]
    .sort((a, b) => b.usedAt - a.usedAt)
    .slice(0, MAX_EXTERNAL_RECENT_LAUNCHES);
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

function buildRecentConsecutiveScoreMap(
  launcher: ReturnType<typeof useLauncherStore>,
  launchEvents: LaunchEventRecord[],
  legacyUsageSnapshot: LegacyUsageSnapshotRecord[],
  trackingStartedAt: number | null
): Map<string, number> {
  const scoreMap = new Map<string, number>();
  const now = Date.now();

  const relevantEvents = launchEvents
    .slice(-SMART_SORT_STREAK_EVENT_WINDOW)
    .map((event) => normalizeLaunchEventRecord(event))
    .filter((event): event is LaunchEventRecord => !!event)
    .sort((a, b) => b.usedAt - a.usedAt);

  for (let index = 0; index < relevantEvents.length; index += 1) {
    const event = relevantEvents[index];
    const item = launcher.getLauncherItemById(event.categoryId, event.itemId);
    if (!item) continue;

    const key = `${event.categoryId}:${event.itemId}`;
    const eventWeight = (SMART_SORT_STREAK_EVENT_WINDOW - index) / SMART_SORT_STREAK_EVENT_WINDOW;
    const ageDays = Math.max(0, (now - event.usedAt) / DAY_MS);
    const recencyDecay = Math.max(
      SMART_SORT_STREAK_RECENCY_MIN_FACTOR,
      1 - ageDays / 30
    );
    const score = eventWeight * recencyDecay;
    scoreMap.set(key, (scoreMap.get(key) ?? 0) + score);
  }

  if (scoreMap.size > 0 || trackingStartedAt !== null) {
    return scoreMap;
  }

  // Compatibility fallback for users without launch-event tracking yet.
  const sortedLegacy = [...legacyUsageSnapshot]
    .map((record) => normalizeLegacyUsageRecord(record))
    .filter((record): record is LegacyUsageSnapshotRecord => !!record)
    .sort((a, b) => b.usedAt - a.usedAt)
    .slice(0, SMART_SORT_STREAK_EVENT_WINDOW);

  for (let index = 0; index < sortedLegacy.length; index += 1) {
    const record = sortedLegacy[index];
    const item = launcher.getLauncherItemById(record.categoryId, record.itemId);
    if (!item) continue;

    const key = `${record.categoryId}:${record.itemId}`;
    const eventWeight = (SMART_SORT_STREAK_EVENT_WINDOW - index) / SMART_SORT_STREAK_EVENT_WINDOW;
    scoreMap.set(key, (scoreMap.get(key) ?? 0) + eventWeight);
  }

  return scoreMap;
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
    const externalRecentLaunches = ref<ExternalRecentLaunchRecord[]>([]);
    const blockedExternalLaunches = ref<BlockedExternalLaunchRecord[]>([]);
    const launchTrackingStartedAt = ref<number | null>(null);
    const legacyUsageSnapshot = ref<LegacyUsageSnapshotRecord[]>([]);

    const blockedExternalPathKeys = computed(() => {
      const keys = new Set<string>();
      for (const record of blockedExternalLaunches.value) {
        const pathKey = normalizePathKey(record.path);
        if (pathKey) {
          keys.add(pathKey);
        }
      }
      return keys;
    });

    const blockedExternalIdentityKeys = computed(() => {
      const keys = new Set<string>();
      for (const record of blockedExternalLaunches.value) {
        const identityKey = normalizeExecutableIdentityKey(record.path);
        if (identityKey) {
          keys.add(identityKey);
        }
      }
      return keys;
    });

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
      externalRecentLaunches.value = [];
      launchTrackingStartedAt.value = null;
      legacyUsageSnapshot.value = [];
    }

    function isExternalLaunchBlocked(path: string): boolean {
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
      const normalized = normalizeExternalRecentLaunchRecord({
        path: record.path,
        name: record.name,
        source: record.source ?? "系统启动",
        iconBase64: record.iconBase64 ?? null,
        usedAt: record.usedAt ?? Date.now(),
        usageCount: 1,
      });
      if (!normalized) return;

      const pathKey = normalizePathKey(normalized.path);
      if (!pathKey) return;
      if (isExternalLaunchBlocked(normalized.path)) return;

      const identityKey = normalizeExecutableIdentityKey(normalized.path) || pathKey;

      const list = [...externalRecentLaunches.value];
      const existingIndex = list.findIndex((entry) => {
        const existingPathKey = normalizePathKey(entry.path);
        if (!existingPathKey) return false;
        if (existingPathKey === pathKey) return true;
        const existingIdentityKey = normalizeExecutableIdentityKey(entry.path) || existingPathKey;
        return existingIdentityKey === identityKey;
      });
      const now = normalized.usedAt;

      if (existingIndex >= 0) {
        const existing = list[existingIndex];
        const delta = now - existing.usedAt;
        if (delta >= 0 && delta < EXTERNAL_RECENT_DEDUP_WINDOW_MS) {
          if (!existing.iconBase64 && normalized.iconBase64) {
            existing.iconBase64 = normalized.iconBase64;
            externalRecentLaunches.value = [...list];
          }
          return;
        }

        const merged: ExternalRecentLaunchRecord = {
          ...existing,
          name: normalized.name || existing.name,
          source: normalized.source || existing.source,
          iconBase64: normalized.iconBase64 ?? existing.iconBase64,
          usedAt: now,
          usageCount: (existing.usageCount || 1) + 1,
        };
        list.splice(existingIndex, 1);
        list.unshift(merged);
        externalRecentLaunches.value = list.slice(0, MAX_EXTERNAL_RECENT_LAUNCHES);
        return;
      }

      list.unshift(normalized);
      externalRecentLaunches.value = list.slice(0, MAX_EXTERNAL_RECENT_LAUNCHES);
    }

    function blockExternalLaunchPath(record: {
      path: string;
      name?: string;
      source?: string;
    }): void {
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
      const pathKey = normalizePathKey(path);
      if (!pathKey) return;
      const identityKey = normalizeExecutableIdentityKey(path);

      blockedExternalLaunches.value = sanitizeBlockedExternalLaunchRecords(
        blockedExternalLaunches.value.filter((entry) => {
          const existingPathKey = normalizePathKey(entry.path);
          if (existingPathKey === pathKey) return false;
          if (identityKey) {
            const existingIdentityKey = normalizeExecutableIdentityKey(entry.path);
            if (existingIdentityKey === identityKey) {
              return false;
            }
          }
          return true;
        })
      );
    }

    function sanitizeExternalRecentLaunchHistory(): void {
      blockedExternalLaunches.value = sanitizeBlockedExternalLaunchRecords(blockedExternalLaunches.value);
      externalRecentLaunches.value = sanitizeExternalRecentLaunchRecords(
        externalRecentLaunches.value,
        blockedExternalPathKeys.value,
        blockedExternalIdentityKeys.value
      );
    }

    sanitizeExternalRecentLaunchHistory();

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
        .filter(
          ({ stats, currentSlotLaunches, slotShare }) => {
            const threshold = getTimeBasedThreshold(stats.totalLaunches);
            return (
              currentSlotLaunches >= threshold.minSlotLaunches &&
              stats.totalLaunches >= threshold.minTotalLaunches &&
              slotShare >= threshold.minSlotShare
            );
          }
        )
        .sort((a, b) => {
          const scoreDiff = b.score - a.score;
          if (scoreDiff !== 0) return scoreDiff;

          const currentSlotDiff = b.currentSlotLaunches - a.currentSlotLaunches;
          if (currentSlotDiff !== 0) return currentSlotDiff;

          return b.stats.lastUsedAt - a.stats.lastUsedAt;
        })
        .map(({ stats }) => stats)
        .slice(0, 8);
    });

    const frequentlyUsedApps = computed(() => {
      const now = Date.now();
      const threeDaysAgo = now - 3 * DAY_MS;

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

    function getSmartSortOrder(
      categoryId: string,
      itemIds: string[],
      pinnedItemIds: string[] = []
    ): string[] {
      const launcher = useLauncherStore();
      const currentSlot = getCurrentTimeSlot();
      const pinnedSet = new Set(pinnedItemIds);
      const categoryStatsMap = new Map(
        appUsageStats.value
          .filter((stats) => stats.categoryId === categoryId)
          .map((stats) => [stats.itemId, stats] as const)
      );

      const recentConsecutiveScoreMap = buildRecentConsecutiveScoreMap(
        launcher,
        launchEvents.value,
        legacyUsageSnapshot.value,
        launchTrackingStartedAt.value
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
            stats.timeSlotCounts[currentSlot]
          );
        }
        maxRecentConsecutiveScore = Math.max(
          maxRecentConsecutiveScore,
          recentConsecutiveScoreMap.get(`${categoryId}:${itemId}`) ?? 0
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

        return {
          id,
          score,
          originalIndex,
        };
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
  }
);
