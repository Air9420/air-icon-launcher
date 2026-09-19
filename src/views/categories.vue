<template>
    <div
        class="categorie-view"
        :class="{ 'is-editing': isEditingCategory }"
        tabindex="0"
    >
        <HomeSearchBar
            ref="homeSearchBarRef"
            :search-keyword="searchKeyword"
            :show-search-history-panel="showSearchHistoryPanel"
            :search-history-entries="searchHistoryEntries"
            :get-search-history-label="getSearchHistoryLabel"
            @update:search-keyword="searchKeyword = $event"
            @nav="onSearchNav"
            @toggle-history="toggleSearchHistoryPanel"
            @clear-history="onClearSearchHistory"
            @select-history="onSelectSearchHistory"
            @remove-history="onRemoveSearchHistory"
        />

        <SearchResults
            v-if="homeSearchDisplayState === 'results'"
            :results="rustSearchMergedResults"
            :get-launch-status="getLaunchStatus"
            :selected-index="selectedIndex"
            :keyword="searchKeyword"
            :show-shortcut-hints="showShortcutHints"
            :is-pending="isHomeSearchPending"
            :scanned-section="scannedFallbackSection"
            :command-results="commandSearchResults"
            :clipboard-results="clipboardSearchResults"
            :recent-file-results="recentFileSearchResults"
            @select="launchSearchWithCd"
            @select-command="launchCommandWithCd"
            @browser-search="onBrowserSearch"
            @select-scanned="onSelectScannedApp"
            @select-clipboard="selectClipboardWithCd"
            @select-recent-file="openRecentFileWithCd"
        />

        <template v-if="homeSearchDisplayState === 'home'">
            <div
                v-if="pinnedMergedItems.length > 0 || stableRecentDisplayItems.length > 0"
                class="home-sections"
                data-menu-type="Home"
            >
                <PinnedItems
                    :items="pinnedMergedItems"
                    :layout="pinnedLayout"
                    :get-launch-status="getLaunchStatus"
                    :start-index="0"
                    :show-shortcut-badge="showShortcutHints"
                    :selected-index="isHomeKeyboardNavActive && homeFocusRegion === 'pinned' ? homePinnedSelectedIndex : undefined"
                    @select="launchPinnedWithCd"
                    @reorder="onReorderPinnedItems"
                />

                <RecentItems
                    :items="stableRecentDisplayItems"
                    :layout="recentLayout"
                    :get-launch-status="getLaunchStatus"
                    :start-index="pinnedMergedItems.length"
                    :show-shortcut-badge="showShortcutHints"
                    :selected-index="isHomeKeyboardNavActive && homeFocusRegion === 'recent' ? homeRecentSelectedIndex : undefined"
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
                :selected-category-id="isHomeKeyboardNavActive && homeFocusRegion === 'category' ? homeSelectedCategoryId : null"
                @update:categories="onUpdateCategories"
                @update:editing-category-name="editingCategoryName = $event"
                @select="onClickCategory"
                @confirm-edit="onConfirmCategoryEdit"
                @cancel-edit="onCancelCategoryEdit"
            />
        </template>

        <SearchFallback
            v-else-if="homeSearchDisplayState === 'fallback'"
            :keyword="searchKeyword"
            @browser-search="onBrowserSearch"
        />

        <HomeExternalConvertGhost
            :visible="externalConvertDragVisible"
            :name="externalConvertDragName"
            :ghost-style="externalConvertGhostStyle"
        />
    </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from "vue";
import { onClickOutside } from "@vueuse/core";

import SearchResults from "../components/home/SearchResults.vue";
import SearchFallback from "../components/SearchFallback.vue";
import PinnedItems from "../components/home/PinnedItems.vue";
import RecentItems from "../components/home/RecentItems.vue";
import CategoryGrid from "../components/home/CategoryGrid.vue";

import HomeSearchBar from "./categories/HomeSearchBar.vue";
import HomeExternalConvertGhost from "./categories/HomeExternalConvertGhost.vue";

import { useSettingsStore, useUIStore } from "../stores";
import { useHomePageState } from "../composables/useHomePageState";
import type { PinnedMergedItem } from "../stores";
import type { HomeRecentDisplayItem } from "../composables/useHomePageState";
import { useHomeSearch } from "./categories/use-home-search";
import { useHomeGridNav } from "./categories/use-home-grid-nav";
import { useHomeExternalDrag, EXTERNAL_CONVERT_DRAG_EVENT } from "./categories/use-home-external-drag";
import {
    createHomeKeyboardHandlers,
    createRecentStabilizer,
    setupHomeWindowListeners,
    watchHomeIconHydration,
} from "./categories/use-home-lifecycle";

const settingsStore = useSettingsStore();
const uiStore = useUIStore();

const homeSearchBarRef = ref<InstanceType<typeof HomeSearchBar> | null>(null);
const searchBoxRef = ref<{ focus: () => void } | null>(null);
const searchShellRef = ref<HTMLElement | null>(null);

// Wire child component refs for focus / blur helpers.
function syncSearchBarRefs() {
    const bar = homeSearchBarRef.value;
    searchBoxRef.value = bar ? { focus: () => bar.focus() } : null;
    searchShellRef.value = bar?.searchShellRef ?? null;
}

const resetHomeKeyboardNavSlot = { current: () => {} };
const homeLaunchers = {
    current: {
        launchPinnedWithCd: (_item: PinnedMergedItem) => {},
        launchRecentWithCd: (_item: HomeRecentDisplayItem) => {},
    },
};

const homeSearch = useHomeSearch({
    settingsStore,
    searchBoxRef,
    resetHomeKeyboardNav: resetHomeKeyboardNavSlot,
    homeLaunchers: homeLaunchers as never,
});

const {
    searchKeyword,
    scannedFallbackSection,
    selectedIndex,
    isHomeSearchPending,
    isWindowFocused,
    showShortcutHints,
    windowVisibility,
    showSearchHistoryPanel,
    searchHistoryEntries,
    homeSearchViewState,
    homeSearchDisplayState,
    rustSearchMergedResults,
    commandSearchResults,
    clipboardSearchResults,
    recentFileSearchResults,
    getLaunchStatus,
    getSearchHistoryLabel,
    closeSearchHistoryPanel,
    toggleSearchHistoryPanel,
    onSelectSearchHistory,
    onRemoveSearchHistory,
    onClearSearchHistory,
    onBrowserSearch,
    onSelectScannedApp,
    onReorderPinnedItems,
    launchSearchWithCd,
    launchCommandWithCd,
    launchRecentWithCd,
    launchPinnedWithCd,
    selectClipboardWithCd,
    openRecentFileWithCd,
    onSearchNav,
    triggerSearchSelectionAt,
    clearSearchForEscape,
    homeNavHooks,
    hydrateVisibleSearchResultIcons,
    syncVisibleHydrationState,
    applyWindowShownReset,
    applyFocusGained,
    applyFocusLost,
    setWindowFocused,
    setWindowVisibility,
    onWindowBlur,
} = homeSearch;

const { pinnedMergedItems, mergedRecentDisplayItems } = useHomePageState();
const stableRecentDisplayItems = ref([...mergedRecentDisplayItems.value]);

const gridNav = useHomeGridNav({
    searchKeyword,
    homeSearchViewState,
    pinnedMergedItems,
    stableRecentDisplayItems,
    searchBoxRef,
    searchShellRef,
    launchPinned: (item: PinnedMergedItem) => { void homeSearch.launchPinnedWithCd(item); },
    launchRecent: (item: HomeRecentDisplayItem) => { void homeSearch.launchRecentWithCd(item); },
});

const {
    displayCategories,
    editingCategoryId,
    editingCategoryName,
    isEditingCategory,
    isNewCategory,
    categoryCols,
    pinnedLayout,
    recentLayout,
    isHomeKeyboardNavActive,
    homeFocusRegion,
    homePinnedSelectedIndex,
    homeRecentSelectedIndex,
    homeSelectedCategoryId,
    onClickCategory,
    onUpdateCategories,
    onConfirmCategoryEdit,
    onCancelCategoryEdit,
    resetHomeKeyboardNav,
    rotateHomeTabCycle,
    moveHomeSelectionByKey,
    triggerHomeSelection,
    onDocumentMouseDown,
} = gridNav;

resetHomeKeyboardNavSlot.current = resetHomeKeyboardNav;
homeNavHooks.current = {
    rotateHomeTabCycle,
    isHomeKeyboardNavActive: () => isHomeKeyboardNavActive.value,
    moveHomeSelectionByKey,
    triggerHomeSelection,
};

const externalDrag = useHomeExternalDrag();
const {
    externalConvertDragVisible,
    externalConvertDragName,
    externalConvertGhostStyle,
    onExternalConvertDragStart,
    onExternalConvertPointerMove,
    onExternalConvertPointerUp,
    cancelExternalConvertDrag,
} = externalDrag;

const { onKeydown, onKeyup } = createHomeKeyboardHandlers({
    searchKeyword,
    homeSearchViewState,
    showShortcutHints,
    showSearchHistoryPanel,
    pinnedMergedItems,
    stableRecentDisplayItems,
    totalSearchItemCount: homeSearch.totalSearchItemCount,
    selectedIndex,
    closeSearchHistoryPanel,
    clearSearchForEscape,
    triggerSearchSelectionAt,
    launchPinned: (item: PinnedMergedItem) => { void homeSearch.launchPinnedWithCd(item); },
    launchRecent: (item: HomeRecentDisplayItem) => { void homeSearch.launchRecentWithCd(item); },
    rotateHomeTabCycle,
    isHomeKeyboardNavActive: () => isHomeKeyboardNavActive.value,
    moveHomeSelectionByKey,
    triggerHomeSelection,
});

const stopRecentStabilizer = createRecentStabilizer(mergedRecentDisplayItems, stableRecentDisplayItems);

watchHomeIconHydration({
    pinnedMergedItems,
    mergedRecentDisplayItems,
    searchKeyword,
    windowVisibility,
    isWindowFocused,
    uiStore,
    store: homeSearch.store,
    syncVisibleHydrationState,
});

onClickOutside(searchShellRef, () => {
    if (showSearchHistoryPanel.value) {
        closeSearchHistoryPanel();
    }
});

let disposeWindowListeners: (() => void) | null = null;

onMounted(async () => {
    syncSearchBarRefs();
    if (searchKeyword.value === undefined) {
        /* keep reactive binding alive */
    }

    disposeWindowListeners = await setupHomeWindowListeners({
        onKeydown,
        onKeyup,
        onDocumentMouseDown,
        onWindowBlur: () => {
            onWindowBlur();
        },
        hydrateVisibleSearchResultIcons,
        applyWindowShownReset,
        applyFocusGained,
        applyFocusLost,
        setWindowFocused,
        setWindowVisibility,
        resetHomeKeyboardNav,
        externalConvertEvent: EXTERNAL_CONVERT_DRAG_EVENT,
        onExternalConvertDragStart: onExternalConvertDragStart as EventListener,
        onExternalConvertPointerMove: onExternalConvertPointerMove as EventListener,
        onExternalConvertPointerUp: onExternalConvertPointerUp as EventListener,
        cancelExternalConvertDrag,
    });

    nextTick(() => {
        syncSearchBarRefs();
        searchBoxRef.value?.focus();
        hydrateVisibleSearchResultIcons();
    });
});

onUnmounted(() => {
    stopRecentStabilizer();
    disposeWindowListeners?.();
    disposeWindowListeners = null;
});
</script>

<style lang="scss" scoped>
.categorie-view {
    width: 100vw;
    height: 100vh;
    background: var(--bg-color);
    display: flex;
    gap: 8px;
    flex-direction: column;
    user-select: none;
    border-radius: 12px;
}

.categorie-view.is-editing {
    pointer-events: none;
}

.home-sections {
    padding: 0 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex-shrink: 0;
}
</style>
