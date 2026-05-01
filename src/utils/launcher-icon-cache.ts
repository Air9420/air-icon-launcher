const STORAGE_KEY = "__launcher_icon_cache__";
const CACHE_VERSION = 1;
const MAX_ICON_CACHE_ENTRIES = 300;
const CACHE_PERSIST_TIMEOUT_MS = 1000;

type LauncherIconCacheEntry = {
    path: string;
    iconBase64: string;
    updatedAt: number;
};

type LauncherIconCachePayload = {
    version: number;
    entries: LauncherIconCacheEntry[];
};

let cacheLoaded = false;
let cacheEntries = new Map<string, LauncherIconCacheEntry>();
let persistHandle:
    | { kind: "timeout"; handle: ReturnType<typeof setTimeout> }
    | { kind: "idle"; handle: number }
    | null = null;
let flushListenersRegistered = false;

function normalizeBase64Value(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function normalizePathKey(path: string): string {
    return path.trim().replace(/\//g, "\\").toLowerCase();
}

function ensureCacheLoaded(): void {
    if (cacheLoaded) return;
    cacheLoaded = true;
    registerFlushListeners();

    try {
        const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
        if (!raw) return;

        const parsed = JSON.parse(raw) as LauncherIconCachePayload;
        if (!parsed || parsed.version !== CACHE_VERSION || !Array.isArray(parsed.entries)) {
            return;
        }

        cacheEntries = new Map(
            parsed.entries
                .filter((entry) => entry && typeof entry.path === "string")
                .map((entry) => [normalizePathKey(entry.path), entry] as const)
        );
        pruneCacheEntries();
    } catch (error) {
        console.error("[IconCache] Failed to load launcher icon cache:", error);
        cacheEntries = new Map();
    }
}

function pruneCacheEntries(): void {
    if (cacheEntries.size <= MAX_ICON_CACHE_ENTRIES) return;

    const sortedEntries = [...cacheEntries.values()].sort(
        (a, b) => b.updatedAt - a.updatedAt
    );

    cacheEntries = new Map(
        sortedEntries
            .slice(0, MAX_ICON_CACHE_ENTRIES)
            .map((entry) => [normalizePathKey(entry.path), entry] as const)
    );
}

function persistCacheEntries(): void {
    try {
        globalThis.localStorage?.setItem(
            STORAGE_KEY,
            JSON.stringify({
                version: CACHE_VERSION,
                entries: [...cacheEntries.values()],
            } satisfies LauncherIconCachePayload)
        );
    } catch (error) {
        console.error("[IconCache] Failed to save launcher icon cache:", error);
    }
}

function clearScheduledPersist(): void {
    if (!persistHandle) return;

    if (persistHandle.kind === "timeout") {
        clearTimeout(persistHandle.handle);
    } else if (typeof globalThis.cancelIdleCallback === "function") {
        globalThis.cancelIdleCallback(persistHandle.handle);
    }

    persistHandle = null;
}

function flushPendingPersist(): void {
    if (!persistHandle) return;
    clearScheduledPersist();
    persistCacheEntries();
}

function schedulePersistCacheEntries(): void {
    if (persistHandle) return;

    if (typeof globalThis.requestIdleCallback === "function") {
        const handle = globalThis.requestIdleCallback(
            () => {
                persistHandle = null;
                persistCacheEntries();
            },
            { timeout: CACHE_PERSIST_TIMEOUT_MS }
        );
        persistHandle = { kind: "idle", handle };
        return;
    }

    const handle = setTimeout(() => {
        persistHandle = null;
        persistCacheEntries();
    }, 100);
    persistHandle = { kind: "timeout", handle };
}

function registerFlushListeners(): void {
    if (flushListenersRegistered) return;
    if (typeof globalThis.addEventListener !== "function") return;

    flushListenersRegistered = true;
    globalThis.addEventListener("pagehide", flushPendingPersist);
    globalThis.addEventListener("beforeunload", flushPendingPersist);
}

export function getCachedLauncherIcon(path: string): string | null {
    if (!path.trim()) return null;
    ensureCacheLoaded();

    const cached = cacheEntries.get(normalizePathKey(path));
    return normalizeBase64Value(cached?.iconBase64);
}

export function setCachedLauncherIcon(path: string, iconBase64: string): void {
    const normalizedPath = path.trim();
    const normalizedIcon = normalizeBase64Value(iconBase64);
    if (!normalizedPath || !normalizedIcon) return;

    ensureCacheLoaded();
    cacheEntries.set(normalizePathKey(normalizedPath), {
        path: normalizedPath,
        iconBase64: normalizedIcon,
        updatedAt: Date.now(),
    });
    pruneCacheEntries();
    schedulePersistCacheEntries();
}

export function setCachedLauncherIcons(entries: Array<{ path: string; iconBase64: string }>): void {
    if (!Array.isArray(entries) || entries.length === 0) return;

    ensureCacheLoaded();
    let changed = false;
    const updatedAt = Date.now();

    for (const entry of entries) {
        const normalizedPath = entry?.path?.trim() ?? "";
        const normalizedIcon = normalizeBase64Value(entry?.iconBase64);
        if (!normalizedPath || !normalizedIcon) continue;

        cacheEntries.set(normalizePathKey(normalizedPath), {
            path: normalizedPath,
            iconBase64: normalizedIcon,
            updatedAt,
        });
        changed = true;
    }

    if (!changed) return;

    pruneCacheEntries();
    clearScheduledPersist();
    persistCacheEntries();
}

export function removeCachedLauncherIcons(paths: string[]): number {
    if (!Array.isArray(paths) || paths.length === 0) return 0;
    ensureCacheLoaded();

    let removed = 0;
    for (const path of paths) {
        const key = normalizePathKey(path);
        if (cacheEntries.delete(key)) {
            removed++;
        }
    }

    if (removed > 0) {
        schedulePersistCacheEntries();
    }
    return removed;
}

export function clearLauncherIconCacheForTests(): void {
    clearScheduledPersist();
    cacheLoaded = false;
    cacheEntries = new Map();
    try {
        globalThis.localStorage?.removeItem(STORAGE_KEY);
    } catch {}
}
