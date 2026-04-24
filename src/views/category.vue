<template>
    <div class="category-view">
        <header class="category-header" data-tauri-drag-region>
            <button class="back-btn" type="button" @click="onBack" @mousedown.stop>
                返回
            </button>
            <div class="category-title" data-tauri-drag-region>
                {{ title }}
            </div>
            <div class="header-search">
                <SearchBox ref="searchBoxRef" v-model="localSearchKeyword" placeholder="搜索启动项..." />
            </div>
        </header>

        <template v-if="isSearchActive">
            <div
                v-if="categorySearchItems.length > 0"
                class="icon-container search-results-container"
                :class="{ 'has-selection': hasSelection }"
                :style="{ '--cols': launcherCols }"
                data-menu-type="Icon-View"
                :data-category-id="categoryId"
            >
                <div
                    v-for="entry in categorySearchItems"
                    :key="entry.key"
                    class="icon-item"
                    :class="{
                        'is-pinned': isItemPinned(entry.item.id),
                        'is-selected': isItemSelected(entry.item.id),
                    }"
                    data-menu-type="Icon-Item"
                    :data-category-id="categoryId"
                    :data-item-id="entry.item.id"
                    @mousedown="onMouseDown(entry.item.id, $event)"
                    @pointerdown="onPointerDown(entry.item.id, $event)"
                    @pointerup="onPointerUp(entry.item.id, $event)"
                    @pointerleave="onPointerLeave"
                    @pointercancel="onPointerLeave"
                >
                    <div class="icon-img">
                        <img
                            v-if="entry.item.iconBase64"
                            class="icon-real"
                            :src="getIconSrc(entry.item.iconBase64)"
                            alt=""
                            draggable="false"
                        />
                        <div v-else class="icon-fallback">
                            {{ getFallbackText(entry.item.name) }}
                        </div>
                    </div>
                    <div
                        v-if="entry.item.itemType === 'url' || hasLaunchDependencies(entry.item)"
                        class="url-badge"
                    >
                        {{ entry.item.itemType === "url" ? "URL" : "依赖" }}
                    </div>
                    <div v-if="isItemPinned(entry.item.id)" class="pinned-badge">
                        📌
                    </div>
                    <div v-if="!hideName" class="icon-name" :title="entry.item.name">
                        {{ entry.item.name }}
                    </div>
                    <div v-if="launchStatusMap.get(entry.item.id) === 'launching'" class="launch-status launching">
                        <span class="spinner"></span>
                    </div>
                    <div v-if="launchStatusMap.get(entry.item.id) === 'success'" class="launch-status success">
                        <span class="check-icon">✓</span>
                    </div>
                </div>
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
                :disabled="hasSelection"
                data-menu-type="Icon-View"
                :data-category-id="categoryId"
            >
                <template #item="{ element }">
                    <div
                        class="icon-item"
                        :class="{
                            'is-pinned': isItemPinned(element.id),
                            'is-selected': isItemSelected(element.id),
                        }"
                        data-menu-type="Icon-Item"
                        :data-category-id="categoryId"
                        :data-item-id="element.id"
                        @mousedown="onMouseDown(element.id, $event)"
                        @pointerdown="onPointerDown(element.id, $event)"
                        @pointerup="onPointerUp(element.id, $event)"
                        @pointerleave="onPointerLeave"
                        @pointercancel="onPointerLeave"
                    >
                        <div class="icon-img">
                            <img
                                v-if="element.iconBase64"
                                class="icon-real"
                                :src="getIconSrc(element.iconBase64)"
                                alt=""
                                draggable="false"
                            />
                            <div v-else class="icon-fallback">
                                {{ getFallbackText(element.name) }}
                            </div>
                        </div>
                        <div
                            v-if="element.itemType === 'url' || hasLaunchDependencies(element)"
                            class="url-badge"
                        >
                            {{ element.itemType === "url" ? "URL" : "依赖" }}
                        </div>
                        <div v-if="isItemPinned(element.id)" class="pinned-badge">
                            📌
                        </div>
                        <div v-if="!hideName" class="icon-name" :title="element.name">
                            {{ element.name }}
                        </div>
                        <div v-if="launchStatusMap.get(element.id) === 'launching'" class="launch-status launching">
                            <span class="spinner"></span>
                        </div>
                        <div v-if="launchStatusMap.get(element.id) === 'success'" class="launch-status success">
                            <span class="check-icon">✓</span>
                        </div>
                    </div>
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

        <div v-if="hasSelection" class="bulk-action-bar">
            <div class="bulk-action-main">
                <div class="bulk-selection-summary">
                    已选 {{ selectedCount }} 项
                </div>
                <div class="bulk-action-buttons">
                    <button
                        class="bulk-action-btn"
                        type="button"
                        :disabled="availableMoveCategories.length === 0"
                        @click="toggleMovePanel"
                    >
                        移动到
                    </button>
                    <button
                        class="bulk-action-btn"
                        type="button"
                        @click="toggleEditPanel"
                    >
                        批量编辑
                    </button>
                    <button
                        class="bulk-action-btn danger"
                        type="button"
                        @click="onDeleteSelected"
                    >
                        删除
                    </button>
                    <button
                        class="bulk-action-btn ghost"
                        type="button"
                        @click="clearSelection"
                    >
                        取消选择
                    </button>
                </div>
            </div>

            <div v-if="activeBulkPanel === 'move'" class="bulk-action-panel">
                <select v-model="bulkMoveTargetCategoryId" class="bulk-select">
                    <option value="" disabled>选择目标分类</option>
                    <option
                        v-for="category in availableMoveCategories"
                        :key="category.id"
                        :value="category.id"
                    >
                        {{ category.name }}
                    </option>
                </select>
                <button
                    class="bulk-action-btn primary"
                    type="button"
                    :disabled="!bulkMoveTargetCategoryId"
                    @click="onMoveSelected"
                >
                    确认移动
                </button>
                <button
                    class="bulk-action-btn ghost"
                    type="button"
                    @click="closeBulkPanel"
                >
                    取消
                </button>
            </div>

            <div v-else-if="activeBulkPanel === 'edit'" class="bulk-action-panel">
                <label class="bulk-input-label">
                    <span>启动延迟（秒）</span>
                    <input
                        :value="bulkLaunchDelayInput"
                        class="bulk-input"
                        type="number"
                        min="0"
                        step="1"
                        @input="onBulkDelayInput"
                    />
                </label>
                <button
                    class="bulk-action-btn primary"
                    type="button"
                    @click="onApplyBulkEdit"
                >
                    应用
                </button>
                <button
                    class="bulk-action-btn ghost"
                    type="button"
                    @click="closeBulkPanel"
                >
                    取消
                </button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {
    computed,
    nextTick,
    onMounted,
    onUnmounted,
    ref,
    watch,
    watchEffect,
} from "vue";
import { storeToRefs } from "pinia";
import { useRouter } from "vue-router";
import draggable from "vuedraggable";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { useThrottleFn } from "@vueuse/core";

import { useConfirmDialog } from "../composables/useConfirmDialog";
import { useGlobalToast } from "../composables/useGlobalToast";
import { useLaunchCooldown } from "../composables/useLaunchCooldown";
import { Store } from "../stores";
import { useUIStore } from "../stores/uiStore";
import { useCategoryStore } from "../stores/categoryStore";
import type { LauncherItem, RustSearchResult } from "../stores/launcherStore";
import SearchBox from "../components/SearchBox.vue";
import { launchStoredItem } from "../utils/launcher-service";
import { SEARCH_THROTTLE_MS } from "../utils/search-config";

const props = defineProps<{
    categoryId: string;
}>();

type CategorySearchEntry = {
    item: LauncherItem;
    key: string;
};

const router = useRouter();
const store = Store();
const uiStore = useUIStore();
const categoryStore = useCategoryStore();
const { launcherCols } = storeToRefs(uiStore);
const localSearchKeyword = ref<string>("");
const categorySearchResults = ref<RustSearchResult[]>([]);
const isCategorySearchPending = ref(false);
const searchBoxRef = ref<InstanceType<typeof SearchBox> | null>(null);
const selectedItemIds = ref<string[]>([]);
const activeBulkPanel = ref<"move" | "edit" | null>(null);
const bulkMoveTargetCategoryId = ref("");
const bulkLaunchDelayInput = ref("0");
const isWindowFocused = ref(true);
const { confirm } = useConfirmDialog();
const { showToast } = useGlobalToast();

type LaunchStatus = "launching" | "success";
const launchStatusMap = ref<Map<string, LaunchStatus>>(new Map());
const hideName = computed(() => (launcherCols.value ?? 5) >= 6);
const isSearchActive = computed(() => localSearchKeyword.value.trim().length > 0);

function setLaunchStatus(itemId: string, status: LaunchStatus) {
    launchStatusMap.value.set(itemId, status);
    launchStatusMap.value = new Map(launchStatusMap.value);
    if (status === "success") {
        setTimeout(() => {
            launchStatusMap.value.delete(itemId);
            launchStatusMap.value = new Map(launchStatusMap.value);
        }, 2000);
    }
}

let unlistenFocus: (() => void) | null = null;
let unlistenShow: (() => void) | null = null;
let ensureIndexPromise: Promise<void> | null = null;
let categorySearchRequestId = 0;
let categorySearchContextId = 0;

onMounted(async () => {
    const win = getCurrentWindow();
    try {
        isWindowFocused.value = await win.isFocused();
    } catch {
        isWindowFocused.value = true;
    }

    unlistenFocus = await win.onFocusChanged(({ payload: focused }) => {
        isWindowFocused.value = focused;
        if (focused) {
            nextTick(() => {
                searchBoxRef.value?.focus();
            });
        }
    });

    unlistenShow = await listen("window-shown", () => {
        localSearchKeyword.value = "";
        categorySearchResults.value = [];
        isCategorySearchPending.value = false;
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

const title = computed(() => {
    const category = categoryStore.getCategoryById(props.categoryId);
    return category?.name || "未命名类目";
});

const items = computed<LauncherItem[]>({
    get() {
        const rawItems = store.getLauncherItemsByCategoryId(props.categoryId);
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
        store.setLauncherItemsByCategoryId(props.categoryId, value);
    },
});

const itemById = computed(() => new Map(items.value.map((item) => [item.id, item] as const)));
const selectedItemIdSet = computed(() => new Set(selectedItemIds.value));
const selectedItems = computed(() => {
    return selectedItemIds.value
        .map((itemId) => itemById.value.get(itemId))
        .filter((item): item is LauncherItem => item !== undefined);
});
const hasSelection = computed(() => selectedItemIds.value.length > 0);
const selectedCount = computed(() => selectedItemIds.value.length);
const availableMoveCategories = computed(() => {
    return categoryStore.categories.filter((category) => category.id !== props.categoryId);
});
const categorySearchItems = computed<CategorySearchEntry[]>(() => {
    return categorySearchResults.value
        .map((result) => {
            const item = itemById.value.get(result.id);
            if (!item) return null;
            return {
                item,
                key: `${props.categoryId}:${result.id}`,
            };
        })
        .filter((entry): entry is CategorySearchEntry => entry !== null);
});

watch(
    items,
    (list) => {
        const targets = list.map((item) => ({
            categoryId: props.categoryId,
            itemId: item.id,
        }));
        void store.hydrateMissingIconsForItems(targets);
    },
    { immediate: true }
);

watch(
    itemById,
    (nextMap) => {
        const nextSelected = selectedItemIds.value.filter((itemId) => nextMap.has(itemId));
        if (nextSelected.length !== selectedItemIds.value.length) {
            selectedItemIds.value = nextSelected;
        }
    },
    { immediate: true }
);

watch(hasSelection, (value) => {
    if (!value) {
        activeBulkPanel.value = null;
    }
});

watch(
    availableMoveCategories,
    (categories) => {
        const hasCurrentTarget = categories.some(
            (category) => category.id === bulkMoveTargetCategoryId.value
        );
        if (!hasCurrentTarget) {
            bulkMoveTargetCategoryId.value = categories[0]?.id ?? "";
        }
    },
    { immediate: true }
);

watch(
    categorySearchItems,
    (results) => {
        if (!isSearchActive.value || results.length === 0) return;
        const targets = results.map((entry) => ({
            categoryId: props.categoryId,
            itemId: entry.item.id,
        }));
        void store.hydrateMissingIconsForItems(targets);
    },
    { immediate: true }
);

function isItemPinned(itemId: string): boolean {
    return store.isItemPinned(itemId);
}

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
            categoryId: props.categoryId,
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

watch(
    () => props.categoryId,
    async () => {
        clearSelection();
        categorySearchContextId += 1;
        categorySearchRequestId += 1;
        categorySearchResults.value = [];
        isCategorySearchPending.value = false;

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
);

watchEffect(() => {
    categoryStore.setCurrentCategory(props.categoryId);
});

function onBack() {
    router.push("/categories");
}

function isItemSelected(itemId: string): boolean {
    return selectedItemIdSet.value.has(itemId);
}

function clearSelection() {
    selectedItemIds.value = [];
    activeBulkPanel.value = null;
}

function toggleItemSelection(itemId: string) {
    if (selectedItemIdSet.value.has(itemId)) {
        selectedItemIds.value = selectedItemIds.value.filter((id) => id !== itemId);
        return;
    }

    selectedItemIds.value = [...selectedItemIds.value, itemId];
}

function toggleMovePanel() {
    if (availableMoveCategories.value.length === 0) return;

    if (activeBulkPanel.value === "move") {
        activeBulkPanel.value = null;
        return;
    }

    bulkMoveTargetCategoryId.value =
        bulkMoveTargetCategoryId.value || availableMoveCategories.value[0]?.id || "";
    activeBulkPanel.value = "move";
}

function toggleEditPanel() {
    if (activeBulkPanel.value === "edit") {
        activeBulkPanel.value = null;
        return;
    }

    const firstDelay = selectedItems.value[0]?.launchDelaySeconds ?? 0;
    const isSameDelay = selectedItems.value.every(
        (item) => item.launchDelaySeconds === firstDelay
    );
    bulkLaunchDelayInput.value = isSameDelay ? String(firstDelay) : "0";
    activeBulkPanel.value = "edit";
}

function closeBulkPanel() {
    activeBulkPanel.value = null;
}

async function onDeleteSelected() {
    if (!hasSelection.value) return;

    const count = selectedCount.value;
    const confirmed = await confirm({
        title: "批量删除启动项",
        message: `确定要删除已选中的 ${count} 个启动项吗？`,
        confirmText: "删除",
        cancelText: "取消",
    });

    if (!confirmed) return;

    store.deleteLauncherItems(props.categoryId, selectedItemIds.value);
    clearSelection();
    showToast(`已删除 ${count} 个启动项`);
}

function onMoveSelected() {
    if (!hasSelection.value || !bulkMoveTargetCategoryId.value) return;

    const count = selectedCount.value;
    const targetCategory = categoryStore.getCategoryById(bulkMoveTargetCategoryId.value);
    store.moveLauncherItems(
        props.categoryId,
        bulkMoveTargetCategoryId.value,
        selectedItemIds.value
    );
    clearSelection();
    showToast(
        targetCategory
            ? `已移动 ${count} 个启动项到“${targetCategory.name}”`
            : `已移动 ${count} 个启动项`
    );
}

function onBulkDelayInput(event: Event) {
    const target = event.target as HTMLInputElement;
    bulkLaunchDelayInput.value = target.value;
}

function onApplyBulkEdit() {
    if (!hasSelection.value) return;

    const count = selectedCount.value;
    const parsedDelay = Number(bulkLaunchDelayInput.value);
    const normalizedDelay = Number.isFinite(parsedDelay)
        ? Math.max(0, Math.floor(parsedDelay))
        : 0;

    store.updateLauncherItems(props.categoryId, selectedItemIds.value, {
        launchDelaySeconds: normalizedDelay,
    });
    clearSelection();
    bulkLaunchDelayInput.value = String(normalizedDelay);
    showToast(`已批量设置 ${count} 个启动项`);
}

async function onOpenItem(item: LauncherItem) {
    if (!item) return;

    setLaunchStatus(item.id, "launching");
    try {
        await launchStoredItem(
            {
                categoryId: props.categoryId,
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
        launchStatusMap.value.delete(item.id);
        launchStatusMap.value = new Map(launchStatusMap.value);
    }
}

const { createCooldown } = useLaunchCooldown({ cooldown: 2500 });
const launchItemWithCd = createCooldown(onOpenItem);

let pressTimer: ReturnType<typeof setTimeout> | null = null;
let pressedItemId: string | null = null;
let pointerMode: "launch" | "select" | null = null;
let selectionHandledOnMouseDownItemId: string | null = null;
let suppressDragForCurrentPress = false;
const PRESS_THRESHOLD = 200;

function clearPointerState() {
    if (pressTimer) {
        clearTimeout(pressTimer);
    }
    pressTimer = null;
    pressedItemId = null;
    pointerMode = null;
    suppressDragForCurrentPress = false;
}

function hasSelectionModifier(event: PointerEvent): boolean {
    return event.ctrlKey || event.metaKey;
}

function hasMouseSelectionModifier(event: MouseEvent): boolean {
    return event.ctrlKey || event.metaKey;
}

function onMouseDown(itemId: string, event: MouseEvent) {
    if (event.button !== 0) return;
    suppressDragForCurrentPress = !isWindowFocused.value;

    if (!hasSelection.value && !hasMouseSelectionModifier(event)) return;

    event.stopPropagation();
    clearPointerState();
    suppressDragForCurrentPress = !isWindowFocused.value;
    selectionHandledOnMouseDownItemId = itemId;
    toggleItemSelection(itemId);
}

function onPointerDown(itemId: string, e: PointerEvent) {
    if (e.button !== 0) return;
    const selectionHandledOnMouseDown = selectionHandledOnMouseDownItemId === itemId;
    if (
        selectionHandledOnMouseDown ||
        suppressDragForCurrentPress ||
        hasSelection.value ||
        hasSelectionModifier(e)
    ) {
        e.stopPropagation();
    }

    if (selectionHandledOnMouseDown) {
        clearPointerState();
        return;
    }

    clearPointerState();
    suppressDragForCurrentPress = !isWindowFocused.value;
    pressedItemId = itemId;

    if (hasSelection.value || hasSelectionModifier(e)) {
        pointerMode = "select";
        return;
    }

    pointerMode = "launch";
    pressTimer = setTimeout(() => {
        clearPointerState();
    }, PRESS_THRESHOLD);
}

function onPointerUp(itemId: string, e: PointerEvent) {
    if (e.button !== 0) return;
    if (selectionHandledOnMouseDownItemId === itemId) {
        selectionHandledOnMouseDownItemId = null;
        clearPointerState();
        return;
    }

    if (pressedItemId !== itemId) {
        clearPointerState();
        return;
    }

    if (pointerMode === "select") {
        toggleItemSelection(itemId);
        clearPointerState();
        return;
    }

    if (pressTimer && pointerMode === "launch") {
        clearTimeout(pressTimer);
        pressTimer = null;
        const item = itemById.value.get(itemId);
        if (item) {
            launchItemWithCd(item);
        }
    }

    clearPointerState();
}

function onPointerLeave() {
    selectionHandledOnMouseDownItemId = null;
    clearPointerState();
}

function getIconSrc(iconBase64: string) {
    if (iconBase64.startsWith("data:")) return iconBase64;
    return `data:image/png;base64,${iconBase64}`;
}

function getFallbackText(name: string) {
    const text = name.trim();
    if (!text) return "?";
    return text.slice(0, 1).toUpperCase();
}

function hasLaunchDependencies(item: LauncherItem): boolean {
    return Array.isArray(item.launchDependencies) && item.launchDependencies.length > 0;
}
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

.category-header {
    height: 52px;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 12px;
    background: var(--card-bg);
    border-bottom: 1px solid var(--border-color);
    backdrop-filter: var(--backdrop-blur);
    user-select: none;
}

.back-btn {
    border: 0;
    padding: 8px 10px;
    border-radius: 10px;
    background: var(--hover-bg);
    cursor: pointer;
    -webkit-app-region: no-drag;
    color: var(--text-color);
}

.back-btn:hover {
    background: var(--hover-bg-strong);
}

.category-title {
    font-size: 16px;
    font-weight: 700;
    color: var(--text-color);
}

.header-search {
    margin-left: auto;
    width: 200px;
    -webkit-app-region: no-drag;
}

.icon-container {
    flex: 1;
    display: grid;
    padding: 16px;
    --gap: 14px;
    --cols: 5;
    gap: var(--gap);
    align-content: flex-start;
    grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
    grid-auto-rows: max-content;
    height: calc(100vh - 52px - 32px);
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

.icon-item {
    padding: min(8px, 5%);
    border-radius: 18px;
    border: 2px solid transparent;
    background: var(--card-bg);
    box-shadow: var(--card-shadow);
    user-select: none;
    opacity: 0.92;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-evenly;
    aspect-ratio: 1 / 1;
    position: relative;
}

.icon-item.is-pinned {
    border: 2px solid var(--primary-color);
    opacity: 1;
}

.icon-item.is-selected {
    opacity: 1;
    border-color: var(--primary-color);
    background: var(--hover-bg);
}

.icon-img {
    width: 50%;
    aspect-ratio: 1 / 1;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
}

.pinned-badge {
    position: absolute;
    top: 5px;
    right: 5px;
    font-size: 12px;
    line-height: 1;
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.3));
}

.url-badge {
    position: absolute;
    top: 8px;
    left: 8px;
    padding: 1px 4px;
    font-size: 8px;
    font-weight: 600;
    color: #fff;
    background: #3b82f6;
    border-radius: 4px;
    z-index: 1;
}

.icon-real {
    width: 100%;
    height: 100%;
    object-fit: contain;
}

.icon-fallback {
    width: 100%;
    height: 100%;
    border-radius: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--icon-fallback-bg);
    font-weight: 800;
    color: var(--icon-fallback-text);
}

.icon-name {
    width: 100%;
    text-align: center;
    font-size: 12px;
    color: var(--icon-name-color);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}

.launch-status {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
}

.launch-status.launching {
    .spinner {
        width: 12px;
        height: 12px;
        border: 2px solid var(--text-color-tertiary);
        border-top-color: var(--primary-color, #0078d4);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
    }
}

.launch-status.success {
    animation: fadeOut 0.5s ease 1.5s forwards;

    .check-icon {
        color: var(--success-color, #4caf50);
        font-size: 14px;
        font-weight: bold;
    }
}

@keyframes spin {
    to {
        transform: rotate(360deg);
    }
}

@keyframes fadeOut {
    to {
        opacity: 0;
    }
}

.icon-ghost {
    opacity: 0.45;
}

.icon-chosen,
.icon-drag {
    cursor: grabbing;
}

.empty-tip {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    padding: 10px 14px;
    border-radius: 12px;
    background: var(--card-bg);
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
    font-size: 13px;
    pointer-events: none;
}

.bulk-action-bar {
    position: absolute;
    left: 16px;
    right: 16px;
    bottom: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px 16px;
    border-radius: 18px;
    background: rgba(var(--floating-panel-rgb), var(--floating-panel-opacity));
    border: 1px solid var(--floating-panel-border);
    box-shadow: var(--floating-panel-shadow);
    backdrop-filter: var(--backdrop-blur);
    z-index: 10;
}

.bulk-action-main {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
}

.bulk-selection-summary {
    font-size: 14px;
    font-weight: 700;
    color: var(--text-color);
}

.bulk-action-buttons,
.bulk-action-panel {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}

.bulk-action-panel {
    padding-top: 12px;
    border-top: 1px solid var(--floating-panel-border);
}

.bulk-action-btn {
    border: 0;
    padding: 8px 12px;
    border-radius: 10px;
    background: rgba(var(--floating-control-rgb), var(--floating-control-opacity));
    color: var(--text-color);
    cursor: pointer;
}

.bulk-action-btn:hover:not(:disabled) {
    background: rgba(var(--floating-control-rgb), var(--floating-control-hover-opacity));
}

.bulk-action-btn.primary {
    background: var(--primary-color);
    color: #fff;
}

.bulk-action-btn.danger {
    background: var(--danger-color, #ef4444);
    color: #fff;
}

.bulk-action-btn.ghost {
    background: transparent;
    border: 1px solid var(--floating-panel-border);
}

.bulk-action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.bulk-select,
.bulk-input {
    min-width: 160px;
    padding: 8px 10px;
    border-radius: 10px;
    border: 1px solid var(--floating-panel-border);
    color: var(--text-color);
}

.bulk-select {
    background: var(--menu-bg);
}

.bulk-select option,
.bulk-select optgroup {
    background: var(--menu-bg);
    color: var(--text-color);
}

.bulk-select option:disabled {
    color: var(--text-secondary);
}

.bulk-input {
    background: rgba(var(--floating-control-rgb), var(--floating-control-opacity));
}

.bulk-input-label {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-secondary);
}
</style>
