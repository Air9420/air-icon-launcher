import { invoke } from "../utils/invoke-wrapper";
import { useCategoryStore } from "../stores/categoryStore";
import { SEARCH_REQUEST_TIMEOUT_MS } from "../utils/search-config";
import type { LauncherItem, RustSearchResult, RecentUsedItem } from "../stores/launcherStore";

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

export function useSearchSync(
    getLauncherItemsByCategoryId: (categoryId: string) => LauncherItem[],
    getLauncherItemById: (categoryId: string, itemId: string) => LauncherItem | null,
    pinnedItemIds: { value: string[] },
    recentUsedItems: { value: RecentUsedItem[] },
    isRustSearchReady: { value: boolean }
) {
    const pendingSearchAdded = new Map<string, SearchIndexItemPayload>();
    const pendingSearchUpdated = new Map<string, SearchIndexItemPayload>();
    const pendingSearchDeleted = new Map<string, SearchIndexDeletedPayload>();
    let searchIndexFlushTimer: ReturnType<typeof setTimeout> | null = null;
    let searchIndexSyncInFlight: Promise<void> | null = null;
    let fullSearchIndexSyncInFlight: Promise<void> | null = null;

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
        if (fullSearchIndexSyncInFlight) {
            return fullSearchIndexSyncInFlight;
        }

        fullSearchIndexSyncInFlight = (async () => {
            if (waitIncrementalInFlight && searchIndexSyncInFlight) {
                await searchIndexSyncInFlight;
            }

            cancelPendingSearchFlush();
            clearPendingSearchChanges();

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
                fullSearchIndexSyncInFlight = null;
                if (isRustSearchReady.value && hasPendingSearchChanges()) {
                    scheduleSearchIncrementalFlush(0);
                }
            }
        })();

        return fullSearchIndexSyncInFlight;
    }

    async function flushPendingSearchChanges(): Promise<void> {
        if (!isRustSearchReady.value) {
            clearPendingSearchChanges();
            return;
        }
        if (fullSearchIndexSyncInFlight || searchIndexSyncInFlight) {
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

    async function syncSearchIndex() {
        await syncSearchIndexInternal(true);
    }

    async function withTimeout<T>(
        promise: Promise<T>,
        timeoutMs: number
    ): Promise<T | null> {
        let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
        try {
            return await Promise.race([
                promise,
                new Promise<null>((resolve) => {
                    timeoutHandle = setTimeout(() => resolve(null), timeoutMs);
                }),
            ]);
        } finally {
            if (timeoutHandle) {
                clearTimeout(timeoutHandle);
            }
        }
    }

    async function searchLauncherItems(
        query: { keyword: string; limit?: number; categoryId?: string }
    ): Promise<RustSearchResult[]> {
        if (!query.keyword.trim()) {
            return [];
        }
        try {
            const result = await withTimeout(
                invoke<RustSearchResult[]>("search_apps", {
                    query: {
                        keyword: query.keyword,
                        limit: query.limit ?? 20,
                        category_id: query.categoryId ?? null,
                    },
                }),
                SEARCH_REQUEST_TIMEOUT_MS
            );
            if (result === null) {
                console.warn(
                    `Rust search timed out after ${SEARCH_REQUEST_TIMEOUT_MS}ms`,
                    query.keyword
                );
                return [];
            }
            if (!result.ok) {
                console.error("Rust search failed:", result.error);
                return [];
            }
            return result.value;
        } catch (e) {
            console.error("Rust search failed:", e);
            return [];
        }
    }

    return {
        enqueueSearchChanges,
        enqueueSearchUpdateByRef,
        enqueueSearchUpdateByItemId,
        enqueueSearchRefreshForAllItems,
        syncSearchIndexInternal,
        syncSearchIndex,
        searchLauncherItems,
        toSearchIndexItem,
        collectSearchRankingSignals,
    };
}
