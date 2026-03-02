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
                    class="icon-item"
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
    </div>
</template>

<script setup lang="ts">
import { computed, watchEffect } from "vue";
import { storeToRefs } from "pinia";
import { useRouter } from "vue-router";
import draggable from "vuedraggable";
import { openPath } from "@tauri-apps/plugin-opener";
import { Store } from "../stores";
import type { LauncherItem } from "../stores";

const props = defineProps<{
    categoryId: string;
}>();

const router = useRouter();
const store = Store();
const { launcherCols } = storeToRefs(store);

const title = computed(() => {
    const category = store.getCategoryById(props.categoryId);
    return category?.name || "未命名类目";
});

const items = computed<LauncherItem[]>({
    get() {
        return store.getLauncherItemsByCategoryId(props.categoryId);
    },
    set(value) {
        store.setLauncherItemsByCategoryId(props.categoryId, value);
    },
});

watchEffect(() => {
    store.setCurrentCategory(props.categoryId);
});

/**
 * 返回到类目列表页面。
 */
function onBack() {
    router.push("/categories");
}

/**
 * 双击启动指定启动项。
 */
async function onOpenItem(item: LauncherItem) {
    try {
        await openPath(item.path);
    } catch (e) {
        console.error(e);
    }
}

/**
 * 将后端返回的 base64 转换为 img 可用的 data URL。
 */
function getIconSrc(iconBase64: string) {
    if (iconBase64.startsWith("data:")) return iconBase64;
    return `data:image/png;base64,${iconBase64}`;
}

/**
 * 获取无图标时的兜底文字。
 */
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
    background: rgba(245, 246, 248, 0);
}

.category-header {
    height: 52px;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 12px;
    background: rgba(255, 255, 255, 0.92);
    border-bottom: 1px solid rgba(0, 0, 0, 0.06);
    backdrop-filter: blur(10px);
    // 不可选中文字
    user-select: none;
}

.back-btn {
    border: 0;
    padding: 8px 10px;
    border-radius: 10px;
    background: rgba(0, 0, 0, 0.06);
    cursor: pointer;
    -webkit-app-region: no-drag;
}

.back-btn:hover {
    background: rgba(0, 0, 0, 0.1);
}

.category-title {
    font-size: 16px;
    font-weight: 700;
    color: #2b2b2b;
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
}

.icon-item {
    padding: 8px;
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.92);
    box-shadow: 0 0 10px rgba(0, 0, 0, 0.16);
    user-select: none;
    opacity: 0.92;
    display: flex;
    gap: 8px;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    aspect-ratio: 1 / 1;
}

.icon-img {
    width: 50%;
    aspect-ratio: 1 / 1;
    display: flex;
    align-items: center;
    justify-content: center;
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
    background: rgba(0, 0, 0, 0.08);
    font-weight: 800;
    color: #3b3b3b;
}

.icon-name {
    // 溢出部分省略号
    width: 100%;
    text-align: center;
    font-size: 12px;
    color: #3a3a3a;
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
    background: rgba(255, 255, 255, 0.9);
    border: 1px solid rgba(0, 0, 0, 0.06);
    color: rgba(0, 0, 0, 0.7);
    font-size: 13px;
    pointer-events: none;
}
</style>

