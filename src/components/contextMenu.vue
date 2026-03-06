<template>
    <div
        v-show="ContextMenu.visible"
        class="context-menu"
        :style="{ left: `${ContextMenu.x}px`, top: `${ContextMenu.y}px` }"
        @click.stop
    >
        <button
            class="menu-item"
            type="button"
            @click="onAddItem"
            v-show="isMenuVisible(enumContextMenuType.IconView)"
        >
            添加项目
        </button>
        <button
            class="menu-item"
            type="button"
            @click="onEditItem"
            v-show="isMenuVisible(enumContextMenuType.IconItem)"
        >
            编辑
        </button>
        <button
            class="menu-item"
            type="button"
            @click="onToggleFavorite"
            v-show="isMenuVisible(enumContextMenuType.IconItem)"
        >
            {{ isCurrentItemFavorite ? '取消收藏' : '收藏' }}
        </button>
        <button
            class="menu-item"
            type="button"
            @click="onChangeIcon"
            v-show="isMenuVisible(enumContextMenuType.IconItem)"
        >
            更换图标
        </button>
        <button
            class="menu-item"
            type="button"
            @click="onResetIcon"
            v-show="isMenuVisible(enumContextMenuType.IconItem) && hasCustomIconProp"
        >
            重置图标
        </button>
        <button
            class="menu-item"
            type="button"
            @click="onDeleteItem"
            v-show="isMenuVisible(enumContextMenuType.IconItem)"
        >
            删除
        </button>
        <button
            class="menu-item"
            type="button"
            @click="onAddCategory"
            v-show="isMenuVisible(enumContextMenuType.CategorieView)"
        >
            添加类目
        </button>
        <button
            class="menu-item"
            type="button"
            @click="onHideWindow"
            v-show="isMenuVisible(enumContextMenuType.CategorieView)"
        >
            隐藏启动台
        </button>
        <button
            class="menu-item"
            type="button"
            @click="onRenameCategory"
            v-show="isMenuVisible(enumContextMenuType.Categorie)"
        >
            重命名
        </button>
        <button
            class="menu-item"
            type="button"
            @click="onChangeCategoryIcon"
            v-show="isMenuVisible(enumContextMenuType.Categorie)"
        >
            更换图标
        </button>
        <button
            class="menu-item"
            type="button"
            @click="onResetCategoryIcon"
            v-show="isMenuVisible(enumContextMenuType.Categorie)"
        >
            重置图标
        </button>
        <button
            class="menu-item"
            type="button"
            @click="onDeleteCategory"
            v-show="isMenuVisible(enumContextMenuType.Categorie)"
        >
            删除
        </button>
        <button class="menu-item" type="button" @mousedown="startDragging">
            拖拽窗口
        </button>
        <button
            class="menu-item"
            type="button"
            @click="onOpenSettings"
        >
            设置
        </button>

        <div
            class="menu-sep"
            v-show="isMenuVisible(enumContextMenuType.CategorieView)"
        />
        <div
            class="menu-group"
            v-show="isMenuVisible(enumContextMenuType.CategorieView)"
        >
            <div class="menu-title">分类图标</div>
            <div class="menu-sub">
                <button
                    class="menu-subitem"
                    type="button"
                    :class="{ active: categoryCols === 4 }"
                    @click="onSetCategoryCols(4)"
                >
                    4
                </button>
                <button
                    class="menu-subitem"
                    type="button"
                    :class="{ active: categoryCols === 5 }"
                    @click="onSetCategoryCols(5)"
                >
                    5
                </button>
            </div>
        </div>
        <div
            class="menu-group"
            v-show="isMenuVisible(enumContextMenuType.IconView)"
        >
            <div class="menu-title">启动项图标</div>
            <div class="menu-sub">
                <button
                    class="menu-subitem"
                    type="button"
                    :class="{ active: launcherCols === 4 }"
                    @click="onSetLauncherCols(4)"
                >
                    4
                </button>
                <button
                    class="menu-subitem"
                    type="button"
                    :class="{ active: launcherCols === 5 }"
                    @click="onSetLauncherCols(5)"
                >
                    5
                </button>
                <button
                    class="menu-subitem"
                    type="button"
                    :class="{ active: launcherCols === 6 }"
                    @click="onSetLauncherCols(6)"
                >
                    6
                </button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { enumContextMenuType, Store } from "../stores/index";
import { storeToRefs } from "pinia";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { computed } from "vue";
import { selectAndConvertIcon } from "../utils/iconUtils";

const store = Store();
const { ContextMenu, ContextMenuType } = storeToRefs(store);

const emit = defineEmits<{
    (e: "add-item"): void;
    (e: "add-category"): void;
    (e: "set-category-cols", cols: number): void;
    (e: "set-launcher-cols", cols: number): void;
    (e: "delete-category"): void;
    (e: "rename-category"): void;
    (e: "edit-item"): void;
    (e: "delete-item"): void;
    (e: "hide-window"): void;
    (e: "change-icon", base64: string): void;
    (e: "reset-icon"): void;
    (e: "change-category-icon", base64: string): void;
    (e: "reset-category-icon"): void;
    (e: "toggle-favorite"): void;
    (e: "open-settings"): void;
}>();

defineProps<{
    currentItemId?: string;
    isCurrentItemFavorite?: boolean;
    hasCustomIconProp?: boolean;
    categoryCols?: number;
    launcherCols?: number;
}>();

function onDeleteCategory() {
    store.closeContextMenu();
    emit("delete-category");
}

function onRenameCategory() {
    store.closeContextMenu();
    emit("rename-category");
}

function onEditItem() {
    store.closeContextMenu();
    emit("edit-item");
}

function onDeleteItem() {
    store.closeContextMenu();
    emit("delete-item");
}

const isMenuVisible = computed(() => {
    return (type: enumContextMenuType) => {
        return ContextMenuType.value === type;
    };
});

function onAddItem() {
    store.closeContextMenu();
    emit("add-item");
}

function onAddCategory() {
    store.closeContextMenu();
    emit("add-category");
}

function onHideWindow() {
    store.closeContextMenu();
    emit("hide-window");
}

function onSetCategoryCols(cols: number) {
    emit("set-category-cols", cols);
}

function onSetLauncherCols(cols: number) {
    emit("set-launcher-cols", cols);
}

async function onChangeIcon() {
    store.closeContextMenu();
    const base64 = await selectAndConvertIcon();
    if (base64) {
        emit("change-icon", base64);
    }
}

function onResetIcon() {
    store.closeContextMenu();
    emit("reset-icon");
}

async function onChangeCategoryIcon() {
    store.closeContextMenu();
    const base64 = await selectAndConvertIcon();
    if (base64) {
        emit("change-category-icon", base64);
    }
}

function onResetCategoryIcon() {
    store.closeContextMenu();
    emit("reset-category-icon");
}

function onToggleFavorite() {
    store.closeContextMenu();
    emit("toggle-favorite");
}

function onOpenSettings() {
    store.closeContextMenu();
    emit("open-settings");
}

async function startDragging(event: { target: any; currentTarget: any }) {
    if (event.target === event.currentTarget) {
        getCurrentWindow().startDragging();
    }
}
</script>

<style scoped>
.context-menu {
    user-select: none;
    position: fixed;
    z-index: 9999;
    width: 220px;
    padding: 8px;
    border-radius: 10px;
    background: var(--menu-bg);
    border: 1px solid var(--border-color);
    box-shadow: var(--menu-shadow);
    backdrop-filter: var(--backdrop-blur);
}

.menu-item,
.menu-subitem {
    width: 100%;
    text-align: left;
    background: transparent;
    border: 0;
    padding: 8px 10px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 14px;
    color: var(--text-color);
}

.menu-item:hover,
.menu-subitem:hover {
    background: var(--hover-bg);
}

.menu-sep {
    height: 1px;
    margin: 6px 4px;
    background: var(--border-color);
}

.menu-group {
    padding: 2px 0;
}

.menu-title {
    padding: 6px 10px;
    font-size: 12px;
    opacity: 0.75;
    color: var(--text-secondary);
}

.menu-sub {
    display: flex;
    gap: 6px;
    padding: 0 6px 4px;
}

.menu-subitem {
    text-align: center;
}

.menu-subitem.active {
    background: var(--primary-bg);
    color: var(--primary-color);
    font-weight: 600;
}
</style>
