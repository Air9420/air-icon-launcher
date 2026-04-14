import { computed, ref, watch } from "vue";
import { useThrottleFn } from "@vueuse/core";
import { storeToRefs } from "pinia";
import {
    useLauncherStore,
    type GlobalSearchMergedResult,
    type RustSearchResult,
} from "../stores/launcherStore";

export type SearchResult = RustSearchResult;

export interface SearchQuery {
    keyword: string;
    limit?: number;
}

export function useSearch() {
    const launcherStore = useLauncherStore();
    const {
        searchKeyword,
        rustSearchResults,
        rustSearchMergedResults,
        globalSearchMergedResults,
        isRustSearchReady,
    } = storeToRefs(launcherStore);
    const isSearching = ref(false);
    const searchError = ref<string | null>(null);

    async function updateSearchIndex() {
        try {
            await launcherStore.syncSearchIndex();
            searchError.value = null;
        } catch (e: unknown) {
            searchError.value = e instanceof Error ? e.message : "索引同步失败";
        }
    }

    async function search(query: SearchQuery) {
        if (!query.keyword.trim()) {
            launcherStore.clearSearch();
            return;
        }

        isSearching.value = true;
        searchError.value = null;

        try {
            await launcherStore.rustSearch(query.keyword, query.limit || 20);
        } catch (e: unknown) {
            searchError.value = e instanceof Error ? e.message : "搜索失败";
        } finally {
            isSearching.value = false;
        }
    }

    const throttledSearch = useThrottleFn(async (keyword: string) => {
        await search({ keyword });
    }, 50);

    watch(searchKeyword, async (newKeyword) => {
        if (!newKeyword.trim()) {
            searchError.value = null;
            return;
        }
        if (!isRustSearchReady.value) return;
        await throttledSearch(newKeyword);
    });

    const searchResults = computed<SearchResult[]>(() => rustSearchResults.value);
    const mergedResults = computed<GlobalSearchMergedResult[]>(() =>
        isRustSearchReady.value
            ? rustSearchMergedResults.value
            : globalSearchMergedResults.value
    );

    return {
        searchResults,
        mergedResults,
        isSearching,
        searchError,
        search,
        updateSearchIndex,
    };
}
