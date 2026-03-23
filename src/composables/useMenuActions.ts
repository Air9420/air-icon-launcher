/**
 * @fileoverview 右键菜单动作处理与分发
 * 
 * 本模块提供右键菜单动作的统一处理机制，包括：
 * - 内置菜单动作的处理（添加、删除、编辑等）
 * - 插件菜单动作的支持
 * - 动作的统一分发入口
 * 
 * @module composables/useMenuActions
 * 
 * @requires vue - Vue 响应式系统
 * @requires vue-router - Vue Router
 * @requires @tauri-apps/api/window - Tauri 窗口 API
 * @requires ../stores - Pinia Store
 * @requires ../menus/contextMenuTypes - 菜单类型定义
 * @requires ./types - Composables 类型定义
 * 
 * @example
 * ```typescript
 * import { useMenuActions } from './composables/useMenuActions';
 * 
 * const { onMenuAction } = useMenuActions({
 *   currentCategoryId,
 *   currentLauncherItemId,
 *   currentHomeSection,
 *   lastDrop,
 *   processedDropIds,
 *   closeContextMenu,
 * });
 * 
 * // 处理菜单动作
 * await onMenuAction(action, context);
 * ```
 */

import { ref, type Ref } from "vue";
import { useRouter } from "vue-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Store } from "../stores";
import { useCategoryStore } from "../stores/categoryStore";
import { useUIStore, type HomeLayoutPresetKey, type HomeLayoutSectionKey } from "../stores/uiStore";
import type { MenuAction, MenuContext } from "../menus/contextMenuTypes";
import type { DropRecord } from "./types";
import { selectAndConvertIcon } from "../utils/iconUtils";
import { executePluginCommand } from "../plugins/api";
import type { useConfirmDialog } from "./useConfirmDialog";

export interface UseMenuActionsOptions {
    currentCategoryId: Ref<string | null>;
    currentLauncherItemId: Ref<string | null>;
    currentHomeSection: Ref<HomeLayoutSectionKey | null>;
    lastDrop: Ref<DropRecord | null>;
    processedDropIds: Set<string>;
    closeContextMenu: () => void;
    confirm: ReturnType<typeof useConfirmDialog>["confirm"];
}

/**
 * 菜单动作处理 Composable
 * 
 * 提供右键菜单动作的统一处理和分发功能。
 * 所有菜单动作都通过 `onMenuAction` 函数进行分发，
 * 支持内置动作和插件扩展动作。
 * 
 * @param {UseMenuActionsOptions} options - 配置选项
 * @returns {Object} 菜单动作处理相关方法
 * @returns {Function} returns.onMenuAction - 动作分发器
 * @returns {Ref<string>} returns.lastAction - 最近一次动作描述
 * 
 * @example
 * ```typescript
 * const { onMenuAction, lastAction } = useMenuActions({
 *   currentCategoryId,
 *   currentLauncherItemId,
 *   currentHomeSection,
 *   lastDrop,
 *   processedDropIds,
 *   closeContextMenu,
 * });
 * ```
 * 
 * @remarks
 * - 依赖 Vue Router 进行页面导航
 * - 依赖 Tauri API 进行窗口操作
 * - 支持插件系统的命令执行
 */
export function useMenuActions(options: UseMenuActionsOptions) {
    const {
        currentCategoryId,
        currentLauncherItemId,
        lastDrop,
        processedDropIds,
        closeContextMenu,
        confirm,
    } = options;

    const store = Store();
    const uiStore = useUIStore();
    const categoryStore = useCategoryStore();
    const router = useRouter();
    const lastAction = ref<string>("");

    /**
     * 处理"添加项目"菜单动作
     * 
     * 打开文件选择对话框，让用户选择要添加的文件/快捷方式，
     * 然后将其添加到当前选中的类目中。
     * 
     * @returns {Promise<void>}
     * 
     * @example
     * ```typescript
     * await onAddItem();
     * ```
     * 
     * @remarks
     * - 需要 currentCategoryId 有效
     * - 支持多选文件
     * - 自动提取文件图标
     */
    async function onAddItem() {
        if (!currentCategoryId.value) {
            lastAction.value = "添加项目：请先选择一个类目";
            closeContextMenu();
            return;
        }

        const selected = await open({
            multiple: true,
            filters: [
                {
                    name: "可执行文件与快捷方式",
                    extensions: ["exe", "lnk", "url", "bat", "cmd"],
                },
                {
                    name: "所有文件",
                    extensions: ["*"],
                },
            ],
        });

        if (!selected) {
            closeContextMenu();
            return;
        }

        const paths = Array.isArray(selected) ? selected : [selected];
        
        try {
            const iconBase64s = await invoke<Array<string | null>>("extract_icons_from_paths", {
                paths: paths,
            });

            const directories = paths.map((path) => {
                const lastSlash = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
                return lastSlash >= 0 ? path.substring(0, lastSlash) : path;
            });

            store.addLauncherItemsToCategory(currentCategoryId.value, {
                paths: paths,
                directories: directories,
                icon_base64s: iconBase64s,
            });

            lastAction.value = `已添加 ${paths.length} 个项目到类目`;
        } catch (e) {
            console.error("添加项目失败:", e);
            lastAction.value = `添加项目失败: ${e}`;
        }

        closeContextMenu();
    }

    /**
     * 处理"添加类目"菜单动作
     * 
     * 创建一个新的类目并进入编辑状态。
     * 
     * @returns {void}
     * 
     * @example
     * ```typescript
     * onAddCategory();
     * ```
     * 
     * @remarks
     * - 如果正在编辑其他类目，则跳过
     */
    function onAddCategory() {
        if (categoryStore.isEditingCategory) return;
        categoryStore.beginAddCategory();
        closeContextMenu();
    }

    /**
     * 处理"删除类目"菜单动作
     * 
     * 删除当前选中的类目及其所有启动项。
     * 
     * @returns {void}
     * 
     * @example
     * ```typescript
     * onDeleteCategory();
     * ```
     * 
     * @remarks
     * - 如果正在编辑类目，则跳过
     * - 需要 currentCategoryId 有效
     * - 会级联删除该类目下的所有启动项
     */
    async function onDeleteCategory() {
        if (categoryStore.isEditingCategory) return;
        if (!currentCategoryId.value) return;
        
        const confirmed = await confirm({
            title: "确认删除",
            message: "确定要删除此分类吗？该分类下的所有启动项也将被删除。",
            confirmText: "删除",
            cancelText: "取消",
        });
        
        if (!confirmed) {
            closeContextMenu();
            return;
        }
        
        categoryStore.deleteCategory(currentCategoryId.value);
        store.deleteCategoryCleanup(currentCategoryId.value);
        closeContextMenu();
    }

    /**
     * 处理"重命名类目"菜单动作
     * 
     * 进入类目重命名编辑状态。
     * 
     * @returns {void}
     * 
     * @example
     * ```typescript
     * onRenameCategory();
     * ```
     * 
     * @remarks
     * - 如果正在编辑类目，则跳过
     * - 需要 currentCategoryId 有效
     */
    function onRenameCategory() {
        if (categoryStore.isEditingCategory) return;
        if (!currentCategoryId.value) return;
        categoryStore.beginRenameCategory(currentCategoryId.value);
        closeContextMenu();
    }

    /**
     * 处理"设置分类图标列数"菜单动作
     * 
     * 设置分类页面每行显示的图标数量。
     * 
     * @param {number} cols - 每行图标数量（范围 4-8）
     * @returns {void}
     * 
     * @example
     * ```typescript
     * onSetCategoryCols(5);
     * ```
     */
    function onSetCategoryCols(cols: number) {
        uiStore.setCategoryCols(cols);
        lastAction.value = `分类图标：${cols}`;
        closeContextMenu();
    }

    /**
     * 处理"设置启动项图标列数"菜单动作
     * 
     * 设置启动项页面每行显示的图标数量。
     * 
     * @param {number} cols - 每行图标数量（范围 4-8）
     * @returns {void}
     * 
     * @example
     * ```typescript
     * onSetLauncherCols(6);
     * ```
     */
    function onSetLauncherCols(cols: number) {
        uiStore.setLauncherCols(cols);
        lastAction.value = `启动项图标：${cols}`;
        closeContextMenu();
    }

    /**
     * 处理"设置首页布局预置"菜单动作
     * 
     * 设置首页固定/最近分区的布局预置。
     * 
     * @param {HomeLayoutSectionKey} section - 分区类型（pinned/recent）
     * @param {HomeLayoutPresetKey} preset - 布局预置（如 '1x5', '2x5'）
     * @returns {void}
     * 
     * @example
     * ```typescript
     * onSetHomeLayoutPreset('pinned', '2x5');
     * ```
     */
    function onSetHomeLayoutPreset(
        section: HomeLayoutSectionKey,
        preset: HomeLayoutPresetKey
    ) {
        uiStore.setHomeSectionLayoutPreset(section, preset);
        closeContextMenu();
    }

    /**
     * 处理"编辑启动项"菜单动作
     * 
     * 跳转到启动项编辑页面。
     * 
     * @returns {void}
     * 
     * @example
     * ```typescript
     * onEditItem();
     * ```
     * 
     * @remarks
     * - 需要 currentCategoryId 和 currentLauncherItemId 有效
     * - 使用 Vue Router 进行页面跳转
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
     * 处理"删除启动项"菜单动作
     * 
     * 从类目中删除当前选中的启动项。
     * 
     * @returns {void}
     * 
     * @example
     * ```typescript
     * onDeleteItem();
     * ```
     * 
     * @remarks
     * - 需要 currentCategoryId 和 currentLauncherItemId 有效
     */
    async function onDeleteItem() {
        if (!currentCategoryId.value || !currentLauncherItemId.value) return;
        const confirmed = await confirm({
            title: "确认删除",
            message: "确定要删除此启动项吗？此操作不可撤销。",
            confirmText: "删除",
            cancelText: "取消",
        });
        if (!confirmed) return;
        store.deleteLauncherItem(
            currentCategoryId.value,
            currentLauncherItemId.value
        );
        closeContextMenu();
    }

    /**
     * 处理"隐藏窗口"菜单动作
     * 
     * 隐藏应用主窗口。
     * 
     * @returns {Promise<void>}
     * 
     * @example
     * ```typescript
     * await onHideWindow();
     * ```
     * 
     * @remarks
     * - 使用 Tauri 的 getCurrentWindow().hide() API
     * - 无论成功与否都会关闭菜单
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

    /**
     * 更换启动项图标
     * 
     * 设置启动项的自定义图标。
     * 
     * @param {string} base64 - 图标的 Base64 编码字符串
     * @returns {void}
     * 
     * @example
     * ```typescript
     * onChangeIcon('data:image/png;base64,iVBORw0KGgo...');
     * ```
     * 
     * @remarks
     * - 需要 currentCategoryId 和 currentLauncherItemId 有效
     */
    function onChangeIcon(base64: string) {
        if (!currentCategoryId.value || !currentLauncherItemId.value) return;
        store.setLauncherItemIcon(
            currentCategoryId.value,
            currentLauncherItemId.value,
            base64
        );
    }

    /**
     * 重置启动项图标
     * 
     * 将启动项图标恢复为默认值（原始图标）。
     * 
     * @returns {void}
     * 
     * @example
     * ```typescript
     * onResetIcon();
     * ```
     * 
     * @remarks
     * - 需要 currentCategoryId 和 currentLauncherItemId 有效
     */
    function onResetIcon() {
        if (!currentCategoryId.value || !currentLauncherItemId.value) return;
        store.resetLauncherItemIcon(
            currentCategoryId.value,
            currentLauncherItemId.value
        );
    }

    /**
     * 更换类目图标
     * 
     * 设置类目的自定义图标。
     * 
     * @param {string} base64 - 图标的 Base64 编码字符串
     * @returns {void}
     * 
     * @example
     * ```typescript
     * onChangeCategoryIcon('data:image/png;base64,iVBORw0KGgo...');
     * ```
     * 
     * @remarks
     * - 需要 currentCategoryId 有效
     */
    function onChangeCategoryIcon(base64: string) {
        if (!currentCategoryId.value) return;
        categoryStore.setCategoryIcon(currentCategoryId.value, base64);
    }

    /**
     * 重置类目图标
     * 
     * 将类目图标恢复为默认值。
     * 
     * @returns {void}
     * 
     * @example
     * ```typescript
     * onResetCategoryIcon();
     * ```
     * 
     * @remarks
     * - 需要 currentCategoryId 有效
     */
    function onResetCategoryIcon() {
        if (!currentCategoryId.value) return;
        categoryStore.resetCategoryIcon(currentCategoryId.value);
    }

    /**
     * 切换启动项固定状态
     * 
     * 将启动项添加到固定列表或从中移除。
     * 
     * @returns {void}
     * 
     * @example
     * ```typescript
     * onTogglePinned();
     * ```
     * 
     * @remarks
     * - 需要 currentCategoryId 和 currentLauncherItemId 有效
     */
    function onTogglePinned() {
        if (!currentCategoryId.value || !currentLauncherItemId.value) return;
        store.togglePinned(currentCategoryId.value, currentLauncherItemId.value);
    }

    /**
     * 打开设置页面
     * 
     * 导航到设置页面。
     * 
     * @returns {void}
     * 
     * @example
     * ```typescript
     * onOpenSettings();
     * ```
     */
    function onOpenSettings() {
        router.push("/settings");
    }

    /**
     * 打开关于页面
     * 
     * 导航到设置页面的关于子页面。
     * 
     * @returns {void}
     * 
     * @example
     * ```typescript
     * onOpenAbout();
     * ```
     */
    function onOpenAbout() {
        router.push("/settings/about");
    }

    /**
     * 菜单动作统一分发器
     * 
     * 根据动作类型分发到对应的处理函数。
     * 支持内置动作和插件扩展动作。
     * 
     * @param {MenuAction} action - 菜单动作对象
     * @param {MenuContext} ctx - 菜单上下文信息
     * @returns {Promise<void>}
     * 
     * @example
     * ```typescript
     * await onMenuAction({ kind: 'edit-item' }, context);
     * await onMenuAction({ kind: 'set-category-cols', cols: 5 }, context);
     * await onMenuAction({ kind: 'plugin-command', pluginId: 'my-plugin', commandId: 'do-something' }, context);
     * ```
     * 
     * @remarks
     * 支持的动作类型：
     * - `add-item` - 添加项目
     * - `edit-item` - 编辑启动项
     * - `delete-item` - 删除启动项
     * - `add-category` - 添加类目
     * - `delete-category` - 删除类目
     * - `rename-category` - 重命名类目
     * - `hide-window` - 隐藏窗口
     * - `set-category-cols` - 设置分类列数
     * - `set-launcher-cols` - 设置启动项列数
     * - `set-home-layout-preset` - 设置首页布局
     * - `toggle-pinned` / `toggle-favorite` - 切换固定状态
     * - `open-settings` - 打开设置
     * - `open-about` - 打开关于
     * - `open-guide` - 打开使用指南
     * - `change-icon` - 更换图标
     * - `reset-icon` - 重置图标
     * - `change-category-icon` - 更换类目图标
     * - `reset-category-icon` - 重置类目图标
     * - `plugin-onclick` - 插件点击回调
     * - `plugin-command` - 插件命令
     */
    async function onMenuAction(action: MenuAction, ctx: MenuContext) {
        if (action.kind === "add-item") return onAddItem();
        if (action.kind === "edit-item") return onEditItem();
        if (action.kind === "delete-item") return onDeleteItem();
        if (action.kind === "add-category") return onAddCategory();
        if (action.kind === "delete-category") return onDeleteCategory();
        if (action.kind === "rename-category") return onRenameCategory();
        if (action.kind === "hide-window") return onHideWindow();
        if (action.kind === "set-category-cols") return onSetCategoryCols(action.cols);
        if (action.kind === "set-launcher-cols") return onSetLauncherCols(action.cols);
        if (action.kind === "set-home-layout-preset") {
            const section = ctx.homeSection ?? action.section;
            return onSetHomeLayoutPreset(section, action.preset);
        }
        if (action.kind === "toggle-pinned" || action.kind === "toggle-favorite") {
            return onTogglePinned();
        }
        if (action.kind === "open-settings") return onOpenSettings();
        if (action.kind === "open-about") return onOpenAbout();
        if (action.kind === "open-guide") {
            router.push("/guide");
            return;
        }

        if (action.kind === "change-icon") {
            const base64 = await selectAndConvertIcon();
            if (base64) onChangeIcon(base64);
            return;
        }

        if (action.kind === "reset-icon") return onResetIcon();

        if (action.kind === "change-category-icon") {
            const base64 = await selectAndConvertIcon();
            if (base64) onChangeCategoryIcon(base64);
            return;
        }

        if (action.kind === "reset-category-icon") return onResetCategoryIcon();

        if (action.kind === "plugin-onclick") {
            await action.onClick(ctx);
            return;
        }

        if (action.kind === "plugin-command") {
            const commandId =
                action.commandId.includes(":")
                    ? action.commandId
                    : `${action.pluginId}:${action.commandId}`;
            executePluginCommand(commandId, ctx);
        }
    }

    return {
        onMenuAction,
        lastAction,
    };
}

/**
 * useMenuActions 返回值类型
 * 
 * @typedef {Object} MenuActionsComposable
 */
export type MenuActionsComposable = ReturnType<typeof useMenuActions>;
