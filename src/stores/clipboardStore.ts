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
import { convertFileSrc } from "@tauri-apps/api/core";

/**
 * 剪贴板记录类型
 */
export type ClipboardRecord = {
    id: string;
    content_type: "text" | "image";
    text_content: string | null;
    image_path: string | null;
    hash: string;
    timestamp: number;
};

export function getRecordContent(record: ClipboardRecord): string {
    if (record.content_type === "image" && record.image_path) {
        return convertFileSrc(record.image_path);
    }
    return record.text_content || "";
}

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
    const currentClipboardHash = ref<string | null>(null);

    function addClipboardRecord(record: ClipboardRecord, forcePromote: boolean = false) {
        const existingIndex = clipboardHistory.value.findIndex(r => r.hash === record.hash);
        if (existingIndex !== -1) {
            if (forcePromote) {
                clipboardHistory.value.splice(existingIndex, 1);
                clipboardHistory.value.unshift(record);
            }
        } else {
            clipboardHistory.value.unshift(record);
            if (maxRecords.value > 0 && clipboardHistory.value.length > maxRecords.value) {
                clipboardHistory.value = clipboardHistory.value.slice(0, maxRecords.value);
            }
        }
    }

    function setCurrentClipboardHash(hash: string | null) {
        currentClipboardHash.value = hash;
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
        currentClipboardHash,
        addClipboardRecord,
        removeClipboardRecord,
        clearClipboardHistory,
        setClipboardHistoryEnabled,
        setMaxRecords,
        setCurrentClipboardHash,
    };
}, { persist: createVersionedPersistConfig("clipboard", ["clipboardHistory", "clipboardHistoryEnabled"]) });
