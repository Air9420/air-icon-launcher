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
            @click="onDeleteCategory"
            v-show="isMenuVisible(enumContextMenuType.Categorie)"
        >
            删除
        </button>
        <button class="menu-item" type="button" @mousedown="startDragging">
            拖拽窗口
        </button>

        <div
            class="menu-sep"
            v-show="isMenuVisible(enumContextMenuType.CategorieView)"
        />
        <div
            class="menu-group"
            v-show="
                isMenuVisible(enumContextMenuType.CategorieView) ||
                isMenuVisible(enumContextMenuType.IconView)
            "
        >
            <div class="menu-title">分类图标</div>
            <div class="menu-sub">
                <button
                    class="menu-subitem"
                    type="button"
                    @click="onSetCategoryCols(4)"
                >
                    4
                </button>
                <button
                    class="menu-subitem"
                    type="button"
                    @click="onSetCategoryCols(5)"
                >
                    5
                </button>
            </div>
            <div class="menu-title">启动项图标</div>
            <div class="menu-sub">
                <button
                    class="menu-subitem"
                    type="button"
                    @click="onSetLauncherCols(4)"
                >
                    4
                </button>
                <button
                    class="menu-subitem"
                    type="button"
                    @click="onSetLauncherCols(5)"
                >
                    5
                </button>
                <button
                    class="menu-subitem"
                    type="button"
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
// 导入响应式计算函数
import { computed } from "vue";

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
}>();

/**
 * 触发“删除类目”的菜单动作。
 */
function onDeleteCategory() {
    store.closeContextMenu();
    emit("delete-category");
}

/**
 * 触发“重命名类目”的菜单动作。
 */
function onRenameCategory() {
    store.closeContextMenu();
    emit("rename-category");
}

/**
 * 触发“编辑启动项”的菜单动作。
 */
function onEditItem() {
    store.closeContextMenu();
    emit("edit-item");
}

/**
 * 触发“删除启动项”的菜单动作。
 */
function onDeleteItem() {
    store.closeContextMenu();
    emit("delete-item");
}

/**
 * 判断当前菜单类型是否匹配按钮展示类型。
 */
const isMenuVisible = computed(() => {
    return (type: enumContextMenuType) => {
        return ContextMenuType.value === type;
    };
});

/**
 * 触发“添加项目”的菜单动作。
 */
function onAddItem() {
    store.closeContextMenu();
    emit("add-item");
}

/**
 * 触发“添加类目”的菜单动作。
 */
function onAddCategory() {
    store.closeContextMenu();
    emit("add-category");
}

/**
 * 触发“隐藏启动台”的菜单动作。
 */
function onHideWindow() {
    store.closeContextMenu();
    emit("hide-window");
}

/**
 * 触发“分类图标每行数量”的菜单动作。
 */
function onSetCategoryCols(cols: number) {
    emit("set-category-cols", cols);
}

/**
 * 触发“启动项图标每行数量”的菜单动作。
 */
function onSetLauncherCols(cols: number) {
    emit("set-launcher-cols", cols);
}

/**
 * 开始拖动窗口。
 */
async function startDragging(event: { target: any; currentTarget: any }) {
    // 检查事件目标是否为 menu-bar 的直接子元素
    if (event.target === event.currentTarget) {
        getCurrentWindow().startDragging(); // 只有在点击 menu-bar 的空白区域时才拖动
    }
}
</script>

<style scoped>
.context-menu {
    /* 不可选中文字 */
    user-select: none;
    position: fixed;
    z-index: 9999;
    width: 220px;
    padding: 8px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.96);
    border: 1px solid rgba(0, 0, 0, 0.08);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
    backdrop-filter: blur(10px);
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
}

.menu-item:hover,
.menu-subitem:hover {
    background: rgba(0, 0, 0, 0.06);
}

.menu-sep {
    height: 1px;
    margin: 6px 4px;
    background: rgba(0, 0, 0, 0.1);
}

.menu-group {
    padding: 2px 0;
}

.menu-title {
    padding: 6px 10px;
    font-size: 12px;
    opacity: 0.75;
}

.menu-sub {
    display: flex;
    gap: 6px;
    padding: 0 6px 4px;
}

.menu-subitem {
    text-align: center;
}
</style>
