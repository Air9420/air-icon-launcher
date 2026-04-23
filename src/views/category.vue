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
                :style="{ '--cols': launcherCols }"
                data-menu-type="Icon-View"
                :data-category-id="categoryId"
            >
                <div
                    v-for="entry in categorySearchItems"
                    :key="entry.key"
                    class="icon-item"
                    :class="{ 'is-pinned': isItemPinned(entry.item.id) }"
                    data-menu-type="Icon-Item"
                    :data-category-id="categoryId"
                    :data-item-id="entry.item.id"
                    @pointerdown="onPointerDown(entry.item.id, $event)"
                    @pointerup="onPointerUp(entry.item.id)"
                    @pointerleave="onPointerLeave"
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
                data-menu-type="Icon-View"
                :data-category-id="categoryId"
            >
                <template #item="{ element }">
                    <div
                        class="icon-item"
                        :class="{ 'is-pinned': isItemPinned(element.id) }"
                        data-menu-type="Icon-Item"
                        :data-category-id="categoryId"
                        :data-item-id="element.id"
                        @pointerdown="onPointerDown(element.id, $event)"
                        @pointerup="onPointerUp(element.id)"
                        @pointerleave="onPointerLeave"
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

    unlistenFocus = await win.onFocusChanged(({ payload: focused }) => {
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
const PRESS_THRESHOLD = 200;

function onPointerDown(itemId: string, e: PointerEvent) {
    if (e.button !== 0) return;
    pressedItemId = itemId;
    pressTimer = setTimeout(() => {
        pressedItemId = null;
        pressTimer = null;
    }, PRESS_THRESHOLD);
}

function onPointerUp(itemId: string) {
    if (pressTimer && pressedItemId === itemId) {
        clearTimeout(pressTimer);
        pressTimer = null;
        const item = itemById.value.get(itemId);
        if (item) {
            launchItemWithCd(item);
        }
        pressedItemId = null;
    }
}

function onPointerLeave() {
    if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
        pressedItemId = null;
    }
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

.search-results-container {
    cursor: default;
}

.icon-item {
    padding: min(8px, 5%);
    border-radius: 18px;
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
</style>
