import { computed, ref } from "vue";
import { useThrottleFn } from "@vueuse/core";
import { storeToRefs } from "pinia";
import { useLauncherStore } from "../stores/launcherStore";
import { SEARCH_THROTTLE_MS } from "../utils/search-config";

export type SearchResult = ReturnType<typeof useLauncherStore> extends () => infer R
    ? R extends { rustSearchResults: infer T } ? T : never
    : never;

export interface SearchQuery {
    keyword: string;
    limit?: number;
}

export function useSearch() {
    const launcherStore = useLauncherStore();
    const {
        rustSearchResults,
        rustSearchMergedResults,
        isRustSearchReady,
    } = storeToRefs(launcherStore);
    const isSearching = ref(false);
    const searchError = ref<string | null>(null);
    let ensureIndexPromise: Promise<void> | null = null;

    async function ensureSearchIndexReady(): Promise<boolean> {
        if (isRustSearchReady.value) return true;
        if (!ensureIndexPromise) {
            ensureIndexPromise = launcherStore.syncSearchIndex().finally(() => {
                ensureIndexPromise = null;
            });
        }
        await ensureIndexPromise;
        return isRustSearchReady.value;
    }

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
            const ready = await ensureSearchIndexReady();
            if (!ready) {
                searchError.value = "搜索索引未就绪";
                return;
            }
            await launcherStore.rustSearch(query.keyword, query.limit || 20);
        } catch (e: unknown) {
            searchError.value = e instanceof Error ? e.message : "搜索失败";
        } finally {
            isSearching.value = false;
        }
    }

    const throttledSearch = useThrottleFn(async (keyword: string) => {
        await search({ keyword });
    }, SEARCH_THROTTLE_MS, true);

    const searchResults = computed(() => rustSearchResults.value);
    const mergedResults = computed(() => rustSearchMergedResults.value);

    return {
        searchResults,
        mergedResults,
        isSearching,
        searchError,
        search,
        updateSearchIndex,
        throttledSearch,
    };
}
