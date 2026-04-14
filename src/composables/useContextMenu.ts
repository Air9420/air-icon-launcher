/**
 * @fileoverview 右键菜单状态管理与操作
 * 
 * 本模块提供右键菜单的核心功能，包括：
 * - 菜单的打开/关闭控制
 * - 菜单位置计算（自动边界检测）
 * - 菜单上下文状态管理（当前选中的类目、启动项等）
 * - DOM 元素信息提取
 * 
 * @module composables/useContextMenu
 * 
 * @requires vue - Vue 响应式系统
 * @requires ../stores - Pinia Store
 * 
 * @example
 * ```typescript
 * import { useContextMenu } from './composables/useContextMenu';
 * 
 * const {
 *   currentCategoryId,
 *   currentLauncherItemId,
 *   openContextMenu,
 *   closeContextMenu,
 * } = useContextMenu();
 * 
 * // 在模板中使用
 * <div @contextmenu="openContextMenu">...</div>
 * ```
 */

import { ref, nextTick } from "vue";
import { useUIStore } from "../stores/uiStore";
import { enumContextMenuType } from "../menus/contextMenuTypes";
import { useCategoryStore } from "../stores/categoryStore";
import type { HomeLayoutSectionKey } from "../stores/uiStore";
import type { DropTargetInfo } from "./types";

/**
 * 右键菜单状态管理 Composable
 * 
 * 提供右键菜单的完整状态管理和操作方法。
 * 该 Composable 采用单例模式，多次调用返回相同的状态引用。
 * 
 * @returns {Object} 右键菜单相关状态和方法
 * @returns {Ref<string | null>} returns.currentCategoryId - 当前选中的类目 ID
 * @returns {Ref<string | null>} returns.currentLauncherItemId - 当前选中的启动项 ID
 * @returns {Ref<HomeLayoutSectionKey | null>} returns.currentHomeSection - 当前首页分区
 * @returns {Function} returns.openContextMenu - 打开右键菜单
 * @returns {Function} returns.closeContextMenu - 关闭右键菜单
 * @returns {Function} returns.getContextMenuPosition - 计算菜单位置
 * @returns {Function} returns.getDropTargetInfoAtPoint - 获取坐标处元素信息
 * 
 * @example
 * ```typescript
 * const {
 *   currentCategoryId,
 *   currentLauncherItemId,
 *   openContextMenu,
 *   closeContextMenu,
 * } = useContextMenu();
 * 
 * // 打开菜单
 * await openContextMenu(mouseEvent);
 * 
 * // 关闭菜单
 * closeContextMenu();
 * ```
 * 
 * @remarks
 * - 该 Composable 内部使用 Pinia Store 管理菜单可见性
 * - 打开菜单时会自动进行边界检测，确保菜单不超出窗口
 * - 支持二次定位策略，解决菜单内容动态加载导致的尺寸变化问题
 */
export function useContextMenu() {
    const uiStore = useUIStore();
    const categoryStore = useCategoryStore();

    const currentCategoryId = ref<string | null>(null);
    const currentLauncherItemId = ref<string | null>(null);
    const currentHomeSection = ref<HomeLayoutSectionKey | null>(null);

    /**
     * 根据窗口坐标获取 DOM 元素信息
     * 
     * 使用 `document.elementFromPoint` 获取指定坐标处最上层的 DOM 元素，
     * 并提取其标签名、ID、类名列表和 data-* 属性。
     * 
     * @param {number} x - 窗口横坐标
     * @param {number} y - 窗口纵坐标
     * @returns {DropTargetInfo | null} 元素信息，如果坐标处无元素则返回 null
     * 
     * @example
     * ```typescript
     * const info = getDropTargetInfoAtPoint(100, 200);
     * console.log(info?.dataset.menuType); // 'icon-item'
     * ```
     * 
     * @remarks
     * - 会优先查找带有 `data-menu-type` 属性的父元素
     * - 用于拖拽操作时判断落点的语义上下文
     */
    function getDropTargetInfoAtPoint(x: number, y: number): DropTargetInfo | null {
        const el = document.elementFromPoint(x, y);
        if (!el) return null;

        const dataset: Record<string, string> = {};
        const baseEl =
            el instanceof HTMLElement ? el.closest("[data-menu-type]") ?? el : el;
        if (baseEl instanceof HTMLElement) {
            for (const [k, v] of Object.entries(baseEl.dataset)) {
                if (typeof v === "string") dataset[k] = v;
            }
        }

        return {
            tag_name: baseEl.tagName,
            id: baseEl.id ? baseEl.id : null,
            class_list: Array.from(baseEl.classList),
            dataset,
        };
    }

    /**
     * 获取右键菜单的当前尺寸
     * 
     * 通过查询 `.context-menu` CSS 选择器获取菜单 DOM 元素，
     * 返回其 offsetWidth 和 offsetHeight。
     * 
     * @returns {Object} 菜单尺寸
     * @returns {number} returns.width - 菜单宽度（默认 220px）
     * @returns {number} returns.height - 菜单高度（默认 110px）
     * 
     * @example
     * ```typescript
     * const { width, height } = getContextMenuSize();
     * console.log(`菜单尺寸: ${width}x${height}`);
     * ```
     * 
     * @remarks
     * - 如果菜单尚未渲染，返回默认值 220x110
     * - 用于菜单位置计算时的边界检测
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
     * 计算右键菜单在窗口内的安全显示位置
     * 
     * 根据鼠标点击位置和菜单尺寸，计算菜单的最佳显示坐标，
     * 确保菜单不会超出窗口边界。
     * 
     * @param {number} clientX - 鼠标点击的 X 坐标
     * @param {number} clientY - 鼠标点击的 Y 坐标
     * @returns {Object} 菜单左上角坐标
     * @returns {number} returns.x - 计算后的 X 坐标
     * @returns {number} returns.y - 计算后的 Y 坐标
     * 
     * @example
     * ```typescript
     * const { x, y } = getContextMenuPosition(event.clientX, event.clientY);
     * store.openContextMenu(x, y);
     * ```
     * 
     * @remarks
     * - 边距保护为 8px
     * - 使用 `Math.min/Math.max` 确保坐标在有效范围内
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
     * 等待下一帧渲染完成
     * 
     * 封装 `requestAnimationFrame` 为 Promise，
     * 用于等待 DOM 布局更新完成。
     * 
     * @returns {Promise<void>} 下一帧完成时 resolve
     * 
     * @example
     * ```typescript
     * await nextFrame();
     * // 此时 DOM 已完成渲染
     * ```
     * 
     * @remarks
     * - 用于菜单打开后等待布局渲染完成
     * - 配合 `nextTick` 使用可确保 Vue 响应式更新和 DOM 渲染都已完成
     */
    function nextFrame() {
        return new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve())
        );
    }

    /**
     * 从事件目标查找最近的菜单语义节点
     * 
     * 向上遍历 DOM 树，查找带有 `data-menu-type` 属性的最近父元素。
     * 用于确定右键点击的上下文类型。
     * 
     * @param {unknown} target - 事件目标对象（通常是 MouseEvent.target）
     * @returns {HTMLElement | null} 带有 data-menu-type 的元素，未找到返回 null
     * 
     * @example
     * ```typescript
     * const menuTarget = getMenuTargetFromEventTarget(event.target);
     * if (menuTarget) {
     *   const menuType = menuTarget.dataset.menuType;
     * }
     * ```
     * 
     * @remarks
     * - 支持处理文本节点（会先获取其父元素）
     * - 如果目标本身是 HTMLElement，直接调用 `closest`
     */
    function getMenuTargetFromEventTarget(target: unknown): HTMLElement | null {
        if (target instanceof HTMLElement) {
            return target.closest("[data-menu-type]");
        }
        if (target instanceof Node) {
            const parentEl = target.parentElement;
            return parentEl ? parentEl.closest("[data-menu-type]") : null;
        }
        return null;
    }

    /**
     * 判断事件目标是否处于可编辑区域
     * 
     * 检查目标元素是否为输入框、文本域或可编辑元素。
     * 用于在可编辑区域右键时跳过自定义菜单，保留系统默认行为。
     * 
     * @param {unknown} target - 事件目标对象
     * @returns {boolean} 如果在可编辑区域返回 true
     * 
     * @example
     * ```typescript
     * if (isEditableEventTarget(event.target)) {
     *   return; // 跳过自定义菜单
     * }
     * ```
     * 
     * @remarks
     * 匹配的选择器：
     * - `input` - 输入框
     * - `textarea` - 文本域
     * - `[contenteditable='true']` - 可编辑元素
     * - `[contenteditable='']` - 可编辑元素（空值）
     * - `[role='textbox']` - 文本框角色
     */
    function isEditableEventTarget(target: unknown): boolean {
        const selector =
            "input, textarea, [contenteditable='true'], [contenteditable=''], [role='textbox']";
        if (target instanceof HTMLElement) return !!target.closest(selector);
        if (target instanceof Node)
            return !!target.parentElement?.closest(selector);
        return false;
    }

    /**
     * 打开自定义右键菜单
     * 
     * 根据鼠标事件打开右键菜单，自动设置上下文状态并计算显示位置。
     * 采用二次定位策略，确保菜单在内容加载后位置正确。
     * 
     * @param {MouseEvent} e - 鼠标事件对象
     * @returns {Promise<void>} 异步操作完成时 resolve
     * 
     * @example
     * ```vue
     * <template>
     *   <div @contextmenu="openContextMenu">右键点击</div>
     * </template>
     * ```
     * 
     * @remarks
     * 执行流程：
     * 1. 阻止默认右键菜单
     * 2. 检查是否正在编辑类目（是则跳过）
     * 3. 检查是否在可编辑区域（是则跳过）
     * 4. 获取菜单目标元素和类型
     * 5. 设置上下文状态（categoryId、itemId、homeSection）
     * 6. 计算初始位置并打开菜单
     * 7. 等待 Vue 更新和下一帧渲染
     * 8. 重新计算位置（菜单尺寸可能已变化）
     * 9. 如有需要则调整位置
     * 
     * @see {@link closeContextMenu} 关闭菜单
     */
    async function openContextMenu(e: MouseEvent) {
        e.preventDefault();
        if (categoryStore.isEditingCategory) return;
        if (isEditableEventTarget(e?.target)) return;

        const menuTarget = getMenuTargetFromEventTarget(e?.target);
        if (!menuTarget) return;

        const menuType = menuTarget.dataset.menuType as enumContextMenuType;
        if (!menuType) return;

        uiStore.ContextMenuType = menuType;

        currentCategoryId.value =
            menuType === enumContextMenuType.HomeGroupItem ||
                menuType === enumContextMenuType.IconView ||
                menuType === enumContextMenuType.IconItem
                ? menuTarget.dataset.categoryId || null
                : null;

        currentLauncherItemId.value =
            menuType === enumContextMenuType.IconItem
                ? menuTarget.dataset.itemId || null
                : null;

        currentHomeSection.value =
            menuType === enumContextMenuType.IconItem
                ? (menuTarget.dataset.homeSection as HomeLayoutSectionKey | undefined) ??
                null
                : null;

        if (currentCategoryId.value) {
            categoryStore.setCurrentCategory(currentCategoryId.value);
        }

        const initial = getContextMenuPosition(e.clientX, e.clientY);
        uiStore.openContextMenu(initial.x, initial.y);

        await nextTick();
        await nextFrame();

        const adjusted = getContextMenuPosition(e.clientX, e.clientY);
        if (adjusted.x !== initial.x || adjusted.y !== initial.y) {
            uiStore.openContextMenu(adjusted.x, adjusted.y);
        }
    }

    /**
     * 关闭右键菜单
     * 
     * 调用 Pinia Store 的 closeContextMenu 方法关闭菜单。
     * 
     * @example
     * ```typescript
     * closeContextMenu();
     * ```
     * 
     * @see {@link openContextMenu} 打开菜单
     */
    function closeContextMenu() {
        uiStore.closeContextMenu();
    }

    return {
        currentCategoryId,
        currentLauncherItemId,
        currentHomeSection,
        openContextMenu,
        closeContextMenu,
        getContextMenuPosition,
        getDropTargetInfoAtPoint,
    };
}

/**
 * useContextMenu 返回值类型
 * 
 * @typedef {Object} ContextMenuComposable
 */
export type ContextMenuComposable = ReturnType<typeof useContextMenu>;
