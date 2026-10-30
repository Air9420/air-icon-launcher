/** Pure stats helpers shared by StatsService and statsStore (no pinia/cordis imports). */

export type TimeSlot = "morning" | "afternoon" | "evening" | "night";

export const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEK_MS = 7 * DAY_MS;
export const MAX_LAUNCH_EVENTS = 5000;
export const MAX_LAUNCH_EVENT_AGE_MS = 180 * DAY_MS;
export const MAX_EXTERNAL_RECENT_LAUNCHES = 50;
const EXTERNAL_RECENT_DEDUP_WINDOW_MS = 5000;
const VOLATILE_EXTERNAL_PATH_SEGMENTS = new Set(["current"]);
const VOLATILE_EXTERNAL_PATH_SEGMENT_PATTERNS = [
  /^app-\d+(?:\.\d+){1,4}(?:[-_.a-z0-9]+)?$/i,
];
const NOISY_EXTERNAL_EXECUTABLE_NAMES = new Set([
  "git.exe", "git-remote-http.exe", "git-remote-https.exe",
  "git-credential-manager.exe", "git-lfs.exe", "cargo.exe", "rustc.exe",
  "rustup.exe", "clippy-driver.exe", "rls.exe", "rust-analyzer.exe",
  "vite.exe", "vue-tsc.exe", "esbuild.exe", "node.exe", "npm.exe",
  "npx.exe", "pnpm.exe", "bun.exe", "bunx.exe", "powershell.exe",
  "pwsh.exe", "cmd.exe", "conhost.exe", "wsl.exe", "wslhost.exe",
  "winget.exe", "msbuild.exe", "dotnet.exe", "java.exe", "javaw.exe",
]);
const NOISY_EXTERNAL_PATH_PARTS = [
  "\\windows\\system32\\", "\\windows\\syswow64\\", "\\windows\\winsxs\\",
  "\\windows\\servicing\\", "\\windows\\microsoft.net\\", "\\windows\\assembly\\",
  "\\users\\air\\appdata\\local\\programs\\microsoft vs code\\",
  "\\appdata\\local\\temp\\", "\\windows\\temp\\",
  "\\google下载目录\\", "\\downloads\\",
  "\\nvidia\\nvapp\\", "\\nvidia corporation\\nvidia app\\updateframework\\",
  "\\anticheatexpert\\",
];
const NOISY_EXTERNAL_NAME_PATTERNS = [
  "installer", "setup", "updater", "update", "uninstall",
];

export const SMART_SORT_STREAK_EVENT_WINDOW = 120;
export const SMART_SORT_STREAK_RECENCY_MIN_FACTOR = 0.3;
/**
 * 分类内智能排序权重。
 *
 * `longTermFrequency` 刻意高于 `recentFrequency`：启动器是"开一次用一天"的场景，
 * 周次数在归一化后区分度会被压平（天天用的浏览器和每天开 3 次的编辑器都接近 1.0），
 * 因此它只作为活跃度辅助项，长期累计次数才是主要排序依据。
 *
 * `pinned` 项在 `getSmartSortItems` 中已按置顶整组前置，组内所有条目该项取值相同，
 * 对组内相对排序无影响，保留仅用于保持权重表完整。
 */
export const SMART_SORT_WEIGHTS = {
  recentFrequency: 0.2,
  longTermFrequency: 0.45,
  currentTimeSlot: 0.2,
  recentConsecutive: 0.05,
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
  isDirectory?: boolean;
};

export type LegacyUsageSnapshotRecord = {
  categoryId: string;
  itemId: string;
  usedAt: number;
  usageCount: number;
};

export type AppUsageStats = {
  itemId: string;
  name: string;
  path: string;
  categoryId: string;
  /** 由事件流累加得出，受 MAX_LAUNCH_EVENTS / MAX_LAUNCH_EVENT_AGE_MS 裁剪影响。 */
  totalLaunches: number;
  /**
   * 终身累计启动次数：独立持久化，不受事件流裁剪影响。
   * 缺省时（旧数据 / 尚未迁移）回落到 `totalLaunches`。
   */
  lifetimeLaunches: number;
  weekLaunches: number;
  lastUsedAt: number;
  timeSlotCounts: Record<TimeSlot, number>;
};

/**
 * 终身启动计数表，key 为 `${categoryId}:${itemId}`。
 * 与 launchEvents 分离持久化，事件被裁剪后计数不会回退。
 */
export type LifetimeLaunchCounts = Record<string, number>;

/**
 * 终身时段分布表，key 为 `${categoryId}:${itemId}`。
 * 与 lifetimeLaunchCounts 同样独立持久化，保证智能排序的「当前时段」因子
 * 不随事件裁剪而失真。
 */
export type LifetimeTimeSlotCounts = Record<string, Record<TimeSlot, number>>;

export function getLifetimeCountKey(categoryId: string, itemId: string): string {
  return `${categoryId}:${itemId}`;
}

export function splitLifetimeCountKey(key: string): { categoryId: string; itemId: string } | null {
  const separatorIndex = key.indexOf(":");
  if (separatorIndex <= 0) return null;
  const categoryId = key.slice(0, separatorIndex);
  const itemId = key.slice(separatorIndex + 1);
  if (!categoryId || !itemId) return null;
  return { categoryId, itemId };
}

export function incrementLifetimeLaunchCount(
  counts: LifetimeLaunchCounts,
  categoryId: string,
  itemId: string,
  amount: number = 1,
): LifetimeLaunchCounts {
  if (!categoryId || !itemId || amount <= 0) return counts;
  const key = getLifetimeCountKey(categoryId, itemId);
  return { ...counts, [key]: (counts[key] ?? 0) + Math.floor(amount) };
}

export function incrementLifetimeTimeSlotCount(
  counts: LifetimeTimeSlotCounts,
  categoryId: string,
  itemId: string,
  slot: TimeSlot,
  amount: number = 1,
): LifetimeTimeSlotCounts {
  if (!categoryId || !itemId || amount <= 0) return counts;
  const key = getLifetimeCountKey(categoryId, itemId);
  const existing = counts[key] ?? createEmptyTimeSlotCounts();
  return {
    ...counts,
    [key]: { ...existing, [slot]: existing[slot] + Math.floor(amount) },
  };
}

export type LaunchEventCategoryRef = {
  fromCategoryId: string;
  toCategoryId: string;
  itemId: string;
};

export type ItemLookup = {
  name: string;
  path: string;
} | null;

export function createEmptyTimeSlotCounts(): Record<TimeSlot, number> {
  return { morning: 0, afternoon: 0, evening: 0, night: 0 };
}

export function getTimeSlot(hour: number): TimeSlot {
  if (isNaN(hour)) return "morning";
  if (hour >= 6 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 23) return "evening";
  return "night";
}

export function getHour(timestamp: number): number {
  if (!timestamp || isNaN(timestamp)) return new Date().getHours();
  return new Date(timestamp).getHours();
}

export function isWithinWeek(timestamp: number): boolean {
  if (!timestamp || isNaN(timestamp)) return false;
  return timestamp >= Date.now() - WEEK_MS;
}

export function normalizeTimestamp(value: number, fallback: number = Date.now()): number {
  if (!Number.isFinite(value) || value <= 0) return Math.floor(fallback);
  return Math.floor(value);
}

export function normalizeUsageCount(value: number | undefined): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value ?? 1));
}

export function normalizePathKey(path: string): string {
  return path.trim().replace(/\//g, "\\").toLowerCase();
}

export function isPathWithinDirectory(path: string, directory: string): boolean {
  const pathKey = normalizePathKey(path);
  const directoryKey = normalizePathKey(directory).replace(/\\+$/, "");
  if (!pathKey || !directoryKey) return false;
  const prefix = `${directoryKey}\\`;
  return pathKey === directoryKey || pathKey.startsWith(prefix);
}

export function normalizeExecutableIdentityKey(path: string): string {
  const pathKey = normalizePathKey(path);
  if (!pathKey) return "";
  const segments = pathKey.split("\\");
  if (segments.length <= 1) return pathKey;
  const executableName = segments[segments.length - 1] || "";
  if (!executableName.endsWith(".exe")) return pathKey;

  const normalizedSegments: string[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (!segment) continue;
    if (index === segments.length - 1) {
      normalizedSegments.push(segment);
      continue;
    }
    if (VOLATILE_EXTERNAL_PATH_SEGMENTS.has(segment)) continue;
    if (VOLATILE_EXTERNAL_PATH_SEGMENT_PATTERNS.some((p) => p.test(segment))) continue;
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

export function isNoisyExternalPath(path: string): boolean {
  const pathKey = normalizePathKey(path);
  if (!pathKey) return true;
  if (!pathKey.endsWith(".exe")) return true;
  if (NOISY_EXTERNAL_PATH_PARTS.some((part) => pathKey.includes(part))) return true;
  const executableName = getExecutableNameFromPath(pathKey);
  if (NOISY_EXTERNAL_EXECUTABLE_NAMES.has(executableName)) return true;
  const nameStem = executableName.replace(/\.exe$/, "");
  return NOISY_EXTERNAL_NAME_PATTERNS.some((pattern) => nameStem.includes(pattern));
}

export function normalizeExternalRecentLaunchRecord(
  record: Partial<ExternalRecentLaunchRecord> | null | undefined,
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

export function normalizeBlockedExternalLaunchRecord(
  record: Partial<BlockedExternalLaunchRecord> | null | undefined,
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
    isDirectory: record?.isDirectory === true,
  };
}

export function sanitizeBlockedExternalLaunchRecords(
  records: Array<Partial<BlockedExternalLaunchRecord> | null | undefined>,
): BlockedExternalLaunchRecord[] {
  const mergedByPath = new Map<string, BlockedExternalLaunchRecord>();
  const sorted = [...records]
    .map((r) => normalizeBlockedExternalLaunchRecord(r))
    .filter((r): r is BlockedExternalLaunchRecord => !!r)
    .sort((a, b) => b.blockedAt - a.blockedAt);

  for (const record of sorted) {
    const pathKey = normalizePathKey(record.path);
    if (!pathKey) continue;
    const normalizedRecordPath = record.isDirectory
      ? pathKey.replace(/\\+$/, "")
      : pathKey;
    const recordKey = `${record.isDirectory ? "directory" : "path"}:${normalizedRecordPath}`;
    const existing = mergedByPath.get(recordKey);
    if (!existing) {
      mergedByPath.set(recordKey, record);
      continue;
    }
    mergedByPath.set(recordKey, {
      ...existing,
      name: existing.name || record.name,
      source: existing.source || record.source,
      blockedAt: Math.max(existing.blockedAt, record.blockedAt),
    });
  }
  return [...mergedByPath.values()].sort((a, b) => b.blockedAt - a.blockedAt);
}

export function sanitizeExternalRecentLaunchRecords(
  records: Array<Partial<ExternalRecentLaunchRecord> | null | undefined>,
  blockedPathKeys: Set<string> = new Set(),
  blockedIdentityKeys: Set<string> = new Set(),
): ExternalRecentLaunchRecord[] {
  const mergedByIdentity = new Map<string, ExternalRecentLaunchRecord>();
  const sorted = [...records]
    .map((r) => normalizeExternalRecentLaunchRecord(r))
    .filter((r): r is ExternalRecentLaunchRecord => !!r)
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

export function normalizeLaunchEventRecord(
  record: Partial<LaunchEventRecord> | null | undefined,
): LaunchEventRecord | null {
  const categoryId = typeof record?.categoryId === "string" ? record.categoryId.trim() : "";
  const itemId = typeof record?.itemId === "string" ? record.itemId.trim() : "";
  if (!categoryId || !itemId) return null;
  return {
    categoryId,
    itemId,
    usedAt: normalizeTimestamp(record?.usedAt ?? Date.now()),
  };
}

export function normalizeLegacyUsageRecord(
  record: Partial<LegacyUsageSnapshotRecord> | { categoryId: string; itemId: string; usedAt: number; usageCount?: number } | null | undefined,
): LegacyUsageSnapshotRecord | null {
  const normalizedEvent = normalizeLaunchEventRecord(record);
  if (!normalizedEvent) return null;
  return {
    ...normalizedEvent,
    usageCount: normalizeUsageCount((record as LegacyUsageSnapshotRecord | undefined)?.usageCount),
  };
}

export function normalizeLegacyUsageSnapshot(
  records: Array<Partial<LegacyUsageSnapshotRecord> | { categoryId: string; itemId: string; usedAt: number; usageCount?: number }>,
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

export function pruneLaunchEvents(records: LaunchEventRecord[]): LaunchEventRecord[] {
  const cutoff = Date.now() - MAX_LAUNCH_EVENT_AGE_MS;
  const normalized = records
    .map((r) => normalizeLaunchEventRecord(r))
    .filter((r): r is LaunchEventRecord => !!r && r.usedAt >= cutoff)
    .sort((a, b) => a.usedAt - b.usedAt);
  if (normalized.length <= MAX_LAUNCH_EVENTS) return normalized;
  return normalized.slice(-MAX_LAUNCH_EVENTS);
}

export function applyUsageCount(
  usageMap: Map<string, AppUsageStats>,
  getItem: (categoryId: string, itemId: string) => ItemLookup,
  record: { categoryId: string; itemId: string; usedAt: number },
  count: number,
): void {
  if (count <= 0) return;
  const key = `${record.categoryId}-${record.itemId}`;
  let entry = usageMap.get(key);
  if (!entry) {
    const item = getItem(record.categoryId, record.itemId);
    if (!item) return;
    entry = {
      itemId: record.itemId,
      name: item.name,
      path: item.path,
      categoryId: record.categoryId,
      totalLaunches: 0,
      lifetimeLaunches: 0,
      weekLaunches: 0,
      lastUsedAt: 0,
      timeSlotCounts: createEmptyTimeSlotCounts(),
    };
    usageMap.set(key, entry);
  }
  const slot = getTimeSlot(getHour(record.usedAt));
  entry.totalLaunches += count;
  if (isWithinWeek(record.usedAt)) entry.weekLaunches += count;
  if (record.usedAt > entry.lastUsedAt) entry.lastUsedAt = record.usedAt;
  entry.timeSlotCounts[slot] += count;
}

export function computeAppUsageStats(options: {
  launchEvents: LaunchEventRecord[];
  legacyUsageSnapshot: LegacyUsageSnapshotRecord[];
  recentUsedItems: Array<{ categoryId: string; itemId: string; usedAt: number; usageCount?: number }>;
  launchTrackingStartedAt: number | null;
  getItem: (categoryId: string, itemId: string) => ItemLookup;
  /** 可选：独立持久化的终身计数表。缺省时 lifetimeLaunches 回落到 totalLaunches。 */
  lifetimeLaunchCounts?: LifetimeLaunchCounts;
  /** 可选：独立持久化的终身时段分布表。缺省时沿用事件流累加值。 */
  lifetimeTimeSlotCounts?: LifetimeTimeSlotCounts;
}): AppUsageStats[] {
  const usageMap = new Map<string, AppUsageStats>();
  const {
    launchEvents,
    legacyUsageSnapshot,
    recentUsedItems,
    launchTrackingStartedAt,
    getItem,
    lifetimeLaunchCounts,
    lifetimeTimeSlotCounts,
  } = options;

  if (launchTrackingStartedAt === null) {
    for (const recent of recentUsedItems) {
      const normalized = normalizeLegacyUsageRecord(recent);
      if (!normalized) continue;
      applyUsageCount(usageMap, getItem, normalized, normalized.usageCount);
    }
  } else {
    for (const record of legacyUsageSnapshot) {
      applyUsageCount(usageMap, getItem, record, record.usageCount);
    }
    for (const record of launchEvents) {
      applyUsageCount(usageMap, getItem, record, 1);
    }
  }

  // 事件流可能已把某个条目的历史全部裁掉，此时它仍应凭终身计数出现在统计里，
  // 否则「用了几百次的老应用」会在 180 天后从榜单上消失。
  if (lifetimeLaunchCounts) {
    for (const [key, count] of Object.entries(lifetimeLaunchCounts)) {
      if (count <= 0) continue;
      const separatorIndex = key.indexOf(":");
      if (separatorIndex <= 0) continue;
      const categoryId = key.slice(0, separatorIndex);
      const itemId = key.slice(separatorIndex + 1);
      if (!itemId) continue;
      if (usageMap.has(`${categoryId}-${itemId}`)) continue;
      const item = getItem(categoryId, itemId);
      if (!item) continue;
      const entry: AppUsageStats = {
        itemId,
        name: item.name,
        path: item.path,
        categoryId,
        totalLaunches: 0,
        lifetimeLaunches: 0,
        weekLaunches: 0,
        lastUsedAt: 0,
        timeSlotCounts: createEmptyTimeSlotCounts(),
      };
      usageMap.set(`${categoryId}-${itemId}`, entry);
    }
  }

  // 终身计数取「持久化计数」与「事件流可算出的次数」的较大值：
  // 老数据尚未建立计数表时自然回落到 totalLaunches，且永不回退。
  for (const entry of usageMap.values()) {
    const key = getLifetimeCountKey(entry.categoryId, entry.itemId);
    const persisted = lifetimeLaunchCounts?.[key] ?? 0;
    entry.lifetimeLaunches = Math.max(persisted, entry.totalLaunches);

    // 时段分布同样以持久化值为准，避免事件裁剪后时段推荐失真。
    const persistedSlots = lifetimeTimeSlotCounts?.[key];
    if (persistedSlots) {
      entry.timeSlotCounts = {
        morning: Math.max(persistedSlots.morning ?? 0, entry.timeSlotCounts.morning),
        afternoon: Math.max(persistedSlots.afternoon ?? 0, entry.timeSlotCounts.afternoon),
        evening: Math.max(persistedSlots.evening ?? 0, entry.timeSlotCounts.evening),
        night: Math.max(persistedSlots.night ?? 0, entry.timeSlotCounts.night),
      };
    }
  }

  return Array.from(usageMap.values());
}

export function buildRecentConsecutiveScoreMap(
  getItem: (categoryId: string, itemId: string) => ItemLookup,
  launchEvents: LaunchEventRecord[],
  legacyUsageSnapshot: LegacyUsageSnapshotRecord[],
  trackingStartedAt: number | null,
): Map<string, number> {
  const scoreMap = new Map<string, number>();
  const now = Date.now();

  const relevantEvents = launchEvents
    .slice(-SMART_SORT_STREAK_EVENT_WINDOW)
    .map((e) => normalizeLaunchEventRecord(e))
    .filter((e): e is LaunchEventRecord => !!e)
    .sort((a, b) => b.usedAt - a.usedAt);

  for (let index = 0; index < relevantEvents.length; index += 1) {
    const event = relevantEvents[index];
    if (!getItem(event.categoryId, event.itemId)) continue;
    const key = `${event.categoryId}:${event.itemId}`;
    const eventWeight = (SMART_SORT_STREAK_EVENT_WINDOW - index) / SMART_SORT_STREAK_EVENT_WINDOW;
    const ageDays = Math.max(0, (now - event.usedAt) / DAY_MS);
    const recencyDecay = Math.max(SMART_SORT_STREAK_RECENCY_MIN_FACTOR, 1 - ageDays / 30);
    scoreMap.set(key, (scoreMap.get(key) ?? 0) + eventWeight * recencyDecay);
  }

  if (scoreMap.size > 0 || trackingStartedAt !== null) return scoreMap;

  const sortedLegacy = [...legacyUsageSnapshot]
    .map((r) => normalizeLegacyUsageRecord(r))
    .filter((r): r is LegacyUsageSnapshotRecord => !!r)
    .sort((a, b) => b.usedAt - a.usedAt)
    .slice(0, SMART_SORT_STREAK_EVENT_WINDOW);

  for (let index = 0; index < sortedLegacy.length; index += 1) {
    const record = sortedLegacy[index];
    if (!getItem(record.categoryId, record.itemId)) continue;
    const key = `${record.categoryId}:${record.itemId}`;
    const eventWeight = (SMART_SORT_STREAK_EVENT_WINDOW - index) / SMART_SORT_STREAK_EVENT_WINDOW;
    scoreMap.set(key, (scoreMap.get(key) ?? 0) + eventWeight);
  }
  return scoreMap;
}

export function recordSearchKeyword(
  history: SearchKeywordRecord[],
  keyword: string,
): SearchKeywordRecord[] {
  const displayKeyword = keyword.trim();
  const trimmed = displayKeyword.toLowerCase();
  if (!trimmed || displayKeyword.length > 50) return history;

  let newHistory = [...history];
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
  if (newHistory.length > 200) newHistory = newHistory.slice(0, 200);
  return newHistory;
}

export function dedupExternalRecentOnRecord(
  list: ExternalRecentLaunchRecord[],
  normalized: ExternalRecentLaunchRecord,
): ExternalRecentLaunchRecord[] {
  const pathKey = normalizePathKey(normalized.path);
  if (!pathKey) return list;
  const identityKey = normalizeExecutableIdentityKey(normalized.path) || pathKey;
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
        const next = [...list];
        next[existingIndex] = { ...existing, iconBase64: normalized.iconBase64 };
        return next;
      }
      return list;
    }
    const merged: ExternalRecentLaunchRecord = {
      ...existing,
      name: normalized.name || existing.name,
      source: normalized.source || existing.source,
      iconBase64: normalized.iconBase64 ?? existing.iconBase64,
      usedAt: now,
      usageCount: (existing.usageCount || 1) + 1,
    };
    const next = [...list];
    next.splice(existingIndex, 1);
    next.unshift(merged);
    return next.slice(0, MAX_EXTERNAL_RECENT_LAUNCHES);
  }

  return [normalized, ...list].slice(0, MAX_EXTERNAL_RECENT_LAUNCHES);
}
