import { normalizeIconBase64 } from "../../composables/useItemsHelper";
import type { RecentFileSearchResult } from "../../types/search-extensions";
import { normalizePathKey } from "./search-extension-match";

export type RecentFileRow = {
    name: string;
    path: string;
    usedAt: number;
    iconBase64: string | null;
};

export const RECENT_FILE_CACHE_KEY = "home-search-recent-file-candidates-v1";
export const RECENT_FILE_CACHE_STALE_MS = 10 * 60 * 1000;
export const RECENT_FILE_ICON_HYDRATION_LIMIT = 12;

export function normalizeRecentFileRows(rows: RecentFileRow[]): RecentFileSearchResult[] {
    return rows
        .map((row) => ({
            key: `recent-file:${normalizePathKey(row.path)}`,
            name: row.name?.trim() || row.path,
            path: row.path,
            usedAt: Number.isFinite(row.usedAt) ? row.usedAt : Date.now(),
            iconBase64: row.iconBase64 || null,
        }))
        .filter((row) => !!row.path.trim());
}

export function mergeRecentFileIcons(
    rows: RecentFileSearchResult[],
    iconByPath: Map<string, string>
): RecentFileSearchResult[] {
    return rows.map((row) => {
        const existing = normalizeIconBase64(row.iconBase64);
        if (existing) return row;
        const mergedIcon = iconByPath.get(normalizePathKey(row.path));
        if (!mergedIcon) return row;
        return {
            ...row,
            iconBase64: mergedIcon,
        };
    });
}

export function readRecentFileCandidatesCache(): RecentFileSearchResult[] {
    if (typeof window === "undefined") return [];
    try {
        const raw = window.sessionStorage.getItem(RECENT_FILE_CACHE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        const rows = parsed as RecentFileSearchResult[];
        return rows
            .filter((row) => typeof row?.path === "string")
            .map((row) => ({
                key: typeof row.key === "string" ? row.key : `recent-file:${normalizePathKey(row.path)}`,
                name: typeof row.name === "string" ? row.name : row.path,
                path: row.path,
                usedAt: Number.isFinite(row.usedAt) ? row.usedAt : Date.now(),
                iconBase64: row.iconBase64 || null,
            }));
    } catch {
        return [];
    }
}

export function writeRecentFileCandidatesCache(rows: RecentFileSearchResult[]): void {
    if (typeof window === "undefined") return;
    try {
        const compactRows = rows.map((row) => ({
            key: row.key,
            name: row.name,
            path: row.path,
            usedAt: row.usedAt,
            iconBase64: null,
        }));
        window.sessionStorage.setItem(RECENT_FILE_CACHE_KEY, JSON.stringify(compactRows));
    } catch {
        // ignore cache write failures
    }
}

export function collectVisibleRecentFileHydrationPaths(rows: RecentFileSearchResult[]): string[] {
    const missingPaths: string[] = [];
    const seen = new Set<string>();
    for (const row of rows.slice(0, RECENT_FILE_ICON_HYDRATION_LIMIT)) {
        if (normalizeIconBase64(row.iconBase64)) continue;
        const normalizedPath = normalizePathKey(row.path);
        if (!normalizedPath || seen.has(normalizedPath)) continue;
        seen.add(normalizedPath);
        missingPaths.push(row.path);
    }
    return missingPaths;
}
