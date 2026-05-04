<template>
    <div
        v-show="ContextMenu.visible"
        class="context-menu"
        :style="{ left: `${ContextMenu.x}px`, top: `${ContextMenu.y}px` }"
        @click.stop
    >
        <template v-for="item in menuModel" :key="item.id">
            <div v-if="item.type === 'separator'" class="menu-sep" />

            <div v-else-if="item.type === 'group'" class="menu-group">
                <div class="menu-title">
                    {{ resolveMenuLabel(item.title, menuContext) }}
                </div>
                <div class="menu-sub">
                    <button
                        v-for="child in item.children"
                        :key="child.id"
                        class="menu-subitem"
                        type="button"
                        :class="{
                            active:
                                child.type === 'item' &&
                                !!evaluateCondition(
                                    resolveConditionValue(child.checked, menuContext),
                                    menuContext
                                ),
                        }"
                        :disabled="
                            child.type === 'item' &&
                            !!evaluateCondition(
                                resolveConditionValue(child.disabled, menuContext),
                                menuContext
                            )
                        "
                        @click="handleChildClick(child)"
                    >
                        {{
                            child.type === "item"
                                ? resolveMenuLabel(child.label, menuContext)
                                : ""
                        }}
                    </button>
                </div>
            </div>

            <button
                v-else
                class="menu-item"
                type="button"
                :disabled="!!evaluateCondition(resolveConditionValue(item.disabled, menuContext), menuContext)"
                @click="onClickItem(item)"
                @mousedown="onMouseDownItem(item)"
            >
                <span>{{ resolveMenuLabel(item.label, menuContext) }}</span>
                <span
                    v-if="
                        item.mode &&
                        item.mode !== 'normal' &&
                        !!evaluateCondition(resolveConditionValue(item.checked, menuContext), menuContext)
                    "
                    class="menu-check"
                >
                    ✓
                </span>
            </button>
        </template>
    </div>
</template>

<script setup lang="ts">
import { HomeLayoutPresetKey, useUIStore } from "../stores/uiStore";
import { storeToRefs } from "pinia";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { computed } from "vue";
import { buildContextMenuModel } from "../menus/contextMenu";
import type { MenuContext, MenuItem, MenuAction } from "../menus/contextMenuTypes";
import { resolveLabel as resolveMenuLabel, resolveConditionValue, evaluateCondition } from "../menus/contextMenuTypes";

const uiStore = useUIStore();
const { ContextMenu, ContextMenuType } = storeToRefs(uiStore);

const emit = defineEmits<{
    (e: "action", action: MenuAction, ctx: MenuContext): void;
}>();

const props = defineProps<{
    currentItemId?: string;
    currentItemPath?: string;
    currentClipboardRecordId?: string;
    currentClipboardContentType?: "text" | "image";
    isCurrentItemFavorite?: boolean;
    hasCustomIconProp?: boolean;
    hasCurrentCategoryCustomIcon?: boolean;
    categoryCols?: number;
    launcherCols?: number;
    currentHomeSection?: "pinned" | "recent";
    currentCategorySortMode?: "manual" | "smart";
    pinnedLayoutPreset?: HomeLayoutPresetKey;
    recentLayoutPreset?: HomeLayoutPresetKey;
    currentCategoryId?: string;
}>();

const menuContext = computed<MenuContext>(() => {
    const item = props.currentItemId
        ? {
              pinned: !!props.isCurrentItemFavorite,
              favorite: !!props.isCurrentItemFavorite,
              customIcon: !!props.hasCustomIconProp,
          }
        : undefined;

    const layout = {
        categoryCols: props.categoryCols ?? 5,
        launcherCols: props.launcherCols ?? 5,
        pinnedPreset: props.pinnedLayoutPreset ?? "1x5",
        recentPreset: props.recentLayoutPreset ?? "1x5",
    };

    return {
        menuType: ContextMenuType.value,
        categoryId: props.currentCategoryId ?? null,
        itemId: props.currentItemId ?? null,
        itemPath: props.currentItemPath ?? null,
        clipboardRecordId: props.currentClipboardRecordId ?? null,
        clipboardContentType: props.currentClipboardContentType ?? null,
        homeSection: props.currentHomeSection ?? null,
        categorySortMode: props.currentCategorySortMode ?? "manual",
        item,
        category: props.currentCategoryId
            ? {
                  id: props.currentCategoryId,
                  customIcon: !!props.hasCurrentCategoryCustomIcon,
              }
            : undefined,
        layout,
    };
});

const menuModel = computed<MenuItem[]>(() => {
    return buildContextMenuModel(menuContext.value);
});

/**
 * 点击菜单项后执行动作分发（内置/插件统一）。
 */
function onSelectItem(item: Extract<MenuItem, { type: "item" }>) {
    uiStore.closeContextMenu();
    emit("action", item.action, menuContext.value);
}

/**
 * 处理子菜单项点击。
 */
function handleChildClick(child: MenuItem) {
    if (child.type !== "item") return;
    onSelectItem(child);
}

/**
 * 处理菜单项点击：拖拽窗口项不走 action 分发。
 */
function onClickItem(item: Extract<MenuItem, { type: "item" }>) {
    if (item.action.kind === "start-dragging-window") return;
    onSelectItem(item);
}

/**
 * 处理菜单项按下：用于触发“拖拽窗口”。
 */
function onMouseDownItem(item: Extract<MenuItem, { type: "item" }>) {
    if (item.action.kind === "start-dragging-window") {
        startDragging();
    }
}

/**
 * 在菜单项上开始拖拽窗口（需 mousedown 触发以符合 Tauri 行为）。
 */
async function startDragging() {
    await getCurrentWindow().startDragging();
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

.menu-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
}

.menu-check {
    opacity: 0.85;
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
    flex-wrap: wrap;
    gap: 4px;
    padding: 0 6px 4px;
}

.menu-subitem {
    flex: 1 0 calc(100% / 4 - 4px);
    min-width: 40px;
    text-align: center;
}

.menu-subitem.active {
    background: var(--primary-bg);
    color: var(--primary-color);
    font-weight: 600;
}
</style>
