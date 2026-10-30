import { computed } from "vue";
import { useLauncherStore, type RecentUsedMergedItem, type PinnedMergedItem } from "../stores/launcherStore";
import {
    normalizeExternalExecutableIdentity,
    useStatsStore,
    type ExternalRecentLaunchRecord,
} from "../stores/statsStore";
import { useUIStore } from "../stores/uiStore";
import { normalizePathKey } from "../utils/scan-fallback";
import type { ScannedMatchType } from "../types/scan-cache";

export type RecentDisplayItem = RecentUsedMergedItem & {
    featureBadgeText?: string;
};

export type ExternalRecentDisplayItem = {
    key: string;
    usedAt: number;
    external: ExternalRecentLaunchRecord;
    featureBadgeText?: string;
    matchType?: ScannedMatchType;
};

export type HomeRecentDisplayItem = RecentDisplayItem | ExternalRecentDisplayItem;

export function useHomePageState() {
    const store = useLauncherStore();
    const statsStore = useStatsStore();
    const uiStore = useUIStore();

    function toPathKey(path: string | null | undefined): string {
        if (!path) return "";
        const trimmed = path.trim();
        if (!trimmed) return "";
        return normalizePathKey(trimmed);
    }

    function toIdentityKey(path: string | null | undefined): string {
        const key = toPathKey(path);
        if (!key) return "";
        return normalizeExternalExecutableIdentity(key);
    }

    function collectAllLauncherPathKeys(): Set<string> {
        const keys = new Set<string>();
        for (const [, items] of Object.entries(store.launcherItemsByCategoryId)) {
            for (const item of items) {
                const rawPathKey = toPathKey(item.path);
                if (!rawPathKey) continue;
                keys.add(rawPathKey);
                const rawIdentityKey = toIdentityKey(item.path);
                if (rawIdentityKey) {
                    keys.add(rawIdentityKey);
                }

                const persistedResolved = toPathKey(item.resolvedPath);
                if (persistedResolved) {
                    keys.add(persistedResolved);
                    const persistedIdentity = toIdentityKey(item.resolvedPath);
                    if (persistedIdentity) {
                        keys.add(persistedIdentity);
                    }
                    continue;
                }
            }
        }
        return keys;
    }

    const recentMergedItems = computed<RecentUsedMergedItem[]>(() => {
        return store.getRecentUsedMergedItems(
            Math.max(uiStore.getHomeSectionLimit("recent") * 3, uiStore.getHomeSectionLimit("recent") + 12),
            { visible: true }
        );
    });

    const pinnedMergedItems = computed<PinnedMergedItem[]>(() => {
        return store.getPinnedMergedItems(uiStore.getHomeSectionLimit("pinned"));
    });

    const recentDisplayItems = computed<RecentDisplayItem[]>(() => {
        const recentLimit = uiStore.getHomeSectionLimit("recent");
        return recentMergedItems.value.slice(0, recentLimit);
    });

    const mergedRecentDisplayItems = computed<HomeRecentDisplayItem[]>(() => {
        const recentLimit = uiStore.getHomeSectionLimit("recent");
        if (recentLimit <= 0) return [];

        const internalItems = recentDisplayItems.value;
        const launcherPathKeys = collectAllLauncherPathKeys();
        for (const item of internalItems) {
            const internalPathKey = toPathKey(item.item.path);
            if (internalPathKey) {
                launcherPathKeys.add(internalPathKey);
            }
            const internalIdentityKey = toIdentityKey(item.item.path);
            if (internalIdentityKey) {
                launcherPathKeys.add(internalIdentityKey);
            }
        }

        const externalItems: ExternalRecentDisplayItem[] = statsStore.externalRecentLaunches
            .map((entry) => ({
                key: `external:${toPathKey(entry.path) || entry.path.replace(/\//g, "\\").toLowerCase()}`,
                usedAt: entry.usedAt,
                external: entry,
                featureBadgeText: "外部",
            }))
            .filter((entry) => !statsStore.isExternalLaunchBlocked(entry.external.path))
            .filter((entry) => {
                const externalPathKey = toPathKey(entry.external.path);
                const externalIdentityKey = toIdentityKey(entry.external.path);
                if (externalPathKey && launcherPathKeys.has(externalPathKey)) return false;
                if (externalIdentityKey && launcherPathKeys.has(externalIdentityKey)) return false;
                return true;
            });

        return [...internalItems, ...externalItems]
            .sort((a, b) => {
                const usedAtDiff = b.usedAt - a.usedAt;
                if (usedAtDiff !== 0) return usedAtDiff;
                return a.key.localeCompare(b.key);
            })
            .slice(0, recentLimit);
    });

    return {
        recentMergedItems,
        pinnedMergedItems,
        recentDisplayItems,
        mergedRecentDisplayItems,
    };
}
