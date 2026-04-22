/**
 * @fileoverview 窗口拖拽功能
 * 
 * 本模块提供通过鼠标拖拽移动窗口的功能，包括：
 * - Ctrl + 鼠标左键拖拽窗口
 * - 自动排除交互元素（按钮、输入框等）
 * - 支持自定义排除标记（data-no-drag）
 * 
 * @module composables/useWindowDrag
 * 
 * @requires pinia - Pinia Store
 * @requires @tauri-apps/api/window - Tauri 窗口 API
 * @requires ../stores - 应用 Store
 * 
 * @example
 * ```typescript
 * import { useWindowDrag } from './composables/useWindowDrag';
 * 
 * const { initializeWindowDrag, cleanupWindowDrag } = useWindowDrag();
 * 
 * // 在 onMounted 中初始化
 * onMounted(() => {
 *   initializeWindowDrag();
 * });
 * 
 * // 在 onBeforeUnmount 中清理
 * onBeforeUnmount(() => {
 *   cleanupWindowDrag();
 * });
 * ```
 */

import { storeToRefs } from "pinia";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useSettingsStore } from "../stores/settingsStore";

/**
 * 窗口拖拽 Composable
 * 
 * 提供通过 Ctrl + 鼠标左键拖拽移动窗口的功能。
 * 自动排除交互元素，避免影响正常的点击操作。
 * 
 * @returns {Object} 窗口拖拽相关方法
 * @returns {Function} returns.initializeWindowDrag - 初始化拖拽监听
 * @returns {Function} returns.cleanupWindowDrag - 清理拖拽监听
 * 
 * @example
 * ```typescript
 * const { initializeWindowDrag, cleanupWindowDrag } = useWindowDrag();
 * 
 * onMounted(() => {
 *   initializeWindowDrag();
 * });
 * 
 * onBeforeUnmount(() => {
 *   cleanupWindowDrag();
 * });
 * ```
 * 
 * @remarks
 * 触发条件：
 * - `ctrlDragEnabled` Store 设置为 true
 * - 按住 Ctrl 键
 * - 鼠标左键按下
 * - 点击目标不是交互元素
 * 
 * 排除的元素：
 * - `BUTTON`, `INPUT`, `TEXTAREA`, `SELECT`, `A`, `OPTION` 标签
 * - 带有 `data-no-drag` 属性的元素
 * - `cursor: pointer` 样式的元素
 */
export function useWindowDrag() {
    const settingsStore = useSettingsStore();
    const { ctrlDragEnabled } = storeToRefs(settingsStore);

    /**
     * 判断元素是否应排除在拖拽区域之外
     * 
     * 检查元素及其父元素是否为交互元素或标记为不可拖拽。
     * 
     * @param {HTMLElement | null} element - 要检查的元素
     * @returns {boolean} 如果应排除返回 true
     * 
     * @example
     * ```typescript
     * if (shouldExcludeFromDrag(event.target)) {
     *   return; // 不触发拖拽
     * }
     * ```
     * 
     * @remarks
     * 排除规则（按优先级）：
     * 1. 元素为 null → 不排除
     * 2. 标签为交互元素（BUTTON, INPUT 等） → 排除
     * 3. 有 `data-no-drag` 属性 → 排除
     * 4. `cursor: pointer` 样式 → 排除
     * 5. 递归检查父元素
     */
    function shouldExcludeFromDrag(element: HTMLElement | null): boolean {
        const interactiveTags = ['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'A', 'OPTION'];
        let current = element;
        let depth = 0;

        while (current && depth < 6) {
            if (interactiveTags.includes(current.tagName)) return true;
            if (current.hasAttribute('data-no-drag')) return true;

            const style = window.getComputedStyle(current);
            if (style.cursor === 'pointer') return true;

            if (!current.parentElement || current.parentElement === document.body) {
                break;
            }

            current = current.parentElement;
            depth += 1;
        }

        return false;
    }

    /**
     * 全局鼠标按下处理函数
     * 
     * 检查是否满足拖拽条件，如果满足则启动窗口拖拽。
     * 
     * @param {MouseEvent} event - 鼠标事件
     * @returns {void}
     * 
     * @remarks
     * 检查顺序：
     * 1. `ctrlDragEnabled` 是否启用
     * 2. 是否按住 Ctrl 键
     * 3. 是否为鼠标左键
     * 4. 点击目标是否可拖拽
     */
    function onGlobalMouseDown(event: MouseEvent) {
        if (!ctrlDragEnabled.value) return;
        if (!event.ctrlKey) return;
        if (event.button !== 0) return;

        const target = event.target as HTMLElement;
        if (shouldExcludeFromDrag(target)) return;

        event.preventDefault();
        getCurrentWindow().startDragging();
    }

    /**
     * 初始化窗口拖拽监听
     * 
     * 注册全局 mousedown 事件监听器。
     * 
     * @returns {void}
     * 
     * @example
     * ```typescript
     * onMounted(() => {
     *   initializeWindowDrag();
     * });
     * ```
     * 
     * @remarks
     * - 使用 capture 模式确保优先处理
     * - 应在组件 onMounted 中调用
     */
    function initializeWindowDrag() {
        window.addEventListener("mousedown", onGlobalMouseDown, true);
    }

    /**
     * 清理窗口拖拽监听
     * 
     * 移除全局 mousedown 事件监听器。
     * 
     * @returns {void}
     * 
     * @example
     * ```typescript
     * onBeforeUnmount(() => {
     *   cleanupWindowDrag();
     * });
     * ```
     * 
     * @remarks
     * - 应在组件 onBeforeUnmount 中调用
     * - 防止内存泄漏
     */
    function cleanupWindowDrag() {
        window.removeEventListener("mousedown", onGlobalMouseDown, true);
    }

    return {
        initializeWindowDrag,
        cleanupWindowDrag,
    };
}

/**
 * useWindowDrag 返回值类型
 * 
 * @typedef {Object} WindowDragComposable
 */
export type WindowDragComposable = ReturnType<typeof useWindowDrag>;
