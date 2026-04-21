/**
 * @fileoverview Composables 模块的类型定义
 * 
 * 本文件定义了 composables 系统中使用的基础类型，包括：
 * - 拖拽相关的类型（位置、目标信息、记录）
 * - 右键菜单状态类型
 * - 菜单动作上下文类型
 * 
 * @module composables/types
 */

import type { HomeLayoutSectionKey } from "../stores";

/**
 * 表示拖拽操作在窗口中的坐标位置
 * 
 * @typedef {Object} DropPosition
 * @property {number} x - 窗口横坐标
 * @property {number} y - 窗口纵坐标
 */

/**
 * 拖拽操作在窗口中的坐标位置
 * 
 * @example
 * ```typescript
 * const position: DropPosition = { x: 100, y: 200 };
 * ```
 */
export type DropPosition = {
    x: number;
    y: number;
};

/**
 * 拖拽目标元素的完整信息
 * 
 * 用于描述拖拽操作落地时，鼠标位置下方的 DOM 元素信息。
 * 这些信息会被传递给 Tauri 后端，用于判断落点的语义上下文。
 * 
 * @typedef {Object} DropTargetInfo
 * @property {string} tag_name - DOM 元素标签名（大写）
 * @property {string | null} id - 元素 id 属性
 * @property {string[]} class_list - CSS 类名数组
 * @property {Record<string, string>} dataset - data-* 自定义属性集合
 * 
 * @example
 * ```typescript
 * const target: DropTargetInfo = {
 *   tag_name: 'DIV',
 *   id: 'my-element',
 *   class_list: ['icon-item', 'draggable'],
 *   dataset: { menuType: 'icon-item', categoryId: 'cat-1' }
 * };
 * ```
 */
export type DropTargetInfo = {
    tag_name: string;
    id: string | null;
    class_list: string[];
    dataset: Record<string, string>;
};

/**
 * 完整的拖拽操作记录
 * 
 * 由 Tauri 后端通过事件传递，包含一次拖拽操作的所有数据。
 * 用于将外部文件/文件夹添加到启动器类目中。
 * 
 * @typedef {Object} DropRecord
 * @property {string} drop_id - 拖拽操作唯一标识符
 * @property {string[]} paths - 被拖拽文件路径数组
 * @property {string[]} directories - 被拖拽目录路径数组
 * @property {Array<string | null>} icon_base64s - 图标 Base64 编码数组
 * @property {DropPosition} position - 拖拽落点坐标
 * @property {DropTargetInfo | null} target - 目标元素信息
 * 
 * @example
 * ```typescript
 * const record: DropRecord = {
 *   drop_id: 'drop-123456',
 *   paths: ['C:/Program Files/App/app.exe'],
 *   directories: [],
 *   icon_base64s: ['iVBORw0KGgo...'],
 *   position: { x: 100, y: 200 },
 *   target: { tag_name: 'DIV', id: null, class_list: [], dataset: {} }
 * };
 * ```
 */
export type DropRecord = {
    drop_id: string;
    paths: string[];
    directories: string[];
    icon_base64s: Array<string | null>;
    position: DropPosition;
    target: DropTargetInfo | null;
};

export type DropIconsEvent = {
    drop_id: string;
    icon_base64s: Array<string | null>;
};

/**
 * 右键菜单的上下文状态
 * 
 * 表示当前右键菜单操作所涉及的上下文信息，
 * 包括当前选中的类目、启动项和首页分区。
 * 
 * @typedef {Object} ContextMenuState
 * @property {string | null} currentCategoryId - 当前选中的类目 ID
 * @property {string | null} currentLauncherItemId - 当前选中的启动项 ID
 * @property {HomeLayoutSectionKey | null} currentHomeSection - 当前首页分区（固定/最近）
 * 
 * @example
 * ```typescript
 * const state: ContextMenuState = {
 *   currentCategoryId: 'cat-1',
 *   currentLauncherItemId: 'item-123',
 *   currentHomeSection: 'pinned'
 * };
 * ```
 */
export type ContextMenuState = {
    currentCategoryId: string | null;
    currentLauncherItemId: string | null;
    currentHomeSection: HomeLayoutSectionKey | null;
};

/**
 * 菜单动作执行的完整上下文
 * 
 * 继承自 ContextMenuState，并添加了拖拽相关的数据。
 * 用于在菜单动作处理函数中获取完整的执行上下文。
 * 
 * @typedef {Object} MenuActionContext
 * @extends ContextMenuState
 * @property {DropRecord | null} lastDrop - 最近一次拖拽记录
 * @property {Set<string>} processedDropIds - 已处理的拖拽 ID 集合（用于去重）
 * 
 * @example
 * ```typescript
 * const ctx: MenuActionContext = {
 *   currentCategoryId: 'cat-1',
 *   currentLauncherItemId: 'item-123',
 *   currentHomeSection: 'pinned',
 *   lastDrop: { drop_id: 'drop-1', paths: [], ... },
 *   processedDropIds: new Set(['drop-1', 'drop-2'])
 * };
 * ```
 */
export type MenuActionContext = ContextMenuState & {
    lastDrop: DropRecord | null;
    processedDropIds: Set<string>;
};
