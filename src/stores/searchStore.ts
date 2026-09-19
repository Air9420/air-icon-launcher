import { defineStore } from "pinia";
import { getKernelContext } from "../kernel/context-access";
import type { SearchService } from "../kernel/services/search-service";

function getSearchService(): SearchService | undefined {
    return getKernelContext()?.search;
}

/**
 * Pinia adapter for search index event sync.
 *
 * P5+ slim: all real work lives on SearchService (`ctx.search`).
 * Fallbacks are no-ops when kernel is absent (unit tests / pre-kernel).
 */
export const useSearchStore = defineStore("search", () => {
    async function syncFullIndex() {
        await getSearchService()?.syncIndex();
    }

    function startListening() {
        getSearchService()?.startEventSync();
    }

    function stopListening() {
        getSearchService()?.stopEventSync();
    }

    return {
        syncFullIndex,
        startListening,
        stopListening,
    };
});
