import { defineStore } from "pinia";
import { ref } from "vue";
import type { RecentFileSearchResult } from "../types/search-extensions";

export const useSearchExtensionsStore = defineStore("searchExtensions", () => {
    const recentFileCandidates = ref<RecentFileSearchResult[]>([]);
    const recentFileCandidatesLoadedAt = ref<number>(0);

    function setRecentFileCandidates(rows: RecentFileSearchResult[]) {
        recentFileCandidates.value = rows;
        recentFileCandidatesLoadedAt.value = Date.now();
    }

    return {
        recentFileCandidates,
        recentFileCandidatesLoadedAt,
        setRecentFileCandidates,
    };
});

