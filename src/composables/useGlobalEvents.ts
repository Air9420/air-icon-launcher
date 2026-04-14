/**
 * @fileoverview 全局 DOM 事件处理
 * 
 * 本模块提供全局 DOM 事件的统一管理功能，包括：
 * - 阻止浏览器刷新快捷键（Ctrl+R、F5）
 * - 阻止默认右键菜单
 * - 全局点击/键盘事件处理
 * - 窗口失焦处理
 * 
 * @module composables/useGlobalEvents
 * 
 * @requires ../stores - Pinia Store
 * 
 * @example
 * ```typescript
 * import { useGlobalEvents } from './composables/useGlobalEvents';
 * 
 * const { initializeGlobalEvents, cleanupGlobalEvents } = useGlobalEvents({
 *   closeContextMenu,
 * });
 * 
 * // 在 onMounted 中初始化
 * onMounted(() => {
 *   initializeGlobalEvents();
 * });
 * 
 * // 在 onBeforeUnmount 中清理
 * onBeforeUnmount(() => {
 *   cleanupGlobalEvents();
 * });
 * ```
 */

import { getCurrentWindow } from "@tauri-apps/api/window";
import { useSettingsStore } from "../stores";

/**
 * useGlobalEvents 配置选项
 */
interface UseGlobalEventsOptions {
    closeContextMenu: () => void;
}

/**
 * 全局事件处理 Composable
 * 
 * 提供全局 DOM 事件的统一注册和清理功能。
 * 注册的事件包括：
 * - `keydown`：拦截刷新快捷键
 * - `contextmenu`：阻止默认右键菜单
 * - `click`：全局点击时关闭菜单
 * - `keydown`（Escape）：关闭菜单
 * - `blur`：窗口失焦时关闭菜单
 * 
 * @param {UseGlobalEventsOptions} options - 配置选项
 * @returns {Object} 全局事件处理相关方法
 * @returns {Function} returns.initializeGlobalEvents - 初始化事件监听
 * @returns {Function} returns.cleanupGlobalEvents - 清理事件监听
 * 
 * @example
 * ```typescript
 * const { initializeGlobalEvents, cleanupGlobalEvents } = useGlobalEvents({
 *   closeContextMenu: () => store.closeContextMenu(),
 * });
 * ```
 * 
 * @remarks
 * - 所有事件监听器使用 capture 模式以确保优先处理
 * - 应在组件 onMounted 中调用 initializeGlobalEvents
 * - 应在组件 onBeforeUnmount 中调用 cleanupGlobalEvents
 */
export function useGlobalEvents(options: UseGlobalEventsOptions) {
    const { closeContextMenu } = options;

    /**
     * 阻止浏览器刷新快捷键
     * 
     * 拦截 Ctrl+R、Ctrl+Shift+R 和 F5 快捷键，
     * 防止用户误操作刷新桌面应用。
     * 
     * @param {KeyboardEvent} e - 键盘事件
     * @returns {void}
     * 
     * @example
     * ```typescript
     * window.addEventListener('keydown', preventRefreshShortcuts, true);
     * ```
     * 
     * @remarks
     * - 使用 capture 模式确保优先拦截
     * - 同时调用 preventDefault 和 stopPropagation
     */
    function preventRefreshShortcuts(e: KeyboardEvent) {
        const key = e.key.toLowerCase();
        if ((key === "r" && e.ctrlKey) || key === "f5") {
            e.preventDefault();
            e.stopPropagation();
        }
        if (key === "f" && e.ctrlKey) {
            e.preventDefault();
            e.stopPropagation();
        }
    }

    /**
     * 阻止默认右键菜单
     * 
     * 阻止浏览器默认的右键菜单弹出，
     * 以便显示应用自定义的右键菜单。
     * 
     * @param {MouseEvent} ev - 鼠标事件
     * @returns {void}
     * 
     * @remarks
     * - 使用 capture 模式确保优先拦截
     */
    function onContextMenu(ev: MouseEvent) {
        ev.preventDefault();
    }

    /**
     * 全局点击处理函数
     *
     * 当用户在页面任意位置点击时，
     * 关闭当前打开的右键菜单。
     *
     * @returns {void}
     */
    function onGlobalClick() {
        closeContextMenu();
    }

    function onWindowBlur() {
        closeContextMenu();
    }

    async function onGlobalMouseDown(event: MouseEvent) {
        const settingsStore = useSettingsStore();
        if (settingsStore.hideOnCtrlRightClick && event.ctrlKey && event.button === 2) {
            try {
                await getCurrentWindow().hide();
            } catch (e) {
                console.error(e);
            }
        }
    }

    /**
     * 全局键盘按下处理函数
     * 
     * 当用户按下 Escape 键时，
     * 关闭当前打开的右键菜单。
     * 
     * @param {KeyboardEvent} ev - 键盘事件
     * @returns {void}
     */
    function onGlobalKeyDown(ev: KeyboardEvent) {
        if (ev.key === "Escape") closeContextMenu();
    }

    /**
     * 初始化全局事件监听
     * 
     * 注册所有全局 DOM 事件监听器。
     * 
     * @returns {void}
     * 
     * @example
     * ```typescript
     * onMounted(() => {
     *   initializeGlobalEvents();
     * });
     * ```
     * 
     * @remarks
     * 注册的事件：
     * - `keydown`（capture）- 拦截刷新快捷键
     * - `contextmenu`（capture）- 阻止默认右键菜单
     * - `click` - 全局点击关闭菜单
     * - `keydown` - Escape 关闭菜单
     * - `blur` - 窗口失焦关闭菜单
     */
    function initializeGlobalEvents() {
        window.addEventListener("keydown", preventRefreshShortcuts, true);
        document.addEventListener("contextmenu", onContextMenu, { capture: true });
        window.addEventListener("click", onGlobalClick);
        window.addEventListener("keydown", onGlobalKeyDown);
        window.addEventListener("blur", onWindowBlur);
        window.addEventListener("mousedown", onGlobalMouseDown);
    }

    /**
     * 清理全局事件监听
     * 
     * 移除所有通过 initializeGlobalEvents 注册的事件监听器。
     * 
     * @returns {void}
     * 
     * @example
     * ```typescript
     * onBeforeUnmount(() => {
     *   cleanupGlobalEvents();
     * });
     * ```
     * 
     * @remarks
     * - 应在组件 onBeforeUnmount 中调用
     * - 防止内存泄漏
     */
    function cleanupGlobalEvents() {
        window.removeEventListener("keydown", preventRefreshShortcuts, true);
        document.removeEventListener("contextmenu", onContextMenu, { capture: true });
        window.removeEventListener("click", onGlobalClick);
        window.removeEventListener("keydown", onGlobalKeyDown);
        window.removeEventListener("blur", onWindowBlur);
        window.removeEventListener("mousedown", onGlobalMouseDown);
    }

    return {
        initializeGlobalEvents,
        cleanupGlobalEvents,
    };
}

/**
 * useGlobalEvents 返回值类型
 * 
 * @typedef {Object} GlobalEventsComposable
 */
export type GlobalEventsComposable = ReturnType<typeof useGlobalEvents>;
