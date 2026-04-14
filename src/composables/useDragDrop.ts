/**
 * @fileoverview 拖拽事件处理
 * 
 * 本模块提供拖拽操作的事件监听和处理功能，包括：
 * - Tauri 拖拽事件的监听
 * - 拖拽目标元素的识别
 * - 自动将拖拽项目添加到类目
 * 
 * @module composables/useDragDrop
 * 
 * @requires vue - Vue 响应式系统
 * @requires @tauri-apps/api/event - Tauri 事件 API
 * @requires @tauri-apps/api/core - Tauri 核心 API
 * @requires ../stores - Pinia Store
 * @requires ./types - Composables 类型定义
 * 
 * @example
 * ```typescript
 * import { useDragDrop } from './composables/useDragDrop';
 * 
 * const { initializeDragDrop, cleanupDragDrop, lastDrop } = useDragDrop({
 *   getDropTargetInfoAtPoint,
 * });
 * 
 * // 在 onMounted 中初始化
 * onMounted(() => {
 *   initializeDragDrop();
 * });
 * 
 * // 在 onBeforeUnmount 中清理
 * onBeforeUnmount(() => {
 *   cleanupDragDrop();
 * });
 * ```
 */

import { ref } from "vue";
import { listen } from "@tauri-apps/api/event";
import { safeInvoke } from "../utils/invoke-wrapper";
import { Store } from "../stores";
import { useCategoryStore } from "../stores/categoryStore";
import { enumContextMenuType } from "../menus/contextMenuTypes";
import type { DropRecord, DropTargetInfo } from "./types";

/**
 * useDragDrop 配置选项
 * 
 * @interface UseDragDropOptions
 * @property {Function} getDropTargetInfoAtPoint - 根据坐标获取 DOM 元素信息的函数
 */
export interface UseDragDropOptions {
    getDropTargetInfoAtPoint: (x: number, y: number) => DropTargetInfo | null;
}

/**
 * 拖拽事件处理 Composable
 * 
 * 提供拖拽事件的监听和处理功能。
 * 当用户将文件/文件夹拖拽到应用窗口时，自动识别目标类目并添加项目。
 * 
 * @param {UseDragDropOptions} options - 配置选项
 * @returns {Object} 拖拽处理相关状态和方法
 * @returns {Ref<DropRecord | null>} returns.lastDrop - 最近一次拖拽记录
 * @returns {Set<string>} returns.processedDropIds - 已处理的拖拽 ID 集合
 * @returns {Function} returns.initializeDragDrop - 初始化拖拽监听
 * @returns {Function} returns.cleanupDragDrop - 清理拖拽监听
 * 
 * @example
 * ```typescript
 * const { 
 *   lastDrop, 
 *   processedDropIds, 
 *   initializeDragDrop, 
 *   cleanupDragDrop 
 * } = useDragDrop({
 *   getDropTargetInfoAtPoint: (x, y) => {
 *     // 返回坐标处的元素信息
 *     return { tag_name: 'DIV', id: null, class_list: [], dataset: {} };
 *   }
 * });
 * ```
 * 
 * @remarks
 * - 需要在组件挂载时调用 `initializeDragDrop()`
 * - 需要在组件卸载时调用 `cleanupDragDrop()` 防止内存泄漏
 * - 使用 `processedDropIds` 防止同一次拖拽被重复处理
 */
export function useDragDrop(options: UseDragDropOptions) {
    const { getDropTargetInfoAtPoint } = options;
    const store = Store();
    const categoryStore = useCategoryStore();

    const lastDrop = ref<DropRecord | null>(null);
    const processedDropIds = new Set<string>();

    let unlistenDragDrop: (() => void) | null = null;

    /**
     * 初始化拖拽事件监听
     * 
     * 注册 Tauri 的 `drag-drop` 事件监听器。
     * 当拖拽事件发生时，自动识别目标类目并添加项目。
     * 
     * @returns {Promise<void>} 初始化完成时 resolve
     * 
     * @example
     * ```typescript
     * onMounted(async () => {
     *   await initializeDragDrop();
     * });
     * ```
     * 
     * @remarks
     * 执行流程：
     * 1. 监听 Tauri 的 `drag-drop` 事件
     * 2. 记录拖拽数据到 `lastDrop`
     * 3. 获取拖拽落点的 DOM 元素信息
     * 4. 向后端报告拖拽目标（用于 Rust 端处理）
     * 5. 如果目标元素是有效的类目区域，自动添加项目
     * 
     * 有效目标条件：
     * - menuType 为 IconView、IconItem 或 CategorieItem
     * - 存在 categoryId
     * - paths 不为空
     * - 拖拽未被处理过
     */
    async function initializeDragDrop() {
        unlistenDragDrop = await listen<DropRecord>("drag-drop", async (event) => {
            lastDrop.value = event.payload;
            const { drop_id, position, paths, directories, icon_base64s } =
                event.payload;
            const target = getDropTargetInfoAtPoint(position.x, position.y);
            await safeInvoke("report_drop_target", { dropId: drop_id, target });

            const menuType = target?.dataset?.menuType as
                | enumContextMenuType
                | undefined;
            const categoryId = target?.dataset?.categoryId;

            if (
                (menuType === enumContextMenuType.IconView ||
                    menuType === enumContextMenuType.IconItem ||
                    menuType === enumContextMenuType.HomeGroupItem) &&
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
                categoryStore.setCurrentCategory(categoryId);
            }
        });
    }

    /**
     * 清理拖拽事件监听
     * 
     * 移除 Tauri 的 `drag-drop` 事件监听器。
     * 应在组件卸载时调用，防止内存泄漏。
     * 
     * @example
     * ```typescript
     * onBeforeUnmount(() => {
     *   cleanupDragDrop();
     * });
     * ```
     */
    function cleanupDragDrop() {
        if (unlistenDragDrop) {
            unlistenDragDrop();
            unlistenDragDrop = null;
        }
    }

    return {
        lastDrop,
        processedDropIds,
        initializeDragDrop,
        cleanupDragDrop,
    };
}

/**
 * useDragDrop 返回值类型
 * 
 * @typedef {Object} DragDropComposable
 */
export type DragDropComposable = ReturnType<typeof useDragDrop>;
