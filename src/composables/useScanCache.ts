import { ref, readonly } from "vue";
import { invoke } from "../utils/invoke-wrapper";
import {
  type ScannedAppCache,
  type ScannedAppEntry,
  type ScannedFallbackSection,
} from "../types/scan-cache";
import { useLauncherStore } from "../stores/launcherStore";
import { matchScannedApps, normalizePathKey } from "../utils/scan-fallback";

const DEBUG_SCAN_CACHE = false;
const RESOLVED_LNK_TARGET_STORAGE_KEY = "__resolved_lnk_target_cache__";

type PersistedResolvedLnkTargets = Record<string, string>;

function debugLog(...args: unknown[]) {
  if (DEBUG_SCAN_CACHE) {
    console.log("[useScanCache]", ...args);
  }
}

function debugWarn(...args: unknown[]) {
  if (DEBUG_SCAN_CACHE) {
    console.warn("[useScanCache]", ...args);
  }
}

let cachedScanResult: ScannedAppCache | null = null;
let cacheLoadPromise: Promise<void> | null = null;
const iconHydrationPromises = new Map<string, Promise<string | null>>();
const resolvedLnkTargetCache = new Map<string, string | null>();
let launcherPathKeyCache: { fingerprint: string; keys: Set<string> } | null = null;
/** 同一批 .lnk 只解析一次（并发调用 getFallbackSection 时共享）。 */
let pendingLnkBatch: Promise<void> | null = null;

function getResolvedLnkCacheKey(path: string): string {
  return normalizePathKey(path);
}

function readPersistedResolvedLnkTargets(): PersistedResolvedLnkTargets {
  try {
    const raw = localStorage.getItem(RESOLVED_LNK_TARGET_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const next: PersistedResolvedLnkTargets = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== "string") continue;
      const trimmed = value.trim();
      if (!trimmed) continue;
      next[key] = trimmed;
    }
    return next;
  } catch (error) {
    debugWarn("failed to read persisted lnk cache:", error);
    return {};
  }
}

function writePersistedResolvedLnkTargets(): void {
  try {
    const entries: PersistedResolvedLnkTargets = {};
    for (const [key, value] of resolvedLnkTargetCache.entries()) {
      if (typeof value !== "string") continue;
      const trimmed = value.trim();
      if (!trimmed) continue;
      entries[key] = trimmed;
    }
    localStorage.setItem(RESOLVED_LNK_TARGET_STORAGE_KEY, JSON.stringify(entries));
  } catch (error) {
    debugWarn("failed to persist lnk cache:", error);
  }
}

function seedResolvedLnkTargetCache(): void {
  if (resolvedLnkTargetCache.size > 0) return;
  const persisted = readPersistedResolvedLnkTargets();
  for (const [key, value] of Object.entries(persisted)) {
    resolvedLnkTargetCache.set(key, value);
  }
}

export function clearScanCacheStateForTests(): void {
  cachedScanResult = null;
  cacheLoadPromise = null;
  iconHydrationPromises.clear();
  resolvedLnkTargetCache.clear();
  launcherPathKeyCache = null;
  pendingLnkBatch = null;
}

export function useScanCache() {
  const isCacheReady = ref(false);
  const isLoading = ref(false);
  seedResolvedLnkTargetCache();

  async function loadCache(): Promise<ScannedAppCache | null> {
    if (cachedScanResult) {
      isCacheReady.value = true;
      return cachedScanResult;
    }

    if (!cacheLoadPromise) {
      cacheLoadPromise = (async () => {
        isLoading.value = true;
        try {
          const result = await invoke<ScannedAppCache | null>("read_scan_cache");
          debugLog("read_scan_cache raw result:", JSON.stringify(result));
          if (!result.ok) {
            debugWarn("read_scan_cache failed:", result.error);
            return;
          }
          const value = result.value;
          debugLog("read_scan_cache value:", value, "type:", typeof value);
          if (value === null || value === undefined) {
            debugLog("cache is null, no fallback data available");
            return;
          }
          debugLog("cache loaded:", value.apps?.length ?? 0, "apps");
          cachedScanResult = value as ScannedAppCache;
          isCacheReady.value = true;
        } catch (e) {
          debugWarn("Exception loading cache:", e);
        } finally {
          isLoading.value = false;
        }
      })();
    }

    await cacheLoadPromise;
    return cachedScanResult;
  }

  function buildLauncherFingerprint(): string {
    const launcherStore = useLauncherStore();
    const paths: string[] = [];

    for (const [categoryId, items] of Object.entries(launcherStore.launcherItemsByCategoryId)) {
      paths.push(`cat:${categoryId}`);
      for (const item of items) {
        if (item.path) {
          paths.push(item.path);
          if (item.resolvedPath) {
            paths.push(`resolved:${item.resolvedPath}`);
          }
        }
        if (item.url) {
          paths.push(`url:${item.url}`);
        }
      }
    }

    return paths.join("\u0001");
  }

  async function buildLauncherPathKeys(): Promise<Set<string>> {
    const launcherStore = useLauncherStore();
    const fingerprint = buildLauncherFingerprint();
    if (launcherPathKeyCache?.fingerprint === fingerprint) {
      return launcherPathKeyCache.keys;
    }

    const keys = new Set<string>();
    /** 本轮需要解析、且不在内存缓存里的 .lnk：一次批量 IPC 解决。 */
    const unresolvedLnkItems: Array<{
      categoryId: string;
      itemId: string;
      path: string;
      cacheKey: string;
    }> = [];

    for (const [categoryId, items] of Object.entries(launcherStore.launcherItemsByCategoryId)) {
      for (const item of items) {
        if (item.itemType === "url" && item.url) {
          keys.add(normalizePathKey(item.url));
          continue;
        }

        if (!item.path) continue;

        let pathToAdd = item.resolvedPath || item.path;
        const lnkCacheKey = getResolvedLnkCacheKey(item.path);

        if (item.path.toLowerCase().endsWith('.lnk')) {
          if (item.resolvedPath) {
            pathToAdd = item.resolvedPath;
            resolvedLnkTargetCache.set(lnkCacheKey, item.resolvedPath);
            writePersistedResolvedLnkTargets();
          } else if (resolvedLnkTargetCache.has(lnkCacheKey)) {
            const cachedTarget = resolvedLnkTargetCache.get(lnkCacheKey);
            if (cachedTarget) {
              pathToAdd = cachedTarget;
              launcherStore.setLauncherItemResolvedPath(categoryId, item.id, cachedTarget);
            }
          } else {
            unresolvedLnkItems.push({
              categoryId,
              itemId: item.id,
              path: item.path,
              cacheKey: lnkCacheKey,
            });
          }
        }

        const normalized = normalizePathKey(pathToAdd);
        keys.add(normalized);
      }
    }

    if (unresolvedLnkItems.length > 0) {
      await resolvePendingLnkTargets(unresolvedLnkItems);
      // 解析结果会改变 key 集合，重建一次（此时全部命中缓存，不会再有 IPC）。
      return buildLauncherPathKeys();
    }

    launcherPathKeyCache = { fingerprint, keys };
    return keys;
  }

  /**
   * 批量解析 .lnk 目标。
   *
   * 之前是逐个 `invoke('resolve_lnk_target')`，上百个启动项就是上百次 IPC 往返；
   * 现在一次 `resolve_lnk_targets` 拿全部结果，并同步写入本地/持久化缓存，
   * 避免重启后重复解析。
   */
  function resolvePendingLnkTargets(
    targets: Array<{ categoryId: string; itemId: string; path: string; cacheKey: string }>
  ): Promise<void> {
    if (pendingLnkBatch) return pendingLnkBatch;
    const launcherStore = useLauncherStore();

    pendingLnkBatch = (async () => {
      const uniquePaths: string[] = [];
      const pathSet = new Set<string>();
      for (const target of targets) {
        if (pathSet.has(target.path)) continue;
        pathSet.add(target.path);
        uniquePaths.push(target.path);
      }

      let resolvedList: Array<string | null> = [];
      try {
        const result = await invoke<Array<string | null>>('resolve_lnk_targets', {
          paths: uniquePaths,
        });
        if (result.ok && Array.isArray(result.value)) {
          resolvedList = result.value;
        } else if (!result.ok) {
          debugWarn('failed to resolve lnk batch:', result.error);
        }
      } catch (e) {
        debugWarn('failed to resolve lnk batch:', e);
      }

      const resolvedByPath = new Map<string, string | null>();
      for (let i = 0; i < uniquePaths.length; i += 1) {
        const resolved = resolvedList[i] ?? null;
        const trimmed = typeof resolved === 'string' ? resolved.trim() : '';
        resolvedByPath.set(uniquePaths[i], trimmed || null);
      }

      let cacheDirty = false;
      for (const target of targets) {
        const resolved = resolvedByPath.get(target.path) ?? null;
        resolvedLnkTargetCache.set(target.cacheKey, resolved);
        cacheDirty = true;
        if (!resolved) continue;
        launcherStore.setLauncherItemResolvedPath(target.categoryId, target.itemId, resolved);
        debugLog('resolved lnk:', target.path, '->', resolved);
      }

      if (cacheDirty) {
        writePersistedResolvedLnkTargets();
      }
    })().finally(() => {
      pendingLnkBatch = null;
    });

    return pendingLnkBatch;
  }

  async function warmLauncherPathKeys(): Promise<void> {
    await buildLauncherPathKeys();
  }

  function updateCachedEntryIcon(path: string, iconBase64: string) {
    if (!cachedScanResult) return;
    const pathKey = normalizePathKey(path);
    const target = cachedScanResult.apps.find(
      (entry) =>
        normalizePathKey(entry.path) === pathKey ||
        normalizePathKey(entry.targetPath ?? "") === pathKey
    );
    if (target) {
      target.iconBase64 = iconBase64;
    }
  }

  async function hydrateEntryIcon(entry: ScannedAppEntry): Promise<ScannedAppEntry> {
    if (entry.iconBase64) return entry;

    const iconLookupPath = entry.targetPath?.trim() || entry.path;
    let pending = iconHydrationPromises.get(iconLookupPath);
    if (!pending) {
      pending = (async () => {
        const result = await invoke<string | null>("extract_icon_lazy", { path: iconLookupPath });
        if (!result.ok || !result.value) {
          return null;
        }
        updateCachedEntryIcon(iconLookupPath, result.value);
        return result.value;
      })().finally(() => {
        iconHydrationPromises.delete(iconLookupPath);
      });
      iconHydrationPromises.set(iconLookupPath, pending);
    }

    const iconBase64 = await pending;
    if (!iconBase64) return entry;
    return {
      ...entry,
      iconBase64,
    };
  }

  async function hydrateSectionIcons(
    section: ScannedFallbackSection
  ): Promise<ScannedFallbackSection> {
    if (!section.items.some((entry) => !entry.iconBase64)) {
      return section;
    }

    const items = await Promise.all(section.items.map((entry) => hydrateEntryIcon(entry)));
    return {
      ...section,
      items,
    };
  }

  async function getFallbackSection(
    keyword: string
  ): Promise<ScannedFallbackSection | null> {
    const cache = await loadCache();
    debugLog("getFallbackSection cache:", !!cache, cache?.apps?.length);
    if (!cache || !cache.apps || !cache.apps.length) return null;

    const launcherPathKeys = await buildLauncherPathKeys();
    const matched = matchScannedApps(keyword, cache.apps, launcherPathKeys);
    debugLog("matched apps for keyword:", keyword, matched.length);

    if (matched.length === 0) return null;

    return {
      sectionTitle: "电脑应用",
      totalMatches: matched.length,
      items: matched,
    };
  }

  return {
    isCacheReady: readonly(isCacheReady),
    isLoading: readonly(isLoading),
    loadCache,
    warmLauncherPathKeys,
    matchScannedApps,
    getFallbackSection,
    hydrateSectionIcons,
  };
}
