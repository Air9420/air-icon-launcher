/**
 * @fileoverview 剪贴板历史管理 Store
 *
 * 提供剪贴板历史记录的管理功能，包括：
 * - 添加/删除/清空剪贴板记录
 * - 剪贴板功能开关
 * - 数据持久化
 *
 * @module stores/clipboardStore
 */

import { defineStore } from "pinia";
import { ref } from "vue";
import { createVersionedPersistConfig } from "../utils/versioned-persist";

/**
 * 剪贴板记录类型
 */
export type ClipboardRecord = {
    id: string;
    content: string;
    type: "text" | "image";
    timestamp: number;
};

/**
 * 剪贴板历史管理 Store
 *
 * @example
 * ```typescript
 * import { useClipboardStore } from '../stores/clipboardStore';
 *
 * const clipboardStore = useClipboardStore();
 *
 * // 添加记录
 * clipboardStore.addClipboardRecord({
 *   id: 'clip-1',
 *   content: '复制的文本',
 *   type: 'text',
 *   timestamp: Date.now()
 * });
 *
 * // 获取历史
 * console.log(clipboardStore.clipboardHistory);
 * ```
 */
export const useClipboardStore = defineStore("clipboard", () => {
    const clipboardHistory = ref<ClipboardRecord[]>([]);
    const clipboardHistoryEnabled = ref<boolean>(true);
    const maxRecords = ref<number>(100);

    /**
     * 添加剪贴板记录
     *
     * @param record - 剪贴板记录对象
     *
     * @remarks
     * - 如果内容已存在，不会重复添加
     * - 最多保留 maxRecords 条记录
     */
    function addClipboardRecord(record: ClipboardRecord) {
        const exists = clipboardHistory.value.some(r => r.content === record.content);
        if (!exists) {
            clipboardHistory.value.unshift(record);
            if (maxRecords.value > 0 && clipboardHistory.value.length > maxRecords.value) {
                clipboardHistory.value = clipboardHistory.value.slice(0, maxRecords.value);
            }
        }
    }

    /**
     * 删除指定剪贴板记录
     *
     * @param id - 记录 ID
     */
    function removeClipboardRecord(id: string) {
        const index = clipboardHistory.value.findIndex(r => r.id === id);
        if (index !== -1) {
            clipboardHistory.value.splice(index, 1);
        }
    }

    /**
     * 清空所有剪贴板历史
     */
    function clearClipboardHistory() {
        clipboardHistory.value = [];
    }

    /**
     * 设置剪贴板功能开关
     *
     * @param enabled - 是否启用
     */
    function setClipboardHistoryEnabled(enabled: boolean) {
        clipboardHistoryEnabled.value = enabled;
    }

    /**
     * 设置最大记录数
     *
     * @param value - 最大记录数，0 表示不限制
     */
    function setMaxRecords(value: number) {
        maxRecords.value = value;
        if (value > 0 && clipboardHistory.value.length > value) {
            clipboardHistory.value = clipboardHistory.value.slice(0, value);
        }
    }

    return {
        clipboardHistory,
        clipboardHistoryEnabled,
        maxRecords,
        addClipboardRecord,
        removeClipboardRecord,
        clearClipboardHistory,
        setClipboardHistoryEnabled,
        setMaxRecords,
    };
}, { persist: createVersionedPersistConfig("clipboard", ["clipboardHistory", "clipboardHistoryEnabled"]) as any });
