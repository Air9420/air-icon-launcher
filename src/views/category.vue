<template>
    <div
        class="category-view"
        data-menu-type="icon-view"
        :data-category-id="categoryId"
    >
        <header
            class="category-header"
            data-menu-type="icon-view"
            :data-category-id="categoryId"
            data-tauri-drag-region
        >
            <button
                class="back-btn"
                type="button"
                data-menu-type="icon-view"
                :data-category-id="categoryId"
                @click="onBack"
                @mousedown.stop
            >
                返回
            </button>
            <div
                class="category-title"
                data-menu-type="icon-view"
                :data-category-id="categoryId"
                data-tauri-drag-region
            >
                {{ title }}
            </div>
            <div class="header-search">
                <SearchBox
                    ref="searchBoxRef"
                    v-model="localSearchKeyword"
                    placeholder="搜索启动项..."
                />
            </div>
        </header>

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
            data-menu-type="icon-view"
            :data-category-id="categoryId"
        >
            <template #item="{ element }">
                <div
                    v-show="!localSearchKeyword.trim() || matchesSearch(element.name)"
                    class="icon-item"
                    :class="{ 'is-favorite': isItemFavorite(element.id) }"
                    data-menu-type="icon-item"
                    :data-category-id="categoryId"
                    :data-item-id="element.id"
                    @dblclick="onOpenItem(element)"
                >
                    <div
                        class="icon-img"
                        data-menu-type="icon-item"
                        :data-category-id="categoryId"
                        :data-item-id="element.id"
                    >
                        <img
                            v-if="element.iconBase64"
                            class="icon-real"
                            :src="getIconSrc(element.iconBase64)"
                            alt=""
                            draggable="false"
                            data-menu-type="icon-item"
                            :data-category-id="categoryId"
                            :data-item-id="element.id"
                        />
                        <div
                            v-else
                            class="icon-fallback"
                            data-menu-type="icon-item"
                            :data-category-id="categoryId"
                            :data-item-id="element.id"
                        >
                            {{ getFallbackText(element.name) }}
                        </div>
                        <div
                            v-if="isItemFavorite(element.id)"
                            class="favorite-badge"
                            data-menu-type="icon-item"
                            :data-category-id="categoryId"
                            :data-item-id="element.id"
                        >
                            ⭐
                        </div>
                    </div>
                    <div
                        class="icon-name"
                        data-menu-type="icon-item"
                        :data-category-id="categoryId"
                        :data-item-id="element.id"
                        :title="element.name"
                    >
                        {{ element.name }}
                    </div>
                </div>
            </template>
        </draggable>

        <div
            v-if="items.length === 0"
            class="empty-tip"
            data-menu-type="icon-view"
            :data-category-id="categoryId"
        >
            将文件/快捷方式拖进来即可添加到此类目
        </div>

        <div
            v-else-if="localSearchKeyword.trim() && filteredCount === 0"
            class="empty-tip"
            data-menu-type="icon-view"
            :data-category-id="categoryId"
        >
            未找到匹配的启动项
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watchEffect } from "vue";
import { storeToRefs } from "pinia";
import { useRouter } from "vue-router";
import draggable from "vuedraggable";
import { openPath } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { Store } from "../stores";
import type { LauncherItem } from "../stores";
import SearchBox from "../components/SearchBox.vue";

const props = defineProps<{
    categoryId: string;
}>();

const router = useRouter();
const store = Store();
const { launcherCols } = storeToRefs(store);
const localSearchKeyword = ref<string>("");
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

const title = computed(() => {
    const category = store.getCategoryById(props.categoryId);
    return category?.name || "未命名类目";
});

const items = computed<LauncherItem[]>({
    get() {
        const rawItems = store.getLauncherItemsByCategoryId(props.categoryId);
        const favoriteIds = new Set(store.favoriteItemIds);
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

function isItemFavorite(itemId: string): boolean {
    return store.isItemFavorite(itemId);
}

const filteredCount = computed(() => {
    const keyword = localSearchKeyword.value.trim();
    if (!keyword) return items.value.length;
    return items.value.filter((item) => matchesSearch(item.name)).length;
});

function matchesSearch(name: string): boolean {
    const keyword = localSearchKeyword.value.trim();
    if (!keyword) return true;
    const lowerName = name.toLowerCase();
    const lowerKeyword = keyword.toLowerCase();
    if (lowerName.includes(lowerKeyword)) return true;
    let keywordIndex = 0;
    for (let i = 0; i < lowerName.length && keywordIndex < lowerKeyword.length; i++) {
        if (lowerName[i] === lowerKeyword[keywordIndex]) {
            keywordIndex++;
        }
    }
    return keywordIndex === lowerKeyword.length;
}

watchEffect(() => {
    store.setCurrentCategory(props.categoryId);
});

function onBack() {
    router.push("/categories");
}

async function onOpenItem(item: LauncherItem) {
    try {
        await openPath(item.path);
        store.recordItemUsage(props.categoryId, item.id);
    } catch (e) {
        console.error(e);
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
    height: calc(100vh - 52px - 32px);
    overflow-y: scroll;
    -ms-overflow-style: none;
    &::-webkit-scrollbar {
        display: none;
    }
}

.icon-item {
    padding: 8px;
    border-radius: 18px;
    background: var(--card-bg);
    box-shadow: var(--card-shadow);
    user-select: none;
    opacity: 0.92;
    display: flex;
    gap: 8px;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    aspect-ratio: 1 / 1;
    position: relative;
}

.icon-item.is-favorite {
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

.favorite-badge {
    position: absolute;
    top: -4px;
    right: -4px;
    font-size: 12px;
    line-height: 1;
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.3));
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
