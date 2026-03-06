<template>
    <div
        data-menu-type="categorie-view"
        class="categorie-view"
        :class="{ 'is-editing': isEditingCategory }"
    >
        <div class="search-header">
            <SearchBox
                ref="searchBoxRef"
                v-model="searchKeyword"
                placeholder="搜索类目或启动项..."
            />
        </div>

        <div v-if="searchKeyword.trim() && globalSearchResults.length > 0" class="global-search-results">
            <div class="search-result-header">
                搜索结果 ({{ globalSearchResults.length }})
            </div>
            <div class="search-result-list">
                <div
                    v-for="result in globalSearchResults"
                    :key="result.item.id"
                    class="search-result-item"
                    @click="onOpenSearchResult(result)"
                >
                    <div class="result-icon">
                        <img
                            v-if="result.item.iconBase64"
                            class="icon-real"
                            :src="getIconSrc(result.item.iconBase64)"
                            alt=""
                            draggable="false"
                        />
                        <div v-else class="icon-fallback">
                            {{ getFallbackText(result.item.name) }}
                        </div>
                    </div>
                    <div class="result-info">
                        <div class="result-name">{{ result.item.name }}</div>
                        <div class="result-category">{{ result.categoryName }}</div>
                    </div>
                </div>
            </div>
        </div>

        <div v-else-if="searchKeyword.trim() && globalSearchResults.length === 0" class="no-results">
            未找到匹配的启动项
        </div>

        <template v-else>
            <div v-if="recentItemsWithInfo.length > 0" class="recent-used-section">
                <div class="recent-header">
                    <span class="recent-title">最近使用</span>
                </div>
                <div class="recent-list">
                    <div
                        v-for="{ recent, item, category } in recentItemsWithInfo"
                        :key="recent.categoryId + '-' + recent.itemId"
                        class="recent-item"
                        @click="onOpenRecentItem(recent, item)"
                    >
                        <div class="recent-icon">
                            <img
                                v-if="item?.iconBase64"
                                class="icon-real"
                                :src="getIconSrc(item.iconBase64)"
                                alt=""
                                draggable="false"
                            />
                            <div v-else class="icon-fallback">
                                {{ getFallbackText(item?.name || '?') }}
                            </div>
                        </div>
                        <div class="recent-info">
                            <div class="recent-name">{{ item?.name || '未知' }}</div>
                            <div class="recent-category">{{ category?.name || '未知类目' }}</div>
                        </div>
                    </div>
                </div>
            </div>

            <draggable
                v-model="categories"
                item-key="id"
                class="categorie-container"
                :style="{ '--cols': categoryCols }"
                ghost-class="categorie-ghost"
                chosen-class="categorie-chosen"
                drag-class="categorie-drag"
                :delay="200"
                :delay-on-touch-only="false"
                :animation="150"
                :force-fallback="true"
                fallback-class="categorie-drag"
                :fallback-tolerance="5"
                data-menu-type="categorie-view"
                :disabled="isEditingCategory"
            >
                <template #item="{ element }">
                    <div
                        class="categorie-item"
                        :class="{
                            editing:
                                isEditingCategory &&
                                element.id === editingCategoryId,
                        }"
                        @contextmenu.self="1"
                        data-menu-type="categorie"
                        :data-category-id="element.id"
                        @click="onClickCategory(element)"
                    >
                        <template
                            v-if="
                                isEditingCategory &&
                                element.id === editingCategoryId
                            "
                        >
                            <input
                                :ref="setEditingInputRef"
                                v-model="editingCategoryName"
                                class="categorie-input"
                                data-menu-type="categorie"
                                :data-category-id="element.id"
                                @click.stop
                                @mousedown.stop
                                @keydown.enter.stop.prevent="onConfirmCategoryEdit"
                            />
                        </template>
                        <template v-else>
                            <div 
                                v-if="element.customIconBase64" 
                                class="categorie-icon-wrapper"
                                data-menu-type="categorie"
                                :data-category-id="element.id"
                            >
                                <img
                                    :src="getIconSrc(element.customIconBase64)"
                                    class="categorie-icon"
                                    alt=""
                                    draggable="false"
                                    data-menu-type="categorie"
                                    :data-category-id="element.id"
                                />
                            </div>
                            <div 
                                v-else 
                                class="categorie-name-text"
                                data-menu-type="categorie"
                                :data-category-id="element.id"
                            >
                                {{ element.name }}
                            </div>
                        </template>
                    </div>
                </template>
            </draggable>
        </template>
    </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { ComponentPublicInstance } from "vue";
import { useRouter } from "vue-router";
import { Store, type GlobalSearchResult, type RecentUsedItem, type LauncherItem } from "../stores";
import type { Category as CategoryType } from "../stores";
import { storeToRefs } from "pinia";
import draggable from "vuedraggable";
import { openPath } from "@tauri-apps/plugin-opener";
import SearchBox from "../components/SearchBox.vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";

const store = Store();
const router = useRouter();
const {
    categories,
    categoryCols,
    editingCategoryId,
    editingCategoryName,
    isEditingCategory,
    searchKeyword,
    globalSearchResults,
} = storeToRefs(store);
const editingInputRef = ref<HTMLInputElement | null>(null);
const searchBoxRef = ref<InstanceType<typeof SearchBox> | null>(null);

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

const recentItemsWithInfo = computed(() => {
    const recentItems = store.getRecentUsedItems(5);
    return recentItems.map(recent => {
        const { item, category } = store.getRecentUsedItemInfo(recent);
        return { recent, item, category };
    }).filter(({ item }) => item !== null);
});

function onClickCategory(element: CategoryType) {
    if (isEditingCategory.value) return;
    store.setCurrentCategory(element.id);
    router.push({ name: "category", params: { categoryId: element.id } });
}

function setEditingInputRef(el: Element | ComponentPublicInstance | null) {
    editingInputRef.value = el as HTMLInputElement | null;
}

function onConfirmCategoryEdit() {
    store.confirmCategoryEdit(editingCategoryName.value);
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

async function onOpenSearchResult(result: GlobalSearchResult) {
    try {
        await openPath(result.item.path);
        store.recordItemUsage(result.categoryId, result.item.id);
        store.clearSearch();
    } catch (e) {
        console.error(e);
    }
}

async function onOpenRecentItem(recent: RecentUsedItem, item: LauncherItem | null) {
    if (!item) return;
    try {
        await openPath(item.path);
        store.recordItemUsage(recent.categoryId, recent.itemId);
    } catch (e) {
        console.error(e);
    }
}

watch(editingCategoryId, async (value) => {
    if (!value) return;
    await nextTick();
    editingInputRef.value?.focus();
    editingInputRef.value?.select();
});
</script>

<style lang="scss" scoped>
.categorie-view {
    width: 100vw;
    height: 100vh;
    background: var(--bg-color);
    display: flex;
    flex-direction: column;
}
.categorie-view.is-editing {
    pointer-events: none;
}

.search-header {
    padding: 12px 16px;
    flex-shrink: 0;
}

.global-search-results {
    flex: 1;
    padding: 0 16px 16px;
    overflow-y: auto;
    &::-webkit-scrollbar {
        display: none;
    }
}

.search-result-header {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-color-secondary);
    margin-bottom: 12px;
}

.search-result-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.search-result-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    background: var(--card-bg-solid);
    border-radius: 12px;
    cursor: pointer;
    transition: background 0.15s ease;
    box-shadow: var(--card-shadow-light);

    &:hover {
        background: var(--card-bg-hover);
    }
}

.result-icon {
    width: 40px;
    height: 40px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;

    .icon-real {
        width: 100%;
        height: 100%;
        object-fit: contain;
    }

    .icon-fallback {
        width: 100%;
        height: 100%;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--bg-color-secondary);
        font-weight: 800;
        color: var(--text-color);
        font-size: 18px;
    }
}

.result-info {
    flex: 1;
    min-width: 0;
}

.result-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-color);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}

.result-category {
    font-size: 12px;
    color: var(--text-color-secondary);
    margin-top: 2px;
}

.no-results {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-color-secondary);
    font-size: 14px;
}

.recent-used-section {
    padding: 0 16px 12px;
    flex-shrink: 0;
}

.recent-header {
    margin-bottom: 8px;
}

.recent-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-color-secondary);
}

.recent-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.recent-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    background: var(--card-bg-solid);
    border-radius: 10px;
    cursor: pointer;
    transition: background 0.15s ease;
    box-shadow: var(--card-shadow-light);

    &:hover {
        background: var(--card-bg-hover);
    }
}

.recent-icon {
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;

    .icon-real {
        width: 100%;
        height: 100%;
        object-fit: contain;
    }

    .icon-fallback {
        width: 100%;
        height: 100%;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--bg-color-secondary);
        font-weight: 800;
        color: var(--text-color);
        font-size: 14px;
    }
}

.recent-info {
    flex: 1;
    min-width: 0;
}

.recent-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-color);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}

.recent-category {
    font-size: 11px;
    color: var(--text-color-tertiary);
    margin-top: 1px;
}

.categorie-container {
    display: flex;
    padding: 16px;
    flex-wrap: wrap;
    --gap: 16px;
    --cols: 5;
    gap: var(--gap);
    .categorie-item {
        overflow: hidden;
        flex: 0 0 calc((100% - (var(--gap) * (var(--cols) - 1))) / var(--cols));
        aspect-ratio: 1 / 1;
        opacity: 0.8;
        border-radius: 22px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-color);
        font-size: 16px;
        font-weight: bold;
        background-color: var(--card-bg-solid);
        user-select: none;
        box-shadow: var(--card-shadow-light);
    }
    .categorie-item.editing {
        pointer-events: auto;
        animation: categorie-editing-shadow 1.2s ease-in-out infinite;
    }
    .categorie-icon-wrapper {
        width: 60%;
        height: 60%;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    .categorie-icon {
        width: 100%;
        height: 100%;
        object-fit: contain;
    }
    .categorie-name-text {
        text-align: center;
        padding: 8px;
    }
}

.categorie-ghost {
    opacity: 0.4;
}

.categorie-chosen {
    cursor: grabbing;
}

.categorie-drag {
    cursor: grabbing;
}

.categorie-input {
    width: 80%;
    height: 24px;
    padding: 0;
    border: none;
    font-size: 14px;
    text-align: center;
    font-weight: bold;
    outline: none;
    pointer-events: auto;
    position: relative;
    background: transparent;
    color: var(--text-color);
}

@keyframes categorie-editing-shadow {
    0% {
        box-shadow: var(--editing-shadow-1);
    }
    50% {
        box-shadow: var(--editing-shadow-2);
    }
    100% {
        box-shadow: var(--editing-shadow-1);
    }
}
</style>
