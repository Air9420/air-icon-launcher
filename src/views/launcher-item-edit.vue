<template>
    <div
        class="item-edit-view"
        data-menu-type="icon-view"
        :data-category-id="categoryId"
    >
        <header
            class="item-edit-header"
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
                class="title"
                data-menu-type="icon-view"
                :data-category-id="categoryId"
                data-tauri-drag-region
            >
                编辑
            </div>
        </header>

        <div class="content">
            <div class="preview">
                <img
                    v-if="item?.iconBase64"
                    class="preview-img"
                    :src="getIconSrc(item.iconBase64)"
                    alt=""
                    draggable="false"
                />
                <div v-else class="preview-fallback">
                    {{ getFallbackText(item?.name || "") }}
                </div>
            </div>

            <div class="form">
                <label class="field">
                    <div class="label">名称</div>
                    <input
                        v-model="name"
                        class="input"
                        type="text"
                        placeholder="请输入名称"
                    />
                </label>

                <label class="field">
                    <div class="label">路径</div>
                    <input
                        class="input"
                        type="text"
                        :value="item?.path || ''"
                        readonly
                    />
                </label>

                <div class="actions">
                    <button class="btn primary" type="button" @click="onSave">
                        保存
                    </button>
                    <button class="btn danger" type="button" @click="onDelete">
                        删除
                    </button>
                </div>
            </div>
        </div>

        <div v-if="!item" class="empty">启动项不存在或已被删除</div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, watchEffect } from "vue";
import { useRouter } from "vue-router";
import { Store } from "../stores";
import type { LauncherItem } from "../stores";

const props = defineProps<{
    categoryId: string;
    itemId: string;
}>();

const router = useRouter();
const store = Store();
const name = ref<string>("");

const item = computed<LauncherItem | null>(() => {
    return store.getLauncherItemById(props.categoryId, props.itemId);
});

watchEffect(() => {
    if (item.value) {
        name.value = item.value.name;
    }
});

/**
 * 返回到类目启动台页面。
 */
function onBack() {
    router.push({ name: "category", params: { categoryId: props.categoryId } });
}

/**
 * 保存启动项编辑结果。
 */
function onSave() {
    if (!item.value) return;
    store.updateLauncherItem(props.categoryId, props.itemId, {
        name: name.value.trim(),
    });
    onBack();
}

/**
 * 删除当前启动项。
 */
function onDelete() {
    if (!item.value) return;
    store.deleteLauncherItem(props.categoryId, props.itemId);
    onBack();
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
.item-edit-view {
    width: 100vw;
    height: 100vh;
    display: flex;
    flex-direction: column;
    position: relative;
    background: var(--bg-color);
}

.item-edit-header {
    height: 52px;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 12px;
    background: var(--card-bg);
    border-bottom: 1px solid var(--border-color);
    backdrop-filter: var(--backdrop-blur);
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

.title {
    font-size: 16px;
    font-weight: 700;
    color: var(--text-color);
}

.content {
    display: flex;
    gap: 16px;
    padding: 18px 16px;
}

.preview {
    width: 92px;
    height: 92px;
    border-radius: 20px;
    background: var(--card-bg);
    box-shadow: var(--card-shadow);
    display: flex;
    align-items: center;
    justify-content: center;
    user-select: none;
}

.preview-img {
    width: 56px;
    height: 56px;
    object-fit: contain;
}

.preview-fallback {
    width: 56px;
    height: 56px;
    border-radius: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--icon-fallback-bg);
    font-weight: 800;
    color: var(--icon-fallback-text);
}

.form {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.field {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.label {
    font-size: 12px;
    color: var(--text-tertiary);
}

.input {
    height: 36px;
    padding: 0 10px;
    border-radius: 12px;
    border: 1px solid var(--border-color-strong);
    background: var(--input-bg);
    outline: none;
    -webkit-app-region: no-drag;
    color: var(--text-color);
}

.actions {
    display: flex;
    gap: 10px;
    margin-top: 6px;
}

.btn {
    height: 36px;
    padding: 0 14px;
    border-radius: 12px;
    border: 0;
    cursor: pointer;
    -webkit-app-region: no-drag;
}

.btn.primary {
    background: var(--primary-color);
    color: #fff;
}

.btn.primary:hover {
    opacity: 0.9;
}

.btn.danger {
    background: var(--hover-bg);
    color: var(--text-secondary);
}

.btn.danger:hover {
    background: var(--hover-bg-strong);
}

.empty {
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

