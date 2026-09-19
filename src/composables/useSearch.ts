import { computed, ref } from "vue";
import { storeToRefs } from "pinia";
import { useLauncherStore } from "../stores/launcherStore";
import { SEARCH_THROTTLE_MS } from "../utils/search-config";
import { useScanCache } from "./useScanCache";
import { getKernelContext } from "../kernel/context-access";
import type { ScannedFallbackSection } from "../types/scan-cache";

export type SearchResult = ReturnType<typeof useLauncherStore> extends () => infer R
    ? R extends { rustSearchResults: infer T } ? T : never
    : never;

export interface SearchQuery {
    keyword: string;
    limit?: number;
}

/**
 * Search composable adapter.
 *
 * P5: when `ctx.search` / `ctx.apps` exist, sync + query prefer SearchService
 * (shared results ref with launcherStore). Fallback keeps store path for tests.
 *
 * PERF-A:
 * - debounce ~150ms for keystrokes (trailing)
 * - request sequence: stale responses are discarded
 * - empty keyword clears immediately
 * - full index sync is ensured once (not per keystroke)
 */
export function useSearch() {
    const launcherStore = useLauncherStore();
    const {
        rustSearchResults,
        rustSearchMergedResults,
        isRustSearchReady,
    } = storeToRefs(launcherStore);
    const { getFallbackSection } = useScanCache();
    const isSearching = ref(false);
    const searchError = ref<string | null>(null);
    const scannedFallbackSection = ref<ScannedFallbackSection | null>(null);
    let ensureIndexPromise: Promise<void> | null = null;
    /** Monotonic sequence: only the latest search may write results. */
    let searchSeq = 0;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

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

    async function search(query: SearchQuery): Promise<void> {
        const seq = ++searchSeq;
        const keyword = query.keyword;

        if (!keyword.trim()) {
            cancelPendingDebounce();
            launcherStore.clearSearch();
            scannedFallbackSection.value = null;
            searchError.value = null;
            isSearching.value = false;
            return;
        }

        isSearching.value = true;
        searchError.value = null;

        try {
            const ready = await ensureSearchIndexReady();
            if (seq !== searchSeq) return;
            if (!ready) {
                searchError.value = "搜索索引未就绪";
                isSearching.value = false;
                return;
            }
            // launcherStore.rustSearch already prefers SearchService when present
            // (shared results ref).
            await launcherStore.rustSearch(keyword, query.limit || 20);
            if (seq !== searchSeq) return;

            if (rustSearchResults.value.length <= 3) {
                const fallback = await getFallbackSection(keyword);
                if (seq !== searchSeq) return;
                scannedFallbackSection.value = fallback;
            } else {
                scannedFallbackSection.value = null;
            }
        } catch (e: unknown) {
            if (seq !== searchSeq) return;
            searchError.value = e instanceof Error ? e.message : "搜索失败";
            scannedFallbackSection.value = null;
        } finally {
            if (seq === searchSeq) {
                isSearching.value = false;
            }
        }
    }

    function cancelPendingDebounce() {
        if (debounceTimer !== null) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
        }
    }

    /** Trailing debounce for keystrokes (~150ms). */
    function debouncedSearch(keyword: string, delayMs: number = SEARCH_THROTTLE_MS): Promise<void> {
        cancelPendingDebounce();
        return new Promise<void>((resolve) => {
            debounceTimer = setTimeout(() => {
                debounceTimer = null;
                void search({ keyword }).finally(() => resolve());
            }, delayMs);
        });
    }

    /** Immediate search (Enter / clear). Cancels pending debounce. */
    async function searchNow(keyword: string, limit?: number): Promise<void> {
        cancelPendingDebounce();
        await search({ keyword, limit });
    }

    /** Back-compat alias: now trailing-debounce + seq-guarded. */
    const throttledSearch = (keyword: string) => debouncedSearch(keyword);

    const searchResults = computed(() => rustSearchResults.value);
    const mergedResults = computed(() => rustSearchMergedResults.value);

    /** Optional direct Cordis access for UI that wants service-first search. */
    function getSearchService() {
        return getKernelContext()?.search;
    }

    return {
        searchResults,
        mergedResults,
        isSearching,
        searchError,
        search,
        searchNow,
        debouncedSearch,
        updateSearchIndex,
        throttledSearch,
        scannedFallbackSection,
        rustSearchResults,
        rustSearchMergedResults,
        getSearchService,
    };
}
