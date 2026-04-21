import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { invoke } from "../utils/invoke-wrapper";
import { useCategoryStore, type Category } from "./categoryStore";
import { useUIStore } from "./uiStore";
import { useStatsStore } from "./statsStore";
import { createVersionedPersistConfig } from "../utils/versioned-persist";
import {
    getCachedLauncherIcon,
    setCachedLauncherIcon,
} from "../utils/launcher-icon-cache";
import {
    mergeRustSearchResults,
    normalizeLauncherItemKey,
} from "./launcher-search";

export type LauncherItem = {
    id: string;
    name: string;
    path: string;
    url?: string;
    itemType: 'file' | 'url';
    isDirectory: boolean;
    iconBase64: string | null;
    originalIconBase64?: string | null;
    isFavorite?: boolean;
    lastUsedAt?: number;
    launchDependencies: LaunchDependency[];
    launchDelaySeconds: number;
};

export type LaunchDependency = {
    categoryId: string;
    itemId: string;
    delayAfterSeconds: number;
};

export type GlobalSearchResult = {
    item: LauncherItem;
    categoryId: string;
    categoryName: string;
};

export type GlobalSearchMergedResult = {
    key: string;
    item: LauncherItem;
    primaryCategoryId: string;
    categories: Category[];
};

export type RecentUsedItem = {
    categoryId: string;
    itemId: string;
    usedAt: number;
    usageCount: number;
};

export type RecentUsedMergedItem = {
    key: string;
    usedAt: number;
    recent: RecentUsedItem;
    item: LauncherItem;
    categories: Category[];
};

export type PinnedMergedItem = {
    key: string;
    item: LauncherItem;
    primaryCategoryId: string;
    categories: Category[];
};

export type LauncherItemRef = {
    categoryId: string;
    itemId: string;
};

export type RustSearchResult = {
    id: string;
    name: string;
    path: string;
    category_id: string;
    fuzzy_score: number;
    matched_pinyin_initial: boolean;
    matched_pinyin_full: boolean;
    rank_score: number;
};

type SearchIndexItemPayload = {
    id: string;
    name: string;
    path: string;
    category_id: string;
    usage_count: number;
    last_used_at: number;
    is_pinned: boolean;
    search_tokens: string[];
    rank_score: number;
};

type SearchIndexDeletedPayload = {
    id: string;
    category_id: string;
};

type SearchIndexChangesPayload = {
    added: SearchIndexItemPayload[];
    updated: SearchIndexItemPayload[];
    deleted: SearchIndexDeletedPayload[];
};

type IconHydrationOptions = {
    forceReplace?: boolean;
    skipCache?: boolean;
};

type ImportLauncherItemsOptions = {
    refreshDerivedIcons?: boolean;
};

export const useLauncherStore = defineStore(
    "launcher",
    () => {
        const searchKeyword = ref<string>("");
        const pinnedItemIds = ref<string[]>([]);
        const recentUsedItems = ref<RecentUsedItem[]>([]);
        const launcherItemsByCategoryId = ref<Record<string, LauncherItem[]>>({});

        const rustSearchResults = ref<RustSearchResult[]>([]);
        const isRustSearchReady = ref(false);
        const iconHydrationInFlight = new Set<string>();
        const pendingSearchAdded = new Map<string, SearchIndexItemPayload>();
        const pendingSearchUpdated = new Map<string, SearchIndexItemPayload>();
        const pendingSearchDeleted = new Map<string, SearchIndexDeletedPayload>();
        let searchIndexFlushTimer: ReturnType<typeof setTimeout> | null = null;
        let searchIndexSyncInFlight: Promise<void> | null = null;
        let isFullSearchIndexSyncInFlight = false;

        function createLauncherItemId() {
            return `item-${crypto.randomUUID()}`;
        }

        function normalizeDelaySeconds(value: number | undefined): number {
            if (!Number.isFinite(value)) return 0;
            return Math.max(0, Math.floor(value ?? 0));
        }

        function normalizeLaunchDependencies(
            dependencies: LaunchDependency[] | undefined,
            currentRef?: { categoryId: string; itemId: string }
        ): LaunchDependency[] {
            if (!Array.isArray(dependencies)) return [];

            const seen = new Set<string>();
            const normalized: LaunchDependency[] = [];

            for (const dependency of dependencies) {
                if (!dependency?.categoryId || !dependency?.itemId) continue;
                if (
                    currentRef &&
                    dependency.categoryId === currentRef.categoryId &&
                    dependency.itemId === currentRef.itemId
                ) {
                    continue;
                }

                const key = `${dependency.categoryId}:${dependency.itemId}`;
                if (seen.has(key)) continue;
                seen.add(key);

                normalized.push({
                    categoryId: dependency.categoryId,
                    itemId: dependency.itemId,
                    delayAfterSeconds: normalizeDelaySeconds(dependency.delayAfterSeconds),
                });
            }

            return normalized;
        }

        function getNameFromPath(path: string) {
            const normalized = path.replace(/\\/g, "/");
            const segments = normalized.split("/").filter(Boolean);
            const base = segments[segments.length - 1] || path;
            const lower = base.toLowerCase();
            if (lower.endsWith(".lnk")) return base.slice(0, -4);
            if (lower.endsWith(".exe")) return base.slice(0, -4);
            return base;
        }

        function getLauncherItemsByCategoryId(categoryId: string) {
            return launcherItemsByCategoryId.value[categoryId] || [];
        }

        function setLauncherItemsByCategoryId(categoryId: string, items: LauncherItem[]) {
            launcherItemsByCategoryId.value = {
                ...launcherItemsByCategoryId.value,
                [categoryId]: items,
            };
        }

        function getLauncherItemById(categoryId: string, itemId: string) {
            return getLauncherItemsByCategoryId(categoryId).find((x) => x.id === itemId) || null;
        }

        function normalizeIconBase64(value: string | null | undefined): string | null {
            if (typeof value !== "string") return null;
            const trimmed = value.trim();
            return trimmed.length > 0 ? trimmed : null;
        }

        function cacheOriginalIconForFileItem(
            itemType: LauncherItem["itemType"],
            path: string,
            iconBase64: string | null | undefined
        ): void {
            if (itemType !== "file") return;
            const normalizedPath = typeof path === "string" ? path.trim() : "";
            const normalizedIcon = normalizeIconBase64(iconBase64);
            if (!normalizedPath || !normalizedIcon) return;
            setCachedLauncherIcon(normalizedPath, normalizedIcon);
        }

        function getCachedOriginalIconForPath(path: string): string | null {
            const normalizedPath = typeof path === "string" ? path.trim() : "";
            if (!normalizedPath) return null;
            return normalizeIconBase64(getCachedLauncherIcon(normalizedPath));
        }

        function applyCachedOriginalIcon(item: LauncherItem): LauncherItem {
            if (item.itemType !== "file") return item;

            const currentIcon = normalizeIconBase64(item.iconBase64);
            const originalIcon = normalizeIconBase64(item.originalIconBase64);
            if (currentIcon || originalIcon) return item;

            const cachedIcon = getCachedOriginalIconForPath(item.path);
            if (!cachedIcon) return item;

            return {
                ...item,
                iconBase64: cachedIcon,
                originalIconBase64: cachedIcon,
            };
        }

        function shouldRefreshDerivedIcon(item: LauncherItem): boolean {
            if (item.itemType !== "file") return false;

            const normalizedPath = typeof item.path === "string" ? item.path.trim() : "";
            if (!normalizedPath) return false;

            const currentIcon = normalizeIconBase64(item.iconBase64);
            const originalIcon = normalizeIconBase64(item.originalIconBase64);
            return currentIcon === originalIcon;
        }

        function getSearchEntryKey(categoryId: string, itemId: string): string {
            return `${categoryId}:${itemId}`;
        }

        function collectSearchRankingSignals() {
            const usageMap = new Map<string, number>();
            const lastUsedMap = new Map<string, number>();

            for (const recent of recentUsedItems.value) {
                const key = getSearchEntryKey(recent.categoryId, recent.itemId);
                usageMap.set(key, (usageMap.get(key) ?? 0) + recent.usageCount);
                if (!lastUsedMap.has(key) || (lastUsedMap.get(key) ?? 0) < recent.usedAt) {
                    lastUsedMap.set(key, recent.usedAt);
                }
            }

            return {
                usageMap,
                lastUsedMap,
                pinnedSet: new Set(pinnedItemIds.value),
            };
        }

        function toSearchIndexItem(
            categoryId: string,
            item: LauncherItem,
            rankingSignals?: ReturnType<typeof collectSearchRankingSignals>
        ): SearchIndexItemPayload {
            const signals = rankingSignals ?? collectSearchRankingSignals();
            const key = getSearchEntryKey(categoryId, item.id);

            return {
                id: item.id,
                name: item.name,
                path: item.path,
                category_id: categoryId,
                usage_count: signals.usageMap.get(key) ?? 0,
                last_used_at: signals.lastUsedMap.get(key) ?? 0,
                is_pinned: signals.pinnedSet.has(item.id),
                search_tokens: [],
                rank_score: 0,
            };
        }

        function hasPendingSearchChanges(): boolean {
            return (
                pendingSearchAdded.size > 0 ||
                pendingSearchUpdated.size > 0 ||
                pendingSearchDeleted.size > 0
            );
        }

        function clearPendingSearchChanges(): void {
            pendingSearchAdded.clear();
            pendingSearchUpdated.clear();
            pendingSearchDeleted.clear();
        }

        function cancelPendingSearchFlush(): void {
            if (!searchIndexFlushTimer) return;
            clearTimeout(searchIndexFlushTimer);
            searchIndexFlushTimer = null;
        }

        function takePendingSearchChanges(): SearchIndexChangesPayload {
            const changes: SearchIndexChangesPayload = {
                added: [...pendingSearchAdded.values()],
                updated: [...pendingSearchUpdated.values()],
                deleted: [...pendingSearchDeleted.values()],
            };
            clearPendingSearchChanges();
            return changes;
        }

        function scheduleSearchIncrementalFlush(delayMs: number = 250): void {
            if (!isRustSearchReady.value) return;
            if (searchIndexFlushTimer) return;
            searchIndexFlushTimer = setTimeout(() => {
                searchIndexFlushTimer = null;
                void flushPendingSearchChanges();
            }, delayMs);
        }

        function enqueueSearchChanges(changes: Partial<SearchIndexChangesPayload>): void {
            if (!isRustSearchReady.value) return;

            for (const deleted of changes.deleted ?? []) {
                const key = getSearchEntryKey(deleted.category_id, deleted.id);
                pendingSearchAdded.delete(key);
                pendingSearchUpdated.delete(key);
                pendingSearchDeleted.set(key, deleted);
            }

            for (const added of changes.added ?? []) {
                const key = getSearchEntryKey(added.category_id, added.id);
                pendingSearchDeleted.delete(key);
                pendingSearchUpdated.delete(key);
                pendingSearchAdded.set(key, added);
            }

            for (const updated of changes.updated ?? []) {
                const key = getSearchEntryKey(updated.category_id, updated.id);
                pendingSearchDeleted.delete(key);
                if (pendingSearchAdded.has(key)) {
                    pendingSearchAdded.set(key, updated);
                } else {
                    pendingSearchUpdated.set(key, updated);
                }
            }

            scheduleSearchIncrementalFlush();
        }

        function enqueueSearchUpdateByRef(categoryId: string, itemId: string): void {
            if (!isRustSearchReady.value) return;
            const item = getLauncherItemById(categoryId, itemId);
            if (!item) return;
            enqueueSearchChanges({
                updated: [toSearchIndexItem(categoryId, item)],
            });
        }

        function enqueueSearchUpdateByItemId(itemId: string): void {
            if (!isRustSearchReady.value) return;
            const categoryStore = useCategoryStore();
            const rankingSignals = collectSearchRankingSignals();
            const updated: SearchIndexItemPayload[] = [];
            for (const category of categoryStore.categories) {
                const matched = getLauncherItemsByCategoryId(category.id).filter(
                    (item) => item.id === itemId
                );
                for (const item of matched) {
                    updated.push(toSearchIndexItem(category.id, item, rankingSignals));
                }
            }

            if (updated.length === 0) return;
            enqueueSearchChanges({ updated });
        }

        function enqueueSearchRefreshForAllItems(): void {
            if (!isRustSearchReady.value) return;
            const categoryStore = useCategoryStore();
            const rankingSignals = collectSearchRankingSignals();
            const updated: SearchIndexItemPayload[] = [];

            for (const category of categoryStore.categories) {
                const items = getLauncherItemsByCategoryId(category.id);
                for (const item of items) {
                    updated.push(toSearchIndexItem(category.id, item, rankingSignals));
                }
            }

            if (updated.length === 0) return;
            enqueueSearchChanges({ updated });
        }

        async function syncSearchIndexInternal(waitIncrementalInFlight: boolean): Promise<void> {
            if (isFullSearchIndexSyncInFlight) return;
            if (waitIncrementalInFlight && searchIndexSyncInFlight) {
                await searchIndexSyncInFlight;
            }

            cancelPendingSearchFlush();
            clearPendingSearchChanges();
            isFullSearchIndexSyncInFlight = true;

            try {
                const categoryStore = useCategoryStore();
                const rankingSignals = collectSearchRankingSignals();
                const items: SearchIndexItemPayload[] = [];

                for (const category of categoryStore.categories) {
                    const catItems = getLauncherItemsByCategoryId(category.id);
                    for (const item of catItems) {
                        items.push(toSearchIndexItem(category.id, item, rankingSignals));
                    }
                }

                const result = await invoke("update_search_items", { items });
                if (!result.ok) {
                    console.error("Failed to sync search index:", result.error);
                    isRustSearchReady.value = false;
                    return;
                }

                isRustSearchReady.value = true;
            } catch (e) {
                console.error("Failed to sync search index:", e);
                isRustSearchReady.value = false;
            } finally {
                isFullSearchIndexSyncInFlight = false;
                if (isRustSearchReady.value && hasPendingSearchChanges()) {
                    scheduleSearchIncrementalFlush(0);
                }
            }
        }

        async function flushPendingSearchChanges(): Promise<void> {
            if (!isRustSearchReady.value) {
                clearPendingSearchChanges();
                return;
            }
            if (isFullSearchIndexSyncInFlight || searchIndexSyncInFlight) {
                return;
            }

            const changes = takePendingSearchChanges();
            if (
                changes.added.length === 0 &&
                changes.updated.length === 0 &&
                changes.deleted.length === 0
            ) {
                return;
            }

            searchIndexSyncInFlight = (async () => {
                const result = await invoke("update_search_items_incremental", { changes });
                if (!result.ok) {
                    console.error("Failed to incrementally sync search index:", result.error);
                    await syncSearchIndexInternal(false);
                }
            })()
                .catch((e) => {
                    console.error("Failed to incrementally sync search index:", e);
                })
                .finally(() => {
                    searchIndexSyncInFlight = null;
                    if (hasPendingSearchChanges()) {
                        scheduleSearchIncrementalFlush(0);
                    }
                });

            await searchIndexSyncInFlight;
        }

        function buildLauncherItemIndexes(categories: Category[]) {
            const itemById = new Map<string, { item: LauncherItem; categoryId: string }>();
            const itemByCompositeKey = new Map<string, LauncherItem>();

            for (const category of categories) {
                const items = getLauncherItemsByCategoryId(category.id);
                for (const item of items) {
                    if (!itemById.has(item.id)) {
                        itemById.set(item.id, { item, categoryId: category.id });
                    }
                    itemByCompositeKey.set(`${category.id}:${item.id}`, item);
                }
            }

            return {
                itemById,
                itemByCompositeKey,
            };
        }

        function updateLauncherItem(
            categoryId: string,
            itemId: string,
            patch: Partial<Pick<LauncherItem, "name" | "url" | "path" | "launchDependencies" | "launchDelaySeconds">>
        ) {
            const list = getLauncherItemsByCategoryId(categoryId);
            const index = list.findIndex((x) => x.id === itemId);
            if (index === -1) return;
            const next = [...list];
            next[index] = {
                ...next[index],
                ...patch,
                launchDependencies:
                    patch.launchDependencies !== undefined
                        ? normalizeLaunchDependencies(patch.launchDependencies, { categoryId, itemId })
                        : next[index].launchDependencies,
                launchDelaySeconds:
                    patch.launchDelaySeconds !== undefined
                        ? normalizeDelaySeconds(patch.launchDelaySeconds)
                        : next[index].launchDelaySeconds,
            };
            setLauncherItemsByCategoryId(categoryId, next);
            enqueueSearchChanges({
                updated: [toSearchIndexItem(categoryId, next[index])],
            });
        }

        function removeDependenciesMatching(
            predicate: (dependency: LaunchDependency) => boolean
        ) {
            const nextByCategoryId: Record<string, LauncherItem[]> = {};

            for (const [categoryId, items] of Object.entries(launcherItemsByCategoryId.value)) {
                nextByCategoryId[categoryId] = items.map((item) => {
                    const nextDependencies = item.launchDependencies.filter(
                        (dependency) => !predicate(dependency)
                    );

                    if (nextDependencies.length === item.launchDependencies.length) {
                        return item;
                    }

                    return {
                        ...item,
                        launchDependencies: nextDependencies,
                    };
                });
            }

            launcherItemsByCategoryId.value = nextByCategoryId;
        }

        function deleteLauncherItem(categoryId: string, itemId: string) {
            const list = getLauncherItemsByCategoryId(categoryId);
            const index = list.findIndex((x) => x.id === itemId);
            if (index === -1) return;
            const next = [...list];
            next.splice(index, 1);
            setLauncherItemsByCategoryId(categoryId, next);
            pinnedItemIds.value = pinnedItemIds.value.filter((id) => id !== itemId);
            recentUsedItems.value = recentUsedItems.value.filter(
                (x) => !(x.categoryId === categoryId && x.itemId === itemId)
            );
            removeDependenciesMatching(
                (dependency) =>
                    dependency.categoryId === categoryId && dependency.itemId === itemId
            );
            enqueueSearchChanges({
                deleted: [{ category_id: categoryId, id: itemId }],
            });
        }

        function addLauncherItemsToCategory(
            categoryId: string,
            payload: {
                paths: string[];
                directories: string[];
                icon_base64s: Array<string | null>;
                itemTypes?: Array<'file' | 'url'>;
            }
        ) {
            const existing = getLauncherItemsByCategoryId(categoryId);
            const directorySet = new Set(payload.directories);

            const nextItems: LauncherItem[] = payload.paths.map((path, index) => {
                const iconBase64 = normalizeIconBase64(
                    payload.icon_base64s[index] !== undefined
                        ? payload.icon_base64s[index]
                        : null
                );
                const itemType = payload.itemTypes?.[index] ?? 'file';
                cacheOriginalIconForFileItem(itemType, path, iconBase64);
                return {
                    id: createLauncherItemId(),
                    name: getNameFromPath(path),
                    path: itemType === 'url' ? '' : path,
                    url: itemType === 'url' ? path : undefined,
                    itemType,
                    isDirectory: directorySet.has(path),
                    iconBase64,
                    originalIconBase64: iconBase64,
                    launchDependencies: [],
                    launchDelaySeconds: 0,
                };
            });

            setLauncherItemsByCategoryId(categoryId, [...existing, ...nextItems]);
            const rankingSignals = collectSearchRankingSignals();
            enqueueSearchChanges({
                added: nextItems.map((item) => toSearchIndexItem(categoryId, item, rankingSignals)),
            });
        }

        async function addLauncherItemsToCategoryBatched(
            categoryId: string,
            payload: {
                paths: string[];
                directories: string[];
                icon_base64s: Array<string | null>;
                itemTypes?: Array<'file' | 'url'>;
            },
            batchSize: number = 20
        ): Promise<string[]> {
            const { paths, directories, icon_base64s, itemTypes } = payload;
            const directorySet = new Set(directories);
            const allIds: string[] = [];
            const totalBatches = Math.ceil(paths.length / batchSize);

            for (let batch = 0; batch < totalBatches; batch++) {
                const start = batch * batchSize;
                const end = Math.min(start + batchSize, paths.length);

                const existing = getLauncherItemsByCategoryId(categoryId);
                const batchItems: LauncherItem[] = [];

                for (let i = start; i < end; i++) {
                    const iconBase64 = normalizeIconBase64(icon_base64s[i] ?? null);
                    const itemType = itemTypes?.[i] ?? 'file';
                    cacheOriginalIconForFileItem(itemType, paths[i], iconBase64);
                    const id = createLauncherItemId();
                    allIds.push(id);
                    batchItems.push({
                        id,
                        name: getNameFromPath(paths[i]),
                        path: itemType === 'url' ? '' : paths[i],
                        url: itemType === 'url' ? paths[i] : undefined,
                        itemType,
                        isDirectory: directorySet.has(paths[i]),
                        iconBase64,
                        originalIconBase64: iconBase64,
                        launchDependencies: [],
                        launchDelaySeconds: 0,
                    });
                }

                setLauncherItemsByCategoryId(categoryId, [...existing, ...batchItems]);
                const rankingSignals = collectSearchRankingSignals();
                enqueueSearchChanges({
                    added: batchItems.map((item) => toSearchIndexItem(categoryId, item, rankingSignals)),
                });

                if (batch < totalBatches - 1) {
                    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
                }
            }

            return allIds;
        }

        function applyDropIcons(categoryId: string, paths: string[], iconBase64s: Array<string | null>) {
            const list = getLauncherItemsByCategoryId(categoryId);
            const pathToIcon = new Map<string, string>();
            for (let i = 0; i < paths.length; i++) {
                const icon = normalizeIconBase64(iconBase64s[i]);
                if (!icon) continue;
                pathToIcon.set(paths[i], icon);
                setCachedLauncherIcon(paths[i], icon);
            }

            if (pathToIcon.size === 0) return;

            let changed = false;
            const updatedItems: LauncherItem[] = [];
            const next = list.map(item => {
                const icon = pathToIcon.get(item.path);
                if (icon === undefined) return item;
                changed = true;
                const updated = { ...item, iconBase64: icon, originalIconBase64: icon };
                updatedItems.push(updated);
                return updated;
            });

            if (changed) {
                setLauncherItemsByCategoryId(categoryId, next);
                enqueueSearchChanges({
                    updated: updatedItems.map((item) => toSearchIndexItem(categoryId, item)),
                });
            }
        }

        function addUrlLauncherItemToCategory(
            categoryId: string,
            payload: {
                name: string;
                url: string;
                icon_base64?: string | null;
            }
        ): string {
            const existing = getLauncherItemsByCategoryId(categoryId);
            const iconBase64 = normalizeIconBase64(payload.icon_base64 ?? null);
            const newItem: LauncherItem = {
                id: createLauncherItemId(),
                name: payload.name,
                path: '',
                url: payload.url,
                itemType: 'url',
                isDirectory: false,
                iconBase64,
                originalIconBase64: iconBase64,
                launchDependencies: [],
                launchDelaySeconds: 0,
            };
            setLauncherItemsByCategoryId(categoryId, [...existing, newItem]);
            enqueueSearchChanges({
                added: [toSearchIndexItem(categoryId, newItem)],
            });
            return newItem.id;
        }

        function updateLauncherItemIcon(categoryId: string, itemId: string, iconBase64: string) {
            const list = getLauncherItemsByCategoryId(categoryId);
            const index = list.findIndex((x) => x.id === itemId);
            if (index === -1) return;
            const normalizedIcon = normalizeIconBase64(iconBase64);
            const next = [...list];
            next[index] = {
                ...next[index],
                iconBase64: normalizedIcon,
                originalIconBase64: normalizedIcon,
            };
            setLauncherItemsByCategoryId(categoryId, next);
        }

        function deleteCategoryCleanup(categoryId: string) {
            const next = { ...launcherItemsByCategoryId.value };
            const removedItems = next[categoryId] || [];
            const removedItemIds = removedItems.map((x) => x.id);
            delete next[categoryId];
            launcherItemsByCategoryId.value = next;
            if (removedItemIds.length) {
                const removedSet = new Set(removedItemIds);
                pinnedItemIds.value = pinnedItemIds.value.filter(
                    (id) => !removedSet.has(id)
                );
            }
            recentUsedItems.value = recentUsedItems.value.filter(
                (x) => x.categoryId !== categoryId
            );
            removeDependenciesMatching(
                (dependency) => dependency.categoryId === categoryId
            );
            if (removedItems.length > 0) {
                enqueueSearchChanges({
                    deleted: removedItems.map((item) => ({
                        category_id: categoryId,
                        id: item.id,
                    })),
                });
            }
        }

        function setLauncherItemIcon(categoryId: string, itemId: string, iconBase64: string) {
            const list = getLauncherItemsByCategoryId(categoryId);
            const index = list.findIndex((x) => x.id === itemId);
            if (index === -1) return;
            const normalizedIcon = normalizeIconBase64(iconBase64);
            const next = [...list];
            next[index] = { ...next[index], iconBase64: normalizedIcon };
            setLauncherItemsByCategoryId(categoryId, next);
        }

        function resetLauncherItemIcon(categoryId: string, itemId: string) {
            const list = getLauncherItemsByCategoryId(categoryId);
            const index = list.findIndex((x) => x.id === itemId);
            if (index === -1) return;
            const next = [...list];
            next[index] = { 
                ...next[index], 
                iconBase64: normalizeIconBase64(next[index].originalIconBase64 ?? null),
            };
            setLauncherItemsByCategoryId(categoryId, next);
        }

        function hasCustomIcon(categoryId: string, itemId: string): boolean {
            const item = getLauncherItemById(categoryId, itemId);
            if (!item) return false;
            return normalizeIconBase64(item.iconBase64) !== normalizeIconBase64(item.originalIconBase64);
        }

        async function hydrateMissingIconsForItems(
            targets: LauncherItemRef[],
            options: IconHydrationOptions = {}
        ): Promise<void> {
            if (!Array.isArray(targets) || targets.length === 0) return;
            const forceReplace = options.forceReplace === true;
            const skipCache = options.skipCache === true;

            const uniqueTargets: Array<{
                key: string;
                categoryId: string;
                itemId: string;
                path: string;
            }> = [];
            const seenTargetKeys = new Set<string>();

            for (const target of targets) {
                if (!target?.categoryId || !target?.itemId) continue;

                const targetKey = `${target.categoryId}:${target.itemId}`;
                if (seenTargetKeys.has(targetKey)) continue;
                seenTargetKeys.add(targetKey);

                if (iconHydrationInFlight.has(targetKey)) continue;

                const item = getLauncherItemById(target.categoryId, target.itemId);
                if (!item || item.itemType !== "file") continue;

                const currentIcon = normalizeIconBase64(item.iconBase64);
                const originalIcon = normalizeIconBase64(item.originalIconBase64);
                if (!forceReplace) {
                    if (currentIcon) continue;
                    if (originalIcon && originalIcon !== currentIcon) continue;
                } else if (currentIcon && originalIcon && currentIcon !== originalIcon) {
                    continue;
                }

                const path = typeof item.path === "string" ? item.path.trim() : "";
                if (!path) continue;

                if (!skipCache) {
                    const cachedIcon = getCachedOriginalIconForPath(path);
                    if (cachedIcon) {
                        const list = getLauncherItemsByCategoryId(target.categoryId);
                        const index = list.findIndex((x) => x.id === target.itemId);
                        if (index !== -1) {
                            const next = [...list];
                            next[index] = {
                                ...next[index],
                                iconBase64: cachedIcon,
                                originalIconBase64: cachedIcon,
                            };
                            setLauncherItemsByCategoryId(target.categoryId, next);
                        }
                        continue;
                    }
                }

                uniqueTargets.push({
                    key: targetKey,
                    categoryId: target.categoryId,
                    itemId: target.itemId,
                    path,
                });
            }

            if (uniqueTargets.length === 0) return;

            const uniquePaths: string[] = [];
            const seenPaths = new Set<string>();
            for (const target of uniqueTargets) {
                if (seenPaths.has(target.path)) continue;
                seenPaths.add(target.path);
                uniquePaths.push(target.path);
            }

            if (uniquePaths.length === 0) return;

            for (const target of uniqueTargets) {
                iconHydrationInFlight.add(target.key);
            }

            try {
                const result = await invoke<Array<string | null>>("extract_icons_from_paths", {
                    paths: uniquePaths,
                });

                if (!result.ok) {
                    console.error("Failed to hydrate launcher icons:", result.error);
                    return;
                }

                const iconByPath = new Map<string, string>();
                for (let i = 0; i < uniquePaths.length; i++) {
                    const normalizedIcon = normalizeIconBase64(result.value[i]);
                    if (!normalizedIcon) continue;
                    iconByPath.set(uniquePaths[i], normalizedIcon);
                    setCachedLauncherIcon(uniquePaths[i], normalizedIcon);
                }

                if (iconByPath.size === 0) return;

                const updatesByCategory = new Map<string, Map<string, string>>();
                for (const target of uniqueTargets) {
                    const icon = iconByPath.get(target.path);
                    if (!icon) continue;
                    if (!updatesByCategory.has(target.categoryId)) {
                        updatesByCategory.set(target.categoryId, new Map<string, string>());
                    }
                    updatesByCategory.get(target.categoryId)!.set(target.itemId, icon);
                }

                for (const [categoryId, categoryUpdates] of updatesByCategory) {
                    const list = getLauncherItemsByCategoryId(categoryId);
                    let changed = false;
                    const next = list.map((item) => {
                        const hydratedIcon = categoryUpdates.get(item.id);
                        if (!hydratedIcon) return item;
                        const currentIcon = normalizeIconBase64(item.iconBase64);
                        const originalIcon = normalizeIconBase64(item.originalIconBase64);
                        if (!forceReplace && currentIcon) return item;
                        if (forceReplace && currentIcon && originalIcon && currentIcon !== originalIcon) {
                            return item;
                        }
                        changed = true;
                        return {
                            ...item,
                            iconBase64: hydratedIcon,
                            originalIconBase64: hydratedIcon,
                        };
                    });
                    if (changed) {
                        setLauncherItemsByCategoryId(categoryId, next);
                    }
                }
            } catch (e) {
                console.error("Failed to hydrate launcher icons:", e);
            } finally {
                for (const target of uniqueTargets) {
                    iconHydrationInFlight.delete(target.key);
                }
            }
        }

        async function syncSearchIndex() {
            await syncSearchIndexInternal(true);
        }

        async function rustSearch(keyword: string, limit: number = 20): Promise<void> {
            if (!keyword.trim()) {
                rustSearchResults.value = [];
                return;
            }
            try {
                const result = await invoke<RustSearchResult[]>("search_apps", {
                    query: { keyword, limit },
                });
                if (!result.ok) {
                    console.error("Rust search failed:", result.error);
                    rustSearchResults.value = [];
                    return;
                }
                rustSearchResults.value = result.value;
            } catch (e) {
                console.error("Rust search failed:", e);
                rustSearchResults.value = [];
            }
        }

        const rustSearchMergedResults = computed<GlobalSearchMergedResult[]>(() => {
            const categoryStore = useCategoryStore();
            return mergeRustSearchResults(
                rustSearchResults.value,
                (categoryId) => categoryStore.getCategoryById(categoryId),
                getLauncherItemById
            );
        });

        function clearSearch() {
            searchKeyword.value = "";
        }

        function getLauncherItemMergeKey(item: LauncherItem): string | null {
            return normalizeLauncherItemKey(item);
        }

        function togglePinned(categoryId: string, itemId: string) {
            const item = getLauncherItemById(categoryId, itemId);
            if (!item) return;
            const isPinned = pinnedItemIds.value.includes(itemId);
            if (isPinned) {
                pinnedItemIds.value = pinnedItemIds.value.filter((id) => id !== itemId);
            } else {
                pinnedItemIds.value = [...pinnedItemIds.value, itemId];
            }
            enqueueSearchUpdateByItemId(itemId);
        }

        function isItemPinned(itemId: string): boolean {
            return pinnedItemIds.value.includes(itemId);
        }

        function recordItemUsage(categoryId: string, itemId: string) {
            const now = Date.now();
            const existingIndex = recentUsedItems.value.findIndex(
                r => r.categoryId === categoryId && r.itemId === itemId
            );
            
            if (existingIndex !== -1) {
                const existing = recentUsedItems.value[existingIndex];
                const newList = recentUsedItems.value.filter((_, i) => i !== existingIndex);
                newList.unshift({
                    categoryId,
                    itemId,
                    usedAt: now,
                    usageCount: existing.usageCount + 1,
                });
                recentUsedItems.value = newList;
            } else {
                recentUsedItems.value = [
                    { categoryId, itemId, usedAt: now, usageCount: 1 },
                    ...recentUsedItems.value,
                ];
            }
            
            if (recentUsedItems.value.length > 50) {
                recentUsedItems.value = recentUsedItems.value.slice(0, 50);
            }

            enqueueSearchUpdateByRef(categoryId, itemId);
        }

        function clearRecentUsed() {
            recentUsedItems.value = [];
            enqueueSearchRefreshForAllItems();
        }

        function importLauncherItems(
            items: Record<string, LauncherItem[]>,
            options: ImportLauncherItemsOptions = {}
        ) {
            const nextItems: Record<string, LauncherItem[]> = {};
            const refreshTargets: LauncherItemRef[] = [];
            for (const [categoryId, categoryItems] of Object.entries(items)) {
                nextItems[categoryId] = categoryItems.map((item) => {
                    const nextItem = applyCachedOriginalIcon(item);
                    if (options.refreshDerivedIcons && shouldRefreshDerivedIcon(nextItem)) {
                        refreshTargets.push({
                            categoryId,
                            itemId: nextItem.id,
                        });
                    }
                    return nextItem;
                });
            }
            launcherItemsByCategoryId.value = nextItems;
            if (options.refreshDerivedIcons && refreshTargets.length > 0) {
                void hydrateMissingIconsForItems(refreshTargets, {
                    forceReplace: true,
                    skipCache: true,
                });
            }
            if (isRustSearchReady.value) {
                void syncSearchIndexInternal(true);
            }
        }

        function importPinnedItemIds(newIds: string[]) {
            pinnedItemIds.value = [...new Set(newIds)];
            enqueueSearchRefreshForAllItems();
        }

        function reorderPinnedItemIds(newOrder: string[]) {
            const pinnedSet = new Set(pinnedItemIds.value);
            const newOrderSet = new Set(newOrder);
            const validIds = newOrder.filter(id => pinnedSet.has(id));
            const otherIds = pinnedItemIds.value.filter(id => !newOrderSet.has(id));
            pinnedItemIds.value = [...validIds, ...otherIds];
        }

        function importRecentUsedItems(newItems: RecentUsedItem[]) {
            recentUsedItems.value = newItems;
            enqueueSearchRefreshForAllItems();
        }

        function getRecentUsedItems(limit: number = 5): RecentUsedItem[] {
            return recentUsedItems.value.slice(0, limit);
        }

        function getRecentUsedItemInfo(recentItem: RecentUsedItem): { item: LauncherItem | null; category: Category | null } {
            const categoryStore = useCategoryStore();
            const category = categoryStore.getCategoryById(recentItem.categoryId);
            const item = getLauncherItemById(recentItem.categoryId, recentItem.itemId);
            return { item, category };
        }

        function getRecentUsedMergedItems(limit: number = 5, excludePinned?: { visible: boolean }): RecentUsedMergedItem[] {
            const categoryStore = useCategoryStore();
            const uiStore = useUIStore();
            const categories = categoryStore.categories;
            const categoryById = new Map(categories.map((category) => [category.id, category] as const));
            const { itemById, itemByCompositeKey } = buildLauncherItemIndexes(categories);

            const pinnedKeys = new Set<string>();
            if (excludePinned?.visible) {
                const visibleLimit = uiStore.getHomeSectionLimit("pinned");
                for (const itemId of pinnedItemIds.value.slice(0, visibleLimit)) {
                    const entry = itemById.get(itemId);
                    if (!entry) continue;
                    const key = getLauncherItemMergeKey(entry.item);
                    if (key) pinnedKeys.add(key);
                }
            }

            const mergedByKey = new Map<
                string,
                {
                    key: string;
                    usedAt: number;
                    recent: RecentUsedItem;
                    item: LauncherItem;
                    categoryIds: Set<string>;
                }
            >();

            for (const recent of recentUsedItems.value) {
                const item = itemByCompositeKey.get(`${recent.categoryId}:${recent.itemId}`);
                if (!item) continue;

                const key = getLauncherItemMergeKey(item);
                if (!key) continue;
                if (pinnedKeys.has(key)) continue;

                const existing = mergedByKey.get(key);
                if (!existing) {
                    mergedByKey.set(key, {
                        key,
                        usedAt: recent.usedAt,
                        recent,
                        item,
                        categoryIds: new Set([recent.categoryId]),
                    });
                } else {
                    existing.categoryIds.add(recent.categoryId);
                }
            }

            const mergedItems: RecentUsedMergedItem[] = [];
            for (const entry of mergedByKey.values()) {
                const mergedCategories: Category[] = [];
                for (const categoryId of entry.categoryIds) {
                    const category = categoryById.get(categoryId);
                    if (category) {
                        mergedCategories.push(category);
                    }
                }

                mergedItems.push({
                    key: entry.key,
                    usedAt: entry.usedAt,
                    recent: entry.recent,
                    item: entry.item,
                    categories: mergedCategories,
                });

                if (mergedItems.length >= limit) {
                    break;
                }
            }

            return mergedItems;
        }

        function getPinnedMergedItems(limit: number = 10): PinnedMergedItem[] {
            const categoryStore = useCategoryStore();
            const categories = categoryStore.categories;
            const categoryById = new Map(categories.map((category) => [category.id, category] as const));
            const { itemById } = buildLauncherItemIndexes(categories);
            const pinnedSet = new Set(pinnedItemIds.value);

            const mergedByKey = new Map<
                string,
                {
                    key: string;
                    item: LauncherItem;
                    primaryCategoryId: string;
                    categoryIds: Set<string>;
                }
            >();

            for (const category of categories) {
                const items = getLauncherItemsByCategoryId(category.id);
                for (const item of items) {
                    if (!pinnedSet.has(item.id)) continue;
                    const key = getLauncherItemMergeKey(item);
                    if (!key) continue;

                    const existing = mergedByKey.get(key);
                    if (!existing) {
                        mergedByKey.set(key, {
                            key,
                            item,
                            primaryCategoryId: category.id,
                            categoryIds: new Set([category.id]),
                        });
                    } else {
                        existing.categoryIds.add(category.id);
                    }
                }
            }

            const validPinnedIds: string[] = [];
            const emittedKeys = new Set<string>();
            const mergedItems: PinnedMergedItem[] = [];

            for (const itemId of pinnedItemIds.value) {
                const entry = itemById.get(itemId);
                if (!entry) {
                    continue;
                }

                validPinnedIds.push(itemId);
                const key = getLauncherItemMergeKey(entry.item);
                if (!key || emittedKeys.has(key)) {
                    continue;
                }

                const merged = mergedByKey.get(key);
                if (!merged) {
                    continue;
                }

                const mergedCategories: Category[] = [];
                for (const categoryId of merged.categoryIds) {
                    const category = categoryById.get(categoryId);
                    if (category) {
                        mergedCategories.push(category);
                    }
                }

                mergedItems.push({
                    key: merged.key,
                    item: merged.item,
                    primaryCategoryId: merged.primaryCategoryId,
                    categories: mergedCategories,
                });
                emittedKeys.add(key);
            }

            if (validPinnedIds.length !== pinnedItemIds.value.length) {
                pinnedItemIds.value = validPinnedIds;
            }

            if (mergedItems.length <= limit) {
                return mergedItems;
            }

            return mergedItems.slice(0, limit);
        }

        function getSmartSortedItems(categoryId: string): LauncherItem[] {
            const raw = launcherItemsByCategoryId.value[categoryId];
            if (!raw || raw.length === 0) return [];

            const stats = useStatsStore();
            const pinnedSet = new Set(pinnedItemIds.value);
            const orderMap = new Map(stats.getSmartSortOrder(categoryId, raw.map(i => i.id)).map((id, idx) => [id, idx]));

            return [...raw].sort((a, b) => {
                const aPinned = pinnedSet.has(a.id);
                const bPinned = pinnedSet.has(b.id);
                if (aPinned && !bPinned) return -1;
                if (!aPinned && bPinned) return 1;

                const aOrder = orderMap.get(a.id) ?? 9999;
                const bOrder = orderMap.get(b.id) ?? 9999;
                return aOrder - bOrder;
            });
        }

        function recordConfirmedSearch() {
            const keyword = searchKeyword.value.trim();
            if (keyword.length >= 2) {
                const stats = useStatsStore();
                stats.recordSearch(keyword);
            }
        }

        return {
            searchKeyword,
            pinnedItemIds,
            recentUsedItems,
            launcherItemsByCategoryId,
            rustSearchResults,
            isRustSearchReady,
            createLauncherItemId,
            getNameFromPath,
            getLauncherItemsByCategoryId,
            setLauncherItemsByCategoryId,
            getLauncherItemById,
            updateLauncherItem,
            deleteLauncherItem,
            addLauncherItemsToCategory,
            addLauncherItemsToCategoryBatched,
            applyDropIcons,
            addUrlLauncherItemToCategory,
            updateLauncherItemIcon,
            deleteCategoryCleanup,
            setLauncherItemIcon,
            resetLauncherItemIcon,
            hasCustomIcon,
            hydrateMissingIconsForItems,
            rustSearchMergedResults,
            clearSearch,
            getLauncherItemMergeKey,
            togglePinned,
            isItemPinned,
            recordItemUsage,
            clearRecentUsed,
            importLauncherItems,
            importPinnedItemIds,
            reorderPinnedItemIds,
            importRecentUsedItems,
            getRecentUsedItems,
            getRecentUsedItemInfo,
            getRecentUsedMergedItems,
            getPinnedMergedItems,
            syncSearchIndex,
            rustSearch,
            getSmartSortedItems,
            recordConfirmedSearch,
        };
    },
    { persist: createVersionedPersistConfig("launcher", ["launcherItemsByCategoryId", "pinnedItemIds", "recentUsedItems"]) }
);
