<template>
    <div
        class="categorie-view"
        :class="{ 'is-editing': isEditingCategory }"
    >
        <div class="search-header">
            <SearchBox
                ref="searchBoxRef"
                v-model="searchKeyword"
                placeholder="搜索启动项..."
            />
        </div>

        <SearchResults
            v-if="searchKeyword.trim() && globalSearchMergedResults.length > 0"
            :results="globalSearchMergedResults"
            :get-launch-status="getLaunchStatus"
            @select="throttledOnOpenSearchResult"
        />

        <div
            v-else-if="searchKeyword.trim() && globalSearchMergedResults.length === 0"
            class="no-results"
        >
            未找到匹配的启动项
        </div>

        <template v-else>
            <div
                v-if="pinnedMergedItems.length > 0 || recentMergedItems.length > 0"
                class="home-sections"
            >
                <PinnedItems
                    :items="pinnedMergedItems"
                    :layout="pinnedLayout"
                    :get-launch-status="getLaunchStatus"
                    @select="throttledOnOpenPinnedItem"
                    @reorder="onReorderPinnedItems"
                />

                <RecentItems
                    :items="recentMergedItems"
                    :layout="recentLayout"
                    :get-launch-status="getLaunchStatus"
                    @select="throttledOnOpenRecentItem"
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
import { openPath } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { useThrottleFn } from "@vueuse/core";

import SearchBox from "../components/SearchBox.vue";
import SearchResults from "../components/home/SearchResults.vue";
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

const store = Store();
const settingsStore = useSettingsStore();
const uiStore = useUIStore();
const categoryStore = useCategoryStore();
const router = useRouter();

const { searchKeyword, globalSearchMergedResults } = storeToRefs(store);
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

const { launchStatusMap, setLaunchStatus, clearLaunchStatus, getLaunchStatus } = useLaunchStatus({
    autoHideAfterLaunch,
});

let unlistenFocus: (() => void) | null = null;
let unlistenShow: (() => void) | null = null;

onMounted(async () => {
    const win = getCurrentWindow();

    unlistenFocus = await win.onFocusChanged(({ payload: focused }) => {
        if (focused) {
            nextTick(() => {
                searchBoxRef.value?.focus();
            });
        }
    });

    unlistenShow = await listen("window-shown", () => {
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
    categoryStore.confirmCategoryEdit(editingCategoryName.value);
}

function onCancelCategoryEdit() {
    categoryStore.cancelCategoryEdit();
}

async function onOpenSearchResult(result: GlobalSearchMergedResult) {
    store.recordItemUsage(result.primaryCategoryId, result.item.id);
    store.clearSearch();
    setLaunchStatus(result.item.id, "launching");
    try {
        await openPath(result.item.path);
        setLaunchStatus(result.item.id, "success");
    } catch (e) {
        console.error(e);
        clearLaunchStatus(result.item.id);
    }
}

async function onOpenRecentItem(item: RecentUsedMergedItem) {
    store.recordItemUsage(item.recent.categoryId, item.recent.itemId);
    setLaunchStatus(item.recent.itemId, "launching");
    try {
        await openPath(item.item.path);
        setLaunchStatus(item.recent.itemId, "success");
    } catch (e) {
        console.error(e);
        clearLaunchStatus(item.recent.itemId);
    }
}

async function onOpenPinnedItem(item: PinnedMergedItem) {
    store.recordItemUsage(item.primaryCategoryId, item.item.id);
    setLaunchStatus(item.item.id, "launching");
    try {
        await openPath(item.item.path);
        setLaunchStatus(item.item.id, "success");
    } catch (e) {
        console.error(e);
        clearLaunchStatus(item.item.id);
    }
}

function onReorderPinnedItems(newOrder: string[]) {
    store.reorderPinnedItemIds(newOrder);
}

const throttledOnOpenSearchResult = useThrottleFn(onOpenSearchResult, 2500, true, true);
const throttledOnOpenRecentItem = useThrottleFn(onOpenRecentItem, 2500, true, true);
const throttledOnOpenPinnedItem = useThrottleFn(onOpenPinnedItem, 2500, true, true);

watch(editingCategoryId, async (value) => {
    if (!value) return;
    await nextTick();
});
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
