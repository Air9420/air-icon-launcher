/**
 * @fileoverview Composables 模块统一导出入口
 * 
 * 本模块提供 Vue Composables 的统一导出，包括：
 * 
 * ## 类型定义
 * - {@link DropPosition} - 拖拽坐标位置
 * - {@link DropTargetInfo} - 拖拽目标元素信息
 * - {@link DropRecord} - 拖拽操作记录
 * - {@link ContextMenuState} - 右键菜单状态
 * - {@link MenuActionContext} - 菜单动作上下文
 * 
 * ## Composables
 * - {@link useContextMenu} - 右键菜单状态管理
 * - {@link useMenuActions} - 菜单动作处理
 * - {@link useDragDrop} - 拖拽事件处理
 * - {@link useTauriEvents} - Tauri 事件监听
 * - {@link useGlobalEvents} - 全局 DOM 事件处理
 * - {@link useTheme} - 主题管理
 * - {@link useWindowDrag} - 窗口拖拽功能
 * 
 * @module composables
 * 
 * @example
 * ```typescript
 * // 导入单个 Composable
 * import { useContextMenu } from './composables';
 * 
 * // 导入多个 Composables
 * import { 
 *   useContextMenu, 
 *   useMenuActions, 
 *   useDragDrop 
 * } from './composables';
 * 
 * // 导入类型
 * import type { DropRecord, ContextMenuState } from './composables';
 * ```
 * 
 * @see {@link useContextMenu} - 右键菜单管理
 * @see {@link useMenuActions} - 菜单动作处理
 * @see {@link useDragDrop} - 拖拽处理
 * @see {@link useTauriEvents} - Tauri 事件
 * @see {@link useGlobalEvents} - 全局事件
 * @see {@link useTheme} - 主题管理
 * @see {@link useWindowDrag} - 窗口拖拽
 */

export * from "./types";
export * from "./useContextMenu";
export * from "./useMenuActions";
export * from "./useDragDrop";
export * from "./useTauriEvents";
export * from "./useGlobalEvents";
export * from "./useTheme";
export * from "./useWindowDrag";
