import { defineStore } from "pinia";
import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { itemEventBus } from "../events/itemEvents";
import { useLauncherStore } from "./launcherStore";

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

export const useSearchStore = defineStore("search", () => {
    const pendingChanges = ref<SearchIndexChangesPayload>({ added: [], updated: [], deleted: [] });
    let searchIndexFlushTimer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribers: (() => void)[] = [];

    function getSearchEntryKey(categoryId: string, id: string): string {
        return `${categoryId}:${id}`;
    }

    function toSearchIndexItem(categoryId: string, item: any): SearchIndexItemPayload {
        return {
            id: item.id,
            name: item.name,
            path: item.path,
            category_id: categoryId,
            usage_count: item.usageCount || 0,
            last_used_at: item.lastUsedAt || 0,
            is_pinned: item.isFavorite || false,
            search_tokens: [],
            rank_score: 0,
        };
    }

    function scheduleFlush() {
        if (searchIndexFlushTimer) return;
        searchIndexFlushTimer = setTimeout(() => {
            searchIndexFlushTimer = null;
            void flushPendingChanges();
        }, 250);
    }

    async function flushPendingChanges() {
        const changes = {
            added: [...pendingChanges.value.added],
            updated: [...pendingChanges.value.updated],
            deleted: [...pendingChanges.value.deleted],
        };
        pendingChanges.value = { added: [], updated: [], deleted: [] };

        if (changes.added.length === 0 && changes.updated.length === 0 && changes.deleted.length === 0) {
            return;
        }

        try {
            const result = await invoke("update_search_items_incremental", { changes });
            if (!result) {
                console.error("Failed to incrementally sync search index");
            }
        } catch (e) {
            console.error("Failed to incrementally sync search index:", e);
        }
    }

    async function syncFullIndex() {
        console.log("searchStore syncFullIndex called - delegated to launcherStore");
    }

    function startListening() {
        unsubscribers.push(
            itemEventBus.on('item:created', (e) => {
                pendingChanges.value.added.push(toSearchIndexItem(e.categoryId, e.item));
                scheduleFlush();
            })
        );

        unsubscribers.push(
            itemEventBus.on('item:updated', (e) => {
                const key = getSearchEntryKey(e.categoryId, e.item.id);
                const existingAdded = pendingChanges.value.added.findIndex(
                    item => getSearchEntryKey(item.category_id, item.id) === key
                );
                if (existingAdded !== -1) {
                    pendingChanges.value.added[existingAdded] = toSearchIndexItem(e.categoryId, e.item);
                } else {
                    pendingChanges.value.updated.push(toSearchIndexItem(e.categoryId, e.item));
                }
                scheduleFlush();
            })
        );

        unsubscribers.push(
            itemEventBus.on('item:deleted', (e) => {
                const addedIndex = pendingChanges.value.added.findIndex(
                    item => getSearchEntryKey(item.category_id, item.id) === getSearchEntryKey(e.categoryId, e.itemId)
                );
                if (addedIndex !== -1) {
                    pendingChanges.value.added.splice(addedIndex, 1);
                } else {
                    pendingChanges.value.deleted.push({ category_id: e.categoryId, id: e.itemId });
                }
                scheduleFlush();
            })
        );

        unsubscribers.push(
            itemEventBus.on('item:moved', (e) => {
                for (const itemId of e.itemIds) {
                    pendingChanges.value.deleted.push({ category_id: e.fromCategoryId, id: itemId });
                }
                const launcherStore = useLauncherStore();
                for (const itemId of e.itemIds) {
                    const item = launcherStore.getLauncherItemById(e.toCategoryId, itemId);
                    if (item) {
                        pendingChanges.value.added.push(toSearchIndexItem(e.toCategoryId, item));
                    }
                }
                scheduleFlush();
            })
        );
    }

    function stopListening() {
        for (const unsub of unsubscribers) {
            unsub();
        }
        unsubscribers = [];
        if (searchIndexFlushTimer) {
            clearTimeout(searchIndexFlushTimer);
            searchIndexFlushTimer = null;
        }
    }

    return {
        syncFullIndex,
        startListening,
        stopListening,
    };
});
