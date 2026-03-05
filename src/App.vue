<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useRouter } from "vue-router";
import { getCurrentWindow } from "@tauri-apps/api/window";

import ContextMenu from "./components/contextMenu.vue";
import { enumContextMenuType, Store } from "./stores";
import { storeToRefs } from "pinia";

const store = Store();
const { ContextMenuType, isEditingCategory } = storeToRefs(store);
const lastDrop = ref<DropRecord | null>(null);
const lastAction = ref<string>("");
const currentCategoryId = ref<string | null>(null);
const currentLauncherItemId = ref<string | null>(null);
const processedDropIds = new Set<string>();
const router = useRouter();

type DropPosition = {
    x: number;
    y: number;
};

type DropTargetInfo = {
    tag_name: string;
    id: string | null;
    class_list: string[];
    dataset: Record<string, string>;
};

type DropRecord = {
    drop_id: string;
    paths: string[];
    directories: string[];
    icon_base64s: Array<string | null>;
    position: DropPosition;
    target: DropTargetInfo | null;
};

/**
 * 根据 drop 的窗口坐标，提取当前落点对应的 DOM 元素信息。
 */
function getDropTargetInfoAtPoint(x: number, y: number): DropTargetInfo | null {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;

    const dataset: Record<string, string> = {};
    if (el instanceof HTMLElement) {
        for (const [k, v] of Object.entries(el.dataset)) {
            if (typeof v === "string") dataset[k] = v;
        }
    }

    return {
        tag_name: el.tagName,
        id: el.id ? el.id : null,
        class_list: Array.from(el.classList),
        dataset,
    };
}

/**
 * 获取右键菜单的尺寸信息。
 */
function getContextMenuSize() {
    const menuEl = document.querySelector(
        ".context-menu"
    ) as HTMLElement | null;
    return {
        width: menuEl?.offsetWidth || 220,
        height: menuEl?.offsetHeight || 110,
    };
}

/**
 * 计算右键菜单在窗口内的可显示坐标。
 */
function getContextMenuPosition(clientX: number, clientY: number) {
    const { width, height } = getContextMenuSize();
    const padding = 8;
    const x = Math.min(
        Math.max(clientX, padding),
        window.innerWidth - width - padding
    );
    const y = Math.min(
        Math.max(clientY, padding),
        window.innerHeight - height - padding
    );
    return { x, y };
}

/**
 * 等待下一帧以确保菜单完成布局。
 */
function nextFrame() {
    return new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve())
    );
}

/**
 * 阻止原生右键菜单并弹出自定义右键菜单。
 */
async function openContextMenu(e: any) {
    e.preventDefault();
    if (isEditingCategory.value) return;
    const menuType = e.target.dataset.menuType as enumContextMenuType;
    if (!menuType) return;
    ContextMenuType.value = menuType;
    currentCategoryId.value =
        menuType === enumContextMenuType.Categorie ||
        menuType === enumContextMenuType.IconView ||
        menuType === enumContextMenuType.IconItem
            ? e.target.dataset.categoryId || null
            : null;
    currentLauncherItemId.value =
        menuType === enumContextMenuType.IconItem
            ? e.target.dataset.itemId || null
            : null;
    if (currentCategoryId.value) {
        store.setCurrentCategory(currentCategoryId.value);
    }

    const initial = getContextMenuPosition(e.clientX, e.clientY);
    store.openContextMenu(initial.x, initial.y);
    await nextTick();
    await nextFrame();
    const adjusted = getContextMenuPosition(e.clientX, e.clientY);
    if (adjusted.x !== initial.x || adjusted.y !== initial.y) {
        store.openContextMenu(adjusted.x, adjusted.y);
    }
}

/**
 * 关闭自定义右键菜单。
 */
function closeContextMenu() {
    store.closeContextMenu();
}

/**
 * 阻止 Ctrl+R、Ctrl+Shift+R、F5 的刷新。
 */
function preventRefreshShortcuts(e: KeyboardEvent) {
    const key = e.key.toLowerCase();
    if ((key === "r" && e.ctrlKey) || key === "f5") {
        e.preventDefault();
        e.stopPropagation();
    }
}

/**
 * 点击“添加项目”的菜单处理函数。
 */
function onAddItem() {
    if (
        currentCategoryId.value &&
        lastDrop.value?.paths?.length &&
        !processedDropIds.has(lastDrop.value.drop_id)
    ) {
        store.addLauncherItemsToCategory(currentCategoryId.value, {
            paths: lastDrop.value.paths,
            directories: lastDrop.value.directories,
            icon_base64s: lastDrop.value.icon_base64s,
        });
        processedDropIds.add(lastDrop.value.drop_id);
        lastAction.value = `已添加到类目：${currentCategoryId.value}`;
    } else {
        lastAction.value =
            "添加项目：当前没有可用的拖拽数据，或已处理过该次拖拽";
    }
    closeContextMenu();
}

/**
 * 点击“添加类目”的菜单处理函数。
 */
function onAddCategory() {
    if (isEditingCategory.value) return;
    store.beginAddCategory();
    closeContextMenu();
}

/**
 * 点击“删除类目”的菜单处理函数。
 */
function onDeleteCategory() {
    if (isEditingCategory.value) return;
    if (!currentCategoryId.value) return;
    store.deleteCategory(currentCategoryId.value);
    closeContextMenu();
}

/**
 * 点击“重命名类目”的菜单处理函数。
 */
function onRenameCategory() {
    if (isEditingCategory.value) return;
    if (!currentCategoryId.value) return;
    store.beginRenameCategory(currentCategoryId.value);
    closeContextMenu();
}

/**
 * 点击“分类图标每行数量”的菜单处理函数。
 */
function onSetCategoryCols(cols: number) {
    store.setCategoryCols(cols);
    lastAction.value = `分类图标：${cols}`;
    closeContextMenu();
}

/**
 * 点击“启动项图标每行数量”的菜单处理函数。
 */
function onSetLauncherCols(cols: number) {
    store.setLauncherCols(cols);
    lastAction.value = `启动项图标：${cols}`;
    closeContextMenu();
}

/**
 * 点击“编辑启动项”的菜单处理函数。
 */
function onEditItem() {
    if (!currentCategoryId.value || !currentLauncherItemId.value) return;
    router.push({
        name: "launcher-item-edit",
        params: {
            categoryId: currentCategoryId.value,
            itemId: currentLauncherItemId.value,
        },
    });
    closeContextMenu();
}

/**
 * 点击“删除启动项”的菜单处理函数。
 */
function onDeleteItem() {
    if (!currentCategoryId.value || !currentLauncherItemId.value) return;
    store.deleteLauncherItem(currentCategoryId.value, currentLauncherItemId.value);
    closeContextMenu();
}

/**
 * 点击“隐藏启动台”的菜单处理函数。
 */
async function onHideWindow() {
    try {
        await getCurrentWindow().hide();
    } catch (e) {
        console.error(e);
    } finally {
        closeContextMenu();
    }
}

onMounted(async () => {
    await store.hydrateAppSettings();
    await store.refreshAutostartServiceStatus();
    window.addEventListener("keydown", preventRefreshShortcuts, true);
    const onContextMenu = (ev: MouseEvent) => {
        ev.preventDefault();
    };
    document.addEventListener("contextmenu", onContextMenu, { capture: true });

    const onGlobalClick = () => closeContextMenu();
    const onGlobalKeyDown = (ev: KeyboardEvent) => {
        if (ev.key === "Escape") closeContextMenu();
    };
    window.addEventListener("click", onGlobalClick);
    window.addEventListener("keydown", onGlobalKeyDown);
    window.addEventListener("blur", onGlobalClick);

    await listen<DropRecord>("drag-drop", async (event) => {
        lastDrop.value = event.payload;
        const { drop_id, position, paths, directories, icon_base64s } =
            event.payload;
        const target = getDropTargetInfoAtPoint(position.x, position.y);
        await invoke("report_drop_target", { dropId: drop_id, target });

        const menuType = target?.dataset?.menuType as
            | enumContextMenuType
            | undefined;
        const categoryId = target?.dataset?.categoryId;
        if (
            (menuType === enumContextMenuType.IconView ||
                menuType === enumContextMenuType.IconItem ||
                menuType === enumContextMenuType.Categorie) &&
            categoryId &&
            paths?.length &&
            !processedDropIds.has(drop_id)
        ) {
            store.addLauncherItemsToCategory(categoryId, {
                paths,
                directories,
                icon_base64s,
            });
            processedDropIds.add(drop_id);
            store.setCurrentCategory(categoryId);
        }
    });

    await listen("tray-open-settings", async () => {
        router.push("/settings");
    });
});

onBeforeUnmount(() => {
    window.removeEventListener("keydown", preventRefreshShortcuts, true);
});
</script>

<template>
    <main class="main" @contextmenu="openContextMenu">
        <router-view></router-view>
    </main>
    <ContextMenu
        @add-item="onAddItem"
        @add-category="onAddCategory"
        @delete-category="onDeleteCategory"
        @rename-category="onRenameCategory"
        @edit-item="onEditItem"
        @delete-item="onDeleteItem"
        @hide-window="onHideWindow"
        @set-category-cols="onSetCategoryCols"
        @set-launcher-cols="onSetLauncherCols"
    />

    <!-- <div
        v-if="contextMenu.visible"
        class="context-menu"
        :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
        @click.stop
    >
        <button class="menu-item" type="button" @click="onAddItem">
            添加项目
        </button>
        <div class="menu-sep" />
        <div class="menu-group">
            <div class="menu-title">图标大小</div>
            <div class="menu-sub">
                <button
                    class="menu-subitem"
                    type="button"
                    @click="onSetIconSize('小')"
                >
                    小
                </button>
                <button
                    class="menu-subitem"
                    type="button"
                    @click="onSetIconSize('中')"
                >
                    中
                </button>
                <button
                    class="menu-subitem"
                    type="button"
                    @click="onSetIconSize('大')"
                >
                    大
                </button>
            </div>
        </div>
    </div> -->
</template>

<style lang="scss" scoped>
.main {
    width: 100vw;
    height: 100vh;
    overflow: hidden;
}
.container {
    position: relative;
    padding: 16px;
    min-height: 100vh;
    box-sizing: border-box;
    user-select: none;
}

.hint {
    font-size: 14px;
    opacity: 0.75;
    margin-bottom: 12px;
}

.demo-icons {
    gap: 12px;
    align-items: center;
}

.logo {
    height: var(--icon-size, 64px);
    width: auto;
}

.status {
    margin-top: 12px;
    font-size: 14px;
    opacity: 0.9;
}

.logo.vite:hover {
    filter: drop-shadow(0 0 2em #747bff);
}

.logo.vue:hover {
    filter: drop-shadow(0 0 2em #249b73);
}

.drop-debug {
    margin-top: 16px;
    text-align: left;
    max-width: 720px;
    align-self: center;
    background: rgba(0, 0, 0, 0.04);
    padding: 12px;
    border-radius: 8px;
    overflow: auto;
}
</style>

<style>
body {
    margin: 0;
    width: 100vw;
    height: 100vh;
}
</style>
