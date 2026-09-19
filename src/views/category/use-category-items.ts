import { computed, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { useThrottleFn } from "@vueuse/core";
import { Store, useCategoryStore } from "../../stores";
import { useSettingsStore } from "../../stores";
import { useUIStore } from "../../stores/uiStore";
import type { LauncherItem, RustSearchResult } from "../../stores/launcherStore";
import { SEARCH_THROTTLE_MS } from "../../utils/search-config";
import { collectVisibleGridHydrationTargets } from "../../utils/icon-hydration-window";
import {
    shouldSkipVisibleHydration,
    type WindowVisibilityState,
} from "../../utils/window-visibility";

export type CategorySearchEntry = {
    item: LauncherItem;
    key: string;
};

export function useCategoryItems(categoryId: () => string) {
    const store = Store();
    const uiStore = useUIStore();
    const categoryStore = useCategoryStore();
    const settingsStore = useSettingsStore();
    const { launcherCols, categorySortMode } = storeToRefs(uiStore);
    const { autoHideAfterLaunch } = storeToRefs(settingsStore);

    const localSearchKeyword = ref("");
    const categorySearchResults = ref<RustSearchResult[]>([]);
    const isCategorySearchPending = ref(false);
    const isWindowFocused = ref(true);
    const windowVisibility = ref<WindowVisibilityState>("visible");

    const isSearchActive = computed(() => localSearchKeyword.value.trim().length > 0);
    const isManualSort = computed(() => categorySortMode.value === "manual");
    const hideName = computed(() => (launcherCols.value ?? 5) >= 6);

    const title = computed(() => {
        const category = categoryStore.getCategoryById(categoryId());
        return category?.name || "未命名类目";
    });

    const items = computed<LauncherItem[]>({
        get() {
            if (!isManualSort.value) {
                return store.getSmartSortedItems(categoryId());
            }
            const rawItems = store.getLauncherItemsByCategoryId(categoryId());
            const favoriteIds = new Set(store.pinnedItemIds);
            return [...rawItems].sort((a, b) => {
                const aFav = favoriteIds.has(a.id);
                const bFav = favoriteIds.has(b.id);
                if (aFav && !bFav) return -1;
                if (!aFav && bFav) return 1;
                return 0;
            });
        },
        set(value) {
            store.setLauncherItemsByCategoryId(categoryId(), value);
        },
    });

    const itemById = computed(() => new Map(items.value.map((item) => [item.id, item] as const)));

    const categorySearchItems = computed<CategorySearchEntry[]>(() => {
        return categorySearchResults.value
            .map((result) => {
                const item = itemById.value.get(result.id);
                if (!item) return null;
                return {
                    item,
                    key: `${categoryId()}:${result.id}`,
                };
            })
            .filter((entry): entry is CategorySearchEntry => entry !== null);
    });

    const visibleLauncherItems = computed<LauncherItem[]>(() => {
        if (isSearchActive.value) {
            return categorySearchItems.value.map((entry) => entry.item);
        }
        return items.value;
    });

    let ensureIndexPromise: Promise<void> | null = null;
    let categorySearchRequestId = 0;
    let categorySearchContextId = 0;

    async function ensureRustSearchReady(): Promise<boolean> {
        if (store.isRustSearchReady) return true;
        if (!ensureIndexPromise) {
            ensureIndexPromise = store.syncSearchIndex().finally(() => {
                ensureIndexPromise = null;
            });
        }
        await ensureIndexPromise;
        return store.isRustSearchReady;
    }

    const applyCategorySearch = useThrottleFn(async (keyword: string, requestId: number) => {
        try {
            const contextId = categorySearchContextId;
            const results = await store.searchLauncherItems({
                keyword,
                categoryId: categoryId(),
            });
            if (requestId !== categorySearchRequestId || contextId !== categorySearchContextId) return;
            categorySearchResults.value = results;
        } finally {
            if (requestId === categorySearchRequestId) {
                isCategorySearchPending.value = false;
            }
        }
    }, SEARCH_THROTTLE_MS, true);

    watch(
        localSearchKeyword,
        async (keyword) => {
            const trimmedKeyword = keyword.trim();
            const contextId = categorySearchContextId;
            categorySearchRequestId += 1;
            const requestId = categorySearchRequestId;

            if (!trimmedKeyword) {
                categorySearchResults.value = [];
                isCategorySearchPending.value = false;
                return;
            }

            categorySearchResults.value = [];
            isCategorySearchPending.value = true;

            const ready = await ensureRustSearchReady();
            if (
                !ready ||
                requestId !== categorySearchRequestId ||
                contextId !== categorySearchContextId
            ) {
                if (
                    requestId === categorySearchRequestId &&
                    contextId === categorySearchContextId
                ) {
                    isCategorySearchPending.value = false;
                }
                return;
            }

            await applyCategorySearch(trimmedKeyword, requestId);
        },
        { immediate: true }
    );

    function resetSearchForCategoryChange() {
        categorySearchContextId += 1;
        categorySearchRequestId += 1;
        categorySearchResults.value = [];
        isCategorySearchPending.value = false;
    }

    async function rerunSearchAfterCategoryChange() {
        const keyword = localSearchKeyword.value.trim();
        if (!keyword) return;

        const contextId = categorySearchContextId;
        const requestId = categorySearchRequestId;
        isCategorySearchPending.value = true;

        const ready = await ensureRustSearchReady();
        if (
            !ready ||
            requestId !== categorySearchRequestId ||
            contextId !== categorySearchContextId
        ) {
            if (
                requestId === categorySearchRequestId &&
                contextId === categorySearchContextId
            ) {
                isCategorySearchPending.value = false;
            }
            return;
        }

        await applyCategorySearch(keyword, requestId);
    }

    // Icon hydration
    const searchResultsContainerRef = ref<HTMLElement | null>(null);
    const iconContainerRef = ref<unknown>(null);
    const categoryViewRef = ref<HTMLElement | null>(null);

    function getActiveIconContainer(): HTMLElement | null {
        const unwrap = (value: unknown): HTMLElement | null => {
            if (value instanceof HTMLElement) return value;
            if (
                value &&
                typeof value === "object" &&
                "$el" in value &&
                (value as { $el?: unknown }).$el instanceof HTMLElement
            ) {
                return (value as { $el: HTMLElement }).$el;
            }
            return null;
        };
        if (isSearchActive.value) {
            return unwrap(searchResultsContainerRef.value);
        }
        return unwrap(iconContainerRef.value);
    }

    function getVisibleHydrationTargets(): Array<{ categoryId: string; itemId: string }> {
        const visibleItemIds = visibleLauncherItems.value.map((item) => item.id);
        if (visibleItemIds.length === 0) return [];

        const container = getActiveIconContainer();
        const cols = Math.max(1, Number(launcherCols.value ?? 1));
        const firstItemHeight = container
            ?.querySelector<HTMLElement>(".icon-item")
            ?.getBoundingClientRect().height ?? 0;
        const rowHeight = firstItemHeight > 0
            ? Math.round(firstItemHeight + 14)
            : (container
                ? Math.max(1, Math.round(container.clientWidth / cols) + 14)
                : 0);

        return collectVisibleGridHydrationTargets({
            categoryId: categoryId(),
            itemIds: visibleItemIds,
            cols,
            scrollTop: container?.scrollTop ?? 0,
            clientHeight: container?.clientHeight ?? 0,
            rowHeight,
            bufferRows: 1,
            fallbackVisibleRows: 3,
        });
    }

    function getVisibleIconMaxEdge(): number | undefined {
        const container = getActiveIconContainer();
        const iconNode = container?.querySelector<HTMLElement>(".icon-item .icon-img");
        const iconSize = iconNode?.getBoundingClientRect().width ?? 0;
        if (iconSize <= 0) return undefined;
        return Math.max(32, Math.min(256, Math.round(iconSize)));
    }

    const scheduleVisibleIconHydration = useThrottleFn(() => {
        if (shouldSkipVisibleHydration(windowVisibility.value, isWindowFocused.value)) return;
        const targets = getVisibleHydrationTargets();
        if (targets.length === 0) return;
        void store.hydrateLauncherIconsForVisibleItems(targets, {
            maxEdge: getVisibleIconMaxEdge(),
        });
    }, 80, true);

    watch(
        [items, categorySearchItems, launcherCols, isSearchActive],
        () => {
            scheduleVisibleIconHydration();
        },
        { immediate: true }
    );

    watch(
        categorySearchItems,
        (results) => {
            if (!isSearchActive.value || results.length === 0) return;
            scheduleVisibleIconHydration();
        },
        { immediate: true }
    );

    return {
        store,
        uiStore,
        categoryStore,
        launcherCols,
        categorySortMode,
        autoHideAfterLaunch,
        localSearchKeyword,
        categorySearchResults,
        isCategorySearchPending,
        isWindowFocused,
        windowVisibility,
        isSearchActive,
        isManualSort,
        hideName,
        title,
        items,
        itemById,
        categorySearchItems,
        visibleLauncherItems,
        categoryViewRef,
        iconContainerRef,
        searchResultsContainerRef,
        scheduleVisibleIconHydration,
        resetSearchForCategoryChange,
        rerunSearchAfterCategoryChange,
        setWindowFocused: (v: boolean) => { isWindowFocused.value = v; },
        setWindowVisibility: (v: WindowVisibilityState) => { windowVisibility.value = v; },
        clearSearchResults: () => {
            localSearchKeyword.value = "";
            categorySearchResults.value = [];
            isCategorySearchPending.value = false;
        },
    };
}
