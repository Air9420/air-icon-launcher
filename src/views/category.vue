<template>
    <div ref="categoryViewRef" class="category-view">
        <CategoryToolbar
            ref="toolbarRef"
            :title="title"
            :search-keyword="localSearchKeyword"
            :launcher-cols="launcherCols"
            :category-sort-mode="categorySortMode"
            :tab-region="tabRegion"
            @back="onBack"
            @update:search-keyword="localSearchKeyword = $event"
            @set-launcher-cols="uiStore.setLauncherCols($event)"
            @set-sort-mode="uiStore.setCategorySortMode($event)"
        />

        <template v-if="isSearchActive">
            <div
                v-if="categorySearchItems.length > 0"
                ref="searchResultsContainerRef"
                class="icon-container search-results-container"
                :class="{ 'has-selection': hasSelection }"
                :style="{ '--cols': launcherCols }"
                data-menu-type="Icon-View"
                :data-category-id="categoryId"
                @scroll.passive="scheduleVisibleIconHydration"
            >
                <CategoryIconItem
                    v-for="entry in categorySearchItems"
                    :key="entry.key"
                    :item="entry.item"
                    :category-id="categoryId"
                    :pinned="store.isItemPinned(entry.item.id)"
                    :selected="isItemSelected(entry.item.id)"
                    :keyboard-focus="isLauncherKeyboardNavActive && focusedLauncherItemId === entry.item.id"
                    :hide-name="hideName"
                    :launch-status="launchStatusMap.get(entry.item.id)"
                    @mousedown="onMouseDown"
                    @pointerdown="onPointerDown"
                    @pointerup="onPointerUp"
                    @pointerleave="onPointerLeave"
                />
            </div>
            <div
                v-else-if="!isCategorySearchPending"
                class="empty-tip"
                data-menu-type="Icon-View"
                :data-category-id="categoryId"
            >
                未找到匹配的启动项
            </div>
        </template>

        <template v-else>
            <draggable
                v-model="items"
                ref="iconContainerRef"
                item-key="id"
                class="icon-container"
                :class="{ 'has-selection': hasSelection }"
                :style="{ '--cols': launcherCols }"
                ghost-class="icon-ghost"
                chosen-class="icon-chosen"
                drag-class="icon-drag"
                :delay="200"
                :delay-on-touch-only="false"
                :animation="150"
                :force-fallback="true"
                fallback-class="icon-drag"
                :fallback-tolerance="5"
                :disabled="hasSelection || !isManualSort"
                data-menu-type="Icon-View"
                :data-category-id="categoryId"
                @scroll.passive="scheduleVisibleIconHydration"
            >
                <template #item="{ element }">
                    <CategoryIconItem
                        :item="element"
                        :category-id="categoryId"
                        :pinned="store.isItemPinned(element.id)"
                        :selected="isItemSelected(element.id)"
                        :keyboard-focus="isLauncherKeyboardNavActive && focusedLauncherItemId === element.id"
                        :hide-name="hideName"
                        :launch-status="launchStatusMap.get(element.id)"
                        @mousedown="onMouseDown"
                        @pointerdown="onPointerDown"
                        @pointerup="onPointerUp"
                        @pointerleave="onPointerLeave"
                    />
                </template>
            </draggable>

            <div
                v-if="items.length === 0"
                class="empty-tip"
                data-menu-type="Icon-View"
                :data-category-id="categoryId"
            >
                将文件/快捷方式拖进来即可添加到此类目
            </div>
        </template>

        <CategoryBulkActions
            :has-selection="hasSelection"
            :selected-count="selectedCount"
            :available-move-categories="availableMoveCategories"
            :active-bulk-panel="activeBulkPanel"
            :bulk-move-target-category-id="bulkMoveTargetCategoryId"
            :bulk-launch-delay-input="bulkLaunchDelayInput"
            @toggle-move="toggleMovePanel"
            @toggle-edit="toggleEditPanel"
            @delete-selected="onDeleteSelected"
            @clear-selection="clearSelection"
            @move-selected="onMoveSelected"
            @apply-bulk-edit="onApplyBulkEdit"
            @close-panel="closeBulkPanel"
            @update:bulk-move-target-category-id="bulkMoveTargetCategoryId = $event"
            @update:bulk-launch-delay-input="bulkLaunchDelayInput = $event"
        />
    </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watchEffect } from "vue";
import { useRouter } from "vue-router";
import draggable from "vuedraggable";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";

import { useLaunchCooldown } from "../composables/useLaunchCooldown";
import { useLaunchStatus } from "../composables/useLaunchStatus";
import { launchStoredItem } from "../utils/launcher-service";

import CategoryToolbar from "./category/CategoryToolbar.vue";
import CategoryIconItem from "./category/CategoryIconItem.vue";
import CategoryBulkActions from "./category/CategoryBulkActions.vue";
import { useCategoryItems } from "./category/use-category-items";
import { useCategorySelection } from "./category/use-category-selection";
import { useCategoryKeyboard, useCategoryPointer } from "./category/use-category-keyboard";

const props = defineProps<{
    categoryId: string;
}>();

const router = useRouter();
const toolbarRef = ref<InstanceType<typeof CategoryToolbar> | null>(null);

const categoryItems = useCategoryItems(() => props.categoryId);
const {
    store,
    uiStore,
    categoryStore,
    launcherCols,
    categorySortMode,
    autoHideAfterLaunch,
    localSearchKeyword,
    isCategorySearchPending,
    isWindowFocused,
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
    setWindowFocused,
    setWindowVisibility,
    clearSearchResults,
} = categoryItems;

const selection = useCategorySelection({
    categoryId: () => props.categoryId,
    items,
    itemById,
    store,
    categoryStore,
});
const {
    activeBulkPanel,
    bulkMoveTargetCategoryId,
    bulkLaunchDelayInput,
    hasSelection,
    selectedCount,
    availableMoveCategories,
    isItemSelected,
    clearSelection,
    toggleItemSelection,
    toggleMovePanel,
    toggleEditPanel,
    closeBulkPanel,
    onDeleteSelected,
    onMoveSelected,
    onApplyBulkEdit,
} = selection;

type LaunchStatus = "launching" | "success";
const launchStatusMap = ref<Map<string, LaunchStatus>>(new Map());
const { setLaunchStatus: setLaunchStatusWithHide } = useLaunchStatus({
    autoHideAfterLaunch,
});

function setLaunchStatus(itemId: string, status: LaunchStatus) {
    launchStatusMap.value.set(itemId, status);
    launchStatusMap.value = new Map(launchStatusMap.value);
    setLaunchStatusWithHide(itemId, status);
    if (status === "success") {
        setTimeout(() => {
            launchStatusMap.value.delete(itemId);
            launchStatusMap.value = new Map(launchStatusMap.value);
        }, 2000);
    }
}

async function onOpenItem(item: { id: string }) {
    if (!item) return;
    setLaunchStatus(item.id, "launching");
    try {
        await launchStoredItem(
            { categoryId: props.categoryId, itemId: item.id },
            { store, notifyError: true }
        );
        setLaunchStatus(item.id, "success");
    } catch (e) {
        console.error(e);
        launchStatusMap.value.delete(item.id);
        launchStatusMap.value = new Map(launchStatusMap.value);
    }
}

const { createCooldown } = useLaunchCooldown({ cooldown: 2500 });
const launchItemWithCd = createCooldown(onOpenItem);

function onBack() {
    resetTabCycleState();
    router.push("/categories");
}

const keyboard = useCategoryKeyboard({
    categoryId: () => props.categoryId,
    visibleLauncherItems,
    itemById,
    launcherCols,
    localSearchKeyword,
    categoryViewRef,
    searchBoxFocus: () => toolbarRef.value?.focusSearch(),
    backBtnFocus: () => toolbarRef.value?.focusBack(),
    onBack,
    launchItem: (item) => { void launchItemWithCd(item); },
    resetSelection: clearSelection,
    resetSearchForCategoryChange,
    rerunSearchAfterCategoryChange,
});
const {
    tabRegion,
    isLauncherKeyboardNavActive,
    focusedLauncherItemId,
    resetTabCycleState,
    onCategoryKeydown,
    onCategoryMouseDown,
} = keyboard;

const pointer = useCategoryPointer({
    isWindowFocused,
    hasSelection,
    itemById,
    toggleItemSelection,
    launchItem: (item) => { void launchItemWithCd(item); },
});
const { onMouseDown, onPointerDown, onPointerUp, onPointerLeave } = pointer;

watchEffect(() => {
    categoryStore.setCurrentCategory(props.categoryId);
});

let unlistenFocus: (() => void) | null = null;
let unlistenShow: (() => void) | null = null;
let resizeObserver: ResizeObserver | null = null;
let removeWindowResizeListener: (() => void) | null = null;

onMounted(async () => {
    const win = getCurrentWindow();
    try {
        setWindowVisibility((await win.isVisible()) ? "visible" : "hidden");
        setWindowFocused(await win.isFocused());
    } catch {
        setWindowVisibility("visible");
        setWindowFocused(true);
    }

    unlistenFocus = await win.onFocusChanged(({ payload: focused }) => {
        setWindowFocused(focused);
        if (focused) {
            setWindowVisibility("visible");
            nextTick(() => {
                toolbarRef.value?.focusSearch();
            });
        } else {
            setWindowVisibility("hidden");
        }
    });

    unlistenShow = await listen("window-shown", () => {
        setWindowVisibility("visible");
        setWindowFocused(true);
        clearSearchResults();
        resetTabCycleState();
        nextTick(() => {
            toolbarRef.value?.focusSearch();
        });
    });

    document.addEventListener("keydown", onCategoryKeydown, true);
    document.addEventListener("mousedown", onCategoryMouseDown, true);

    const onResize = () => {
        scheduleVisibleIconHydration();
    };
    if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(() => {
            scheduleVisibleIconHydration();
        });
        if (categoryViewRef.value) {
            resizeObserver.observe(categoryViewRef.value);
        }
    } else {
        window.addEventListener("resize", onResize);
        removeWindowResizeListener = () => {
            window.removeEventListener("resize", onResize);
        };
    }

    nextTick(() => {
        resetTabCycleState();
        toolbarRef.value?.focusSearch();
        scheduleVisibleIconHydration();
    });
});

onUnmounted(() => {
    if (unlistenFocus) unlistenFocus();
    if (unlistenShow) unlistenShow();
    resizeObserver?.disconnect();
    removeWindowResizeListener?.();
    document.removeEventListener("keydown", onCategoryKeydown, true);
    document.removeEventListener("mousedown", onCategoryMouseDown, true);
});
</script>

<style lang="scss" scoped>
.category-view {
    width: 100vw;
    height: 100vh;
    display: flex;
    flex-direction: column;
    position: relative;
    background: var(--bg-color);
}

.icon-container {
    flex: 1;
    min-height: 0;
    display: grid;
    padding: 16px;
    --gap: 14px;
    --cols: 5;
    gap: var(--gap);
    align-content: flex-start;
    grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
    grid-auto-rows: max-content;
    overflow-y: scroll;
    -ms-overflow-style: none;

    &::-webkit-scrollbar {
        display: none;
    }
}

.icon-container.has-selection {
    padding-bottom: 128px;
}

.search-results-container {
    cursor: default;
}

.empty-tip {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-color-secondary);
    font-size: 14px;
}
</style>
