<template>
    <div
        class="categorie-view"
        :class="{ 'is-editing': isEditingCategory }"
        @keydown="onKeydown"
        @keyup="onKeyup"
        tabindex="0"
    >
        <div class="search-header">
            <div ref="searchShellRef" class="search-shell">
                <SearchBox
                    ref="searchBoxRef"
                    v-model="searchKeyword"
                    placeholder="搜索启动项..."
                    :intercept-tab="true"
                    @nav="onSearchNav"
                >
                    <template #actions>
                        <button
                            v-if="!searchKeyword.trim()"
                            class="history-toggle-btn"
                            type="button"
                            @mousedown.prevent
                            @click="toggleSearchHistoryPanel"
                        >
                            {{ showSearchHistoryPanel ? "收起历史" : "展示历史" }}
                        </button>
                    </template>
                </SearchBox>

                <div v-if="showSearchHistoryPanel" class="search-history-panel">
                    <div class="search-history-title">最近搜索</div>
                    <template v-if="searchHistoryEntries.length > 0">
                        <button
                            v-for="entry in searchHistoryEntries"
                            :key="entry.keyword"
                            class="search-history-item"
                            type="button"
                            @mousedown.prevent
                            @click="onSelectSearchHistory(getSearchHistoryLabel(entry))"
                        >
                            <span class="history-keyword">{{ getSearchHistoryLabel(entry) }}</span>
                            <span class="history-meta">{{ entry.count }} 次</span>
                        </button>
                    </template>
                    <div v-else class="search-history-empty">暂无最近搜索</div>
                </div>
            </div>
        </div>

        <SearchResults
            v-if="homeSearchViewState === 'results'"
            :results="rustSearchMergedResults"
            :get-launch-status="getLaunchStatus"
            :selected-index="selectedIndex"
            :keyword="searchKeyword"
            :show-shortcut-hints="showShortcutHints"
            @select="launchSearchWithCd"
        />

        <template v-if="homeSearchViewState === 'home'">
            <div
                v-if="pinnedMergedItems.length > 0 || recentMergedItems.length > 0"
                class="home-sections"
                data-menu-type="Home"
            >
                <PinnedItems
                    :items="pinnedMergedItems"
                    :layout="pinnedLayout"
                    :get-launch-status="getLaunchStatus"
                    @select="launchPinnedWithCd"
                    @reorder="onReorderPinnedItems"
                />

                <RecentItems
                    :items="recentMergedItems"
                    :layout="recentLayout"
                    :get-launch-status="getLaunchStatus"
                    @select="launchRecentWithCd"
                />
            </div>

            <CategoryGrid
                :categories="displayCategories"
                :cols="categoryCols"
                :is-editing="isEditingCategory"
                :editing-category-id="editingCategoryId"
                :editing-category-name="editingCategoryName"
                :is-new-category="isNewCategory"
                @update:categories="onUpdateCategories"
                @update:editing-category-name="editingCategoryName = $event"
                @select="onClickCategory"
                @confirm-edit="onConfirmCategoryEdit"
                @cancel-edit="onCancelCategoryEdit"
            />
        </template>

        <SearchFallback
            v-else-if="homeSearchViewState === 'fallback'"
            :keyword="searchKeyword"
            @browser-search="onBrowserSearch"
        />
    </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { onClickOutside, useThrottleFn } from "@vueuse/core";
import { useRouter } from "vue-router";
import { storeToRefs } from "pinia";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { useLaunchCooldown } from "../composables/useLaunchCooldown";

import SearchBox from "../components/SearchBox.vue";
import SearchResults from "../components/home/SearchResults.vue";
import SearchFallback from "../components/SearchFallback.vue";
import PinnedItems from "../components/home/PinnedItems.vue";
import RecentItems from "../components/home/RecentItems.vue";
import CategoryGrid from "../components/home/CategoryGrid.vue";

import {
    Store,
    useSettingsStore,
    useUIStore,
    useCategoryStore,
    type GlobalSearchMergedResult,
    type RecentUsedMergedItem,
    type PinnedMergedItem,
    type Category as CategoryType,
} from "../stores";
import { useStatsStore, type SearchKeywordRecord } from "../stores/statsStore";
import { useLaunchStatus } from "../composables/useLaunchStatus";
import { showToast } from "../composables/useGlobalToast";
import { invokeOrThrow } from "../utils/invoke-wrapper";
import { launchStoredItem } from "../utils/launcher-service";
import { SEARCH_THROTTLE_MS } from "../utils/search-config";
import {
    createSearchSelectionTarget,
    findSearchSelectionIndex,
    getHomeSearchViewState,
    getSearchHistoryDisplayKeyword,
    getRecentSearchHistoryEntries,
    getSearchShortcutIndex,
    type SearchSelectionTarget,
} from "../utils/search-ui";

const store = Store();
const settingsStore = useSettingsStore();
const statsStore = useStatsStore();
const uiStore = useUIStore();
const categoryStore = useCategoryStore();
const router = useRouter();

const {
    searchKeyword,
    rustSearchResults,
    rustSearchMergedResults,
    isRustSearchReady,
} = storeToRefs(store);
const { categoryCols } = storeToRefs(uiStore);
const {
    displayCategories,
    editingCategoryId,
    editingCategoryName,
    isEditingCategory,
    isNewCategory,
} = storeToRefs(categoryStore);
const { autoHideAfterLaunch } = storeToRefs(settingsStore);

const searchBoxRef = ref<InstanceType<typeof SearchBox> | null>(null);
const searchShellRef = ref<HTMLElement | null>(null);

const selectedIndex = ref(-1);
const isSearchHistoryOpen = ref(false);
const isHomeSearchPending = ref(false);
const showShortcutHints = ref(false);

const { setLaunchStatus, clearLaunchStatus, getLaunchStatus } = useLaunchStatus({
    autoHideAfterLaunch,
});

const showSearchHistoryPanel = computed(() => (
    isSearchHistoryOpen.value && !searchKeyword.value.trim()
));
const searchHistoryEntries = computed<SearchKeywordRecord[]>(() =>
    getRecentSearchHistoryEntries<SearchKeywordRecord>(statsStore.searchHistory, 8)
);
const homeSearchViewState = computed(() =>
    getHomeSearchViewState(
        searchKeyword.value,
        rustSearchMergedResults.value.length,
        isHomeSearchPending.value
    )
);

let unlistenFocus: (() => void) | null = null;
let unlistenShow: (() => void) | null = null;
let pendingHomeSearchSelection: (SearchSelectionTarget & { keyword: string }) | null = null;
let homeSearchRequestId = 0;

onClickOutside(searchShellRef, () => {
    if (showSearchHistoryPanel.value) {
        closeSearchHistoryPanel();
    }
});

onMounted(async () => {
    const win = getCurrentWindow();

    await store.syncSearchIndex();

    unlistenFocus = await win.onFocusChanged(({ payload: focused }) => {
        if (!focused) {
            showShortcutHints.value = false;
            return;
        }

        nextTick(() => {
            searchBoxRef.value?.focus();
        });
    });

    unlistenShow = await listen("window-shown", () => {
        closeSearchHistoryPanel();
        isHomeSearchPending.value = false;
        pendingHomeSearchSelection = null;
        showShortcutHints.value = false;
        store.clearSearch();
        selectedIndex.value = -1;
        nextTick(() => {
            searchBoxRef.value?.focus();
        });
    });

    nextTick(() => {
        searchBoxRef.value?.focus();
    });
});

onUnmounted(() => {
    if (unlistenFocus) unlistenFocus();
    if (unlistenShow) unlistenShow();
});

const recentMergedItems = computed<RecentUsedMergedItem[]>(() => {
    return store.getRecentUsedMergedItems(uiStore.getHomeSectionLimit("recent"), { visible: true });
});

const pinnedMergedItems = computed<PinnedMergedItem[]>(() => {
    return store.getPinnedMergedItems(uiStore.getHomeSectionLimit("pinned"));
});

const pinnedLayout = computed(() => uiStore.getHomeSectionLayout("pinned"));
const recentLayout = computed(() => uiStore.getHomeSectionLayout("recent"));

function closeSearchHistoryPanel() {
    isSearchHistoryOpen.value = false;
}

function toggleSearchHistoryPanel() {
    if (searchKeyword.value.trim()) return;
    isSearchHistoryOpen.value = !isSearchHistoryOpen.value;
    nextTick(() => {
        searchBoxRef.value?.focus();
    });
}

function onSelectSearchHistory(keyword: string) {
    closeSearchHistoryPanel();
    pendingHomeSearchSelection = null;
    selectedIndex.value = -1;
    searchKeyword.value = keyword;
    nextTick(() => {
        searchBoxRef.value?.focus();
    });
}

function getSearchHistoryLabel(entry: SearchKeywordRecord) {
    return getSearchHistoryDisplayKeyword(entry);
}

function onClickCategory(element: CategoryType) {
    if (isEditingCategory.value) return;
    categoryStore.setCurrentCategory(element.id);
    router.push({ name: "category", params: { categoryId: element.id } });
}

function onUpdateCategories(newCategories: CategoryType[]) {
    categoryStore.reorderCategories(newCategories);
}

function onConfirmCategoryEdit() {
    if (!editingCategoryName.value.trim()) {
        showToast("分类名称不能为空");
        return;
    }
    categoryStore.confirmCategoryEdit(editingCategoryName.value);
}

function onCancelCategoryEdit() {
    categoryStore.cancelCategoryEdit();
}

async function onBrowserSearch() {
    const keyword = searchKeyword.value.trim();
    if (!keyword) return;

    try {
        await invokeOrThrow("open_browser_search", { query: keyword });
        closeSearchHistoryPanel();
        store.recordConfirmedSearch();
        store.clearSearch();
        selectedIndex.value = -1;
    } catch (error) {
        console.error(error);
        showToast("无法使用默认浏览器搜索", { type: "error" });
    }
}

async function onOpenSearchResult(result: GlobalSearchMergedResult) {
    store.recordConfirmedSearch();

    if (!result?.item || !result?.primaryCategoryId) return;
    const item = result.item;
    closeSearchHistoryPanel();
    store.clearSearch();
    setLaunchStatus(item.id, "launching");
    try {
        await launchStoredItem(
            {
                categoryId: result.primaryCategoryId,
                itemId: item.id,
            },
            {
                store,
                notifyError: true,
            }
        );
        setLaunchStatus(item.id, "success");
    } catch (e) {
        console.error(e);
        clearLaunchStatus(item.id);
    }
}

async function onOpenRecentItem(item: RecentUsedMergedItem) {
    if (!item?.item || !item?.recent?.categoryId) return;
    setLaunchStatus(item.item.id, "launching");
    try {
        await launchStoredItem(
            {
                categoryId: item.recent.categoryId,
                itemId: item.item.id,
            },
            {
                store,
                notifyError: true,
            }
        );
        setLaunchStatus(item.item.id, "success");
    } catch (e) {
        console.error(e);
        clearLaunchStatus(item.item.id);
    }
}

async function onOpenPinnedItem(item: PinnedMergedItem) {
    if (!item?.item || !item?.primaryCategoryId) return;
    setLaunchStatus(item.item.id, "launching");
    try {
        await launchStoredItem(
            {
                categoryId: item.primaryCategoryId,
                itemId: item.item.id,
            },
            {
                store,
                notifyError: true,
            }
        );
        setLaunchStatus(item.item.id, "success");
    } catch (e) {
        console.error(e);
        clearLaunchStatus(item.item.id);
    }
}

function onReorderPinnedItems(newOrder: string[]) {
    store.reorderPinnedItemIds(newOrder);
}

const { createCooldown } = useLaunchCooldown({ cooldown: 2500 });

const launchSearchWithCd = createCooldown(onOpenSearchResult);
const launchRecentWithCd = createCooldown(onOpenRecentItem);
const launchPinnedWithCd = createCooldown(onOpenPinnedItem);

watch(editingCategoryId, async (value) => {
    if (!value) return;
    await nextTick();
});

const throttledRustSearch = useThrottleFn(async (keyword: string, requestId: number) => {
    try {
        const results = await store.searchLauncherItems({ keyword });
        if (requestId !== homeSearchRequestId) return;
        rustSearchResults.value = results;
    } finally {
        if (requestId === homeSearchRequestId) {
            isHomeSearchPending.value = false;
        }
    }
}, SEARCH_THROTTLE_MS, true);

let ensureIndexPromise: Promise<void> | null = null;

async function ensureRustSearchReady(): Promise<boolean> {
    if (isRustSearchReady.value) return true;
    if (!ensureIndexPromise) {
        ensureIndexPromise = store.syncSearchIndex().finally(() => {
            ensureIndexPromise = null;
        });
    }
    await ensureIndexPromise;
    return isRustSearchReady.value;
}

watch(searchKeyword, async (keyword) => {
    const trimmedKeyword = keyword.trim();
    const isPendingTabSelection = pendingHomeSearchSelection?.keyword === trimmedKeyword;
    if (!isPendingTabSelection) {
        pendingHomeSearchSelection = null;
        selectedIndex.value = -1;
    }

    homeSearchRequestId += 1;
    const requestId = homeSearchRequestId;

    if (!trimmedKeyword) {
        pendingHomeSearchSelection = null;
        rustSearchResults.value = [];
        isHomeSearchPending.value = false;
        showShortcutHints.value = false;
        return;
    }

    closeSearchHistoryPanel();
    rustSearchResults.value = [];
    isHomeSearchPending.value = true;
    const ready = await ensureRustSearchReady();
    if (!ready || requestId !== homeSearchRequestId) {
        if (requestId === homeSearchRequestId) {
            isHomeSearchPending.value = false;
        }
        return;
    }
    await throttledRustSearch(trimmedKeyword, requestId);
});

const currentSearchResults = computed(() => {
    return rustSearchMergedResults.value;
});

watch(
    currentSearchResults,
    (results) => {
        if (pendingHomeSearchSelection && !isHomeSearchPending.value) {
            selectedIndex.value = findSearchSelectionIndex(
                results,
                pendingHomeSearchSelection
            );
            pendingHomeSearchSelection = null;
        }

        if (!searchKeyword.value.trim()) return;
        const targets = results.map((result) => ({
            categoryId: result.primaryCategoryId,
            itemId: result.item.id,
        }));
        void store.hydrateMissingIconsForItems(targets);
    },
    { immediate: true }
);

watch(
    [pinnedMergedItems, recentMergedItems, searchKeyword],
    ([pinned, recent, keyword]) => {
        if (keyword.trim()) return;
        const targets = [
            ...pinned.map((item) => ({
                categoryId: item.primaryCategoryId,
                itemId: item.item.id,
            })),
            ...recent.map((item) => ({
                categoryId: item.recent.categoryId,
                itemId: item.item.id,
            })),
        ];
        void store.hydrateMissingIconsForItems(targets);
    },
    { immediate: true }
);

function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && showSearchHistoryPanel.value) {
        closeSearchHistoryPanel();
        return;
    }

    if (!searchKeyword.value.trim() || currentSearchResults.value.length === 0) {
        return;
    }

    if (e.key === "Control") {
        showShortcutHints.value = true;
        return;
    }

    if (e.ctrlKey && !e.altKey && !e.metaKey) {
        showShortcutHints.value = true;
        const shortcutIndex = getSearchShortcutIndex(e);
        if (shortcutIndex !== null) {
            e.preventDefault();
            if (shortcutIndex < currentSearchResults.value.length) {
                selectedIndex.value = shortcutIndex;
                launchSearchWithCd(currentSearchResults.value[shortcutIndex]);
            }
            return;
        }
    }

    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === "Tab") {
        return;
    }
}

function onKeyup(e: KeyboardEvent) {
    if (e.key === "Control" || !e.ctrlKey) {
        showShortcutHints.value = false;
    }
}

function onSearchNav(direction: "up" | "down" | "enter" | "tab") {
    if (!searchKeyword.value.trim() || currentSearchResults.value.length === 0) {
        return;
    }

    if (direction === "down") {
        if (selectedIndex.value < currentSearchResults.value.length - 1) {
            selectedIndex.value++;
        } else {
            selectedIndex.value = 0;
        }
        return;
    }

    if (direction === "up") {
        if (selectedIndex.value > 0) {
            selectedIndex.value--;
        } else {
            selectedIndex.value = currentSearchResults.value.length - 1;
        }
        return;
    }

    if (direction === "tab") {
        if (currentSearchResults.value.length === 1) {
            const result = currentSearchResults.value[0];
            selectedIndex.value = 0;
            pendingHomeSearchSelection = {
                ...createSearchSelectionTarget(result),
                keyword: result.item.name.trim(),
            };
            searchKeyword.value = result.item.name;
        }
        return;
    }

    if (selectedIndex.value >= 0 && selectedIndex.value < currentSearchResults.value.length) {
        const result = currentSearchResults.value[selectedIndex.value];
        launchSearchWithCd(result);
    }
}
</script>

<style lang="scss" scoped>
.categorie-view {
    width: 100vw;
    height: 100vh;
    background: var(--bg-color);
    display: flex;
    flex-direction: column;
    user-select: none;
}

.categorie-view.is-editing {
    pointer-events: none;
}

.search-header {
    padding: 12px 16px;
    flex-shrink: 0;
}

.search-shell {
    position: relative;
    width: min(100%, 760px);
    margin: 0 auto;
}

.history-toggle-btn {
    height: 18px;
    border: 0;
    border-radius: 999px;
    background: var(--hover-bg);
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 12px;
    transition: background 0.15s ease, color 0.15s ease;
}

.history-toggle-btn:hover {
    background: var(--hover-bg-strong);
    color: var(--text-color);
}

.search-history-panel {
    position: absolute;
    top: calc(100% + 10px);
    left: 0;
    right: 0;
    z-index: 12;
    padding: 12px;
    border-radius: 16px;
    background: var(--search-history-bg);
    border: 1px solid var(--border-color);
    box-shadow: var(--card-shadow);
    backdrop-filter: var(--backdrop-blur);
}

.search-history-title {
    font-size: 12px;
    font-weight: 700;
    color: var(--text-hint);
    margin-bottom: 8px;
}

.search-history-item {
    width: 100%;
    border: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 12px;
    background: transparent;
    color: var(--text-color);
    cursor: pointer;
    transition: background 0.15s ease;
}

.search-history-item:hover {
    background: var(--hover-bg);
}

.history-keyword {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 14px;
}

.history-meta {
    flex-shrink: 0;
    font-size: 12px;
    color: var(--text-hint);
}

.search-history-empty {
    padding: 12px 8px 4px;
    color: var(--text-hint);
    font-size: 13px;
}

.no-results {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-color-secondary);
    font-size: 14px;
}

.home-sections {
    padding: 0 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    flex-shrink: 0;
}
</style>
