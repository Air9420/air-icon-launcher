<template>
    <div
        class="categorie-view"
        :class="{ 'is-editing': isEditingCategory }"
        @keydown="onKeydown"
        tabindex="0"
    >
        <div class="search-header">
            <SearchBox
                ref="searchBoxRef"
                v-model="searchKeyword"
                placeholder="搜索启动项..."
                @nav="onSearchNav"
            />
        </div>

        <SearchResults
            v-if="searchKeyword.trim() && (isRustSearchReady ? rustSearchMergedResults.length > 0 : globalSearchMergedResults.length > 0)"
            :results="isRustSearchReady ? rustSearchMergedResults : globalSearchMergedResults"
            :get-launch-status="getLaunchStatus"
            :selected-index="selectedIndex"
            @select="launchSearchWithCd"
        />

        <SearchFallback
            v-else-if="searchKeyword.trim() && (isRustSearchReady ? rustSearchMergedResults.length === 0 : globalSearchMergedResults.length === 0)"
            :keyword="searchKeyword"
            @browser-search="onBrowserSearch"
        />

        <template v-else>
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
                :categories="categories"
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
    </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
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
import { useLaunchStatus } from "../composables/useLaunchStatus";
import { showToast } from "../composables/useGlobalToast";
import { invokeOrThrow } from "../utils/invoke-wrapper";
import { launchStoredItem } from "../utils/launcher-service";

const store = Store();
const settingsStore = useSettingsStore();
const uiStore = useUIStore();
const categoryStore = useCategoryStore();
const router = useRouter();

const {
    searchKeyword,
    globalSearchMergedResults,
    rustSearchMergedResults,
    isRustSearchReady,
} = storeToRefs(store);
const { categoryCols } = storeToRefs(uiStore);
const {
    categories,
    editingCategoryId,
    editingCategoryName,
    isEditingCategory,
    isNewCategory,
} = storeToRefs(categoryStore);
const { autoHideAfterLaunch } = storeToRefs(settingsStore);

const searchBoxRef = ref<InstanceType<typeof SearchBox> | null>(null);

const selectedIndex = ref(-1);

const { setLaunchStatus, clearLaunchStatus, getLaunchStatus } = useLaunchStatus({
    autoHideAfterLaunch,
});

let unlistenFocus: (() => void) | null = null;
let unlistenShow: (() => void) | null = null;

onMounted(async () => {
    const win = getCurrentWindow();

    await store.syncSearchIndex();

    unlistenFocus = await win.onFocusChanged(({ payload: focused }) => {
        if (focused) {
            nextTick(() => {
                searchBoxRef.value?.focus();
            });
        }
    });

    unlistenShow = await listen("window-shown", () => {
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

watch(searchKeyword, async (keyword) => {
    if (!keyword.trim()) return;
    if (!isRustSearchReady.value) return;
    await store.rustSearch(keyword);
});

watch(searchKeyword, () => {
    selectedIndex.value = -1;
});

const currentSearchResults = computed(() => {
    return isRustSearchReady.value ? rustSearchMergedResults.value : globalSearchMergedResults.value;
});

function onKeydown(e: KeyboardEvent) {
    if (!searchKeyword.value.trim() || currentSearchResults.value.length === 0) {
        return;
    }

    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter") {
        return;
    }
}

function onSearchNav(direction: "up" | "down" | "enter") {
    if (!searchKeyword.value.trim() || currentSearchResults.value.length === 0) {
        return;
    }

    if (direction === "down") {
        if (selectedIndex.value < currentSearchResults.value.length - 1) {
            selectedIndex.value++;
        } else {
            selectedIndex.value = 0;
        }
    } else if (direction === "up") {
        if (selectedIndex.value > 0) {
            selectedIndex.value--;
        } else {
            selectedIndex.value = currentSearchResults.value.length - 1;
        }
    } else if (direction === "enter") {
        if (selectedIndex.value >= 0 && selectedIndex.value < currentSearchResults.value.length) {
            const result = currentSearchResults.value[selectedIndex.value];
            launchSearchWithCd(result);
        }
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
