import { computed, ref, watch, type Ref } from "vue";
import { getRecordContent, type ClipboardRecord } from "../../stores/clipboardStore";
import type { useClipboardStore } from "../../stores/clipboardStore";
import {
    filterBySelection,
    getGroupLabel,
    getRecordTypeLabel,
    isFavorite,
    matchesKeyword,
} from "./record-helpers";
import type { ClipboardFilter, ClipboardGroup } from "./types";

type ClipboardStoreInstance = ReturnType<typeof useClipboardStore>;

export function useClipboardFilter(params: {
    history: Ref<ClipboardRecord[]>;
    clipboardStore: ClipboardStoreInstance;
}) {
    const { history, clipboardStore } = params;

    const searchKeyword = ref("");
    const backendSearchResults = ref<ClipboardRecord[]>([]);
    const selectedFilter = ref<ClipboardFilter>("all");
    let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    const normalizedKeyword = computed(() => searchKeyword.value.trim().toLowerCase());

    watch(searchKeyword, (newKeyword) => {
        if (searchDebounceTimer) {
            clearTimeout(searchDebounceTimer);
        }
        const trimmed = newKeyword.trim();
        if (!trimmed) {
            backendSearchResults.value = [];
            return;
        }
        searchDebounceTimer = setTimeout(async () => {
            try {
                const results = await clipboardStore.search(trimmed);
                backendSearchResults.value = results;
            } catch {
                backendSearchResults.value = [];
            }
        }, 300);
    });

    const visibleRecords = computed(() => {
        const keyword = normalizedKeyword.value;

        if (keyword && backendSearchResults.value.length > 0) {
            const localIds = new Set(history.value.map((r) => r.id));
            const merged = [...history.value];
            for (const record of backendSearchResults.value) {
                if (!localIds.has(record.id)) {
                    merged.push(record);
                }
            }
            const records = filterBySelection(merged, selectedFilter.value);
            return records.filter((record) => matchesKeyword(record, keyword));
        }

        const records = filterBySelection(history.value, selectedFilter.value);
        if (!keyword) {
            return records;
        }
        return records.filter((record) => matchesKeyword(record, keyword));
    });

    const groupedHistory = computed<ClipboardGroup[]>(() => {
        const records = visibleRecords.value;
        if (records.length === 0) {
            return [];
        }

        if (selectedFilter.value === "favorites") {
            return [
                {
                    key: "favorites",
                    label: "已收藏",
                    items: records,
                },
            ];
        }

        if (selectedFilter.value !== "all") {
            const groupKey = selectedFilter.value;
            return [
                {
                    key: groupKey,
                    label: getGroupLabel(groupKey),
                    items: records,
                },
            ];
        }

        const favorites = records.filter((record) => isFavorite(record));
        const rest = records.filter((record) => !isFavorite(record));
        const sections: ClipboardGroup[] = [];

        if (favorites.length > 0) {
            sections.push({
                key: "favorites",
                label: "已收藏",
                items: favorites,
            });
        }

        if (rest.length > 0) {
            sections.push({
                key: "text",
                label: "全部",
                items: rest,
            });
        }

        return sections;
    });

    const displayedGroupedHistory = computed<ClipboardGroup[]>(() => groupedHistory.value);

    function clearSearchKeyword() {
        if (!searchKeyword.value) {
            return;
        }
        searchKeyword.value = "";
    }

    // Reload backend page when filter chip changes
    watch(selectedFilter, async (newFilter) => {
        await clipboardStore.preloadHistory(newFilter);
    });

    return {
        searchKeyword,
        selectedFilter,
        backendSearchResults,
        normalizedKeyword,
        visibleRecords,
        groupedHistory,
        displayedGroupedHistory,
        clearSearchKeyword,
        getRecordTypeLabel,
        getRecordContent,
        isFavorite,
    };
}
