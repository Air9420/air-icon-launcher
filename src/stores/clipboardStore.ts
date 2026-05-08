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
import { invokeOrThrow } from "../utils/invoke-wrapper";

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
    const favoriteHashes = ref<string[]>([]);

    async function syncFavoriteHashesToBackend() {
        try {
            await invokeOrThrow("set_clipboard_favorite_hashes", {
                hashes: favoriteHashes.value,
            });
        } catch (error) {
            console.warn("Failed to sync clipboard favorite hashes:", error);
        }
    }

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

    function replaceClipboardHistory(records: ClipboardRecord[]) {
        clipboardHistory.value = records;
        const recordHashes = new Set(records.map((record) => record.hash));
        favoriteHashes.value = favoriteHashes.value.filter((hash) => recordHashes.has(hash));
        void syncFavoriteHashesToBackend();
    }

    /**
     * 删除指定剪贴板记录
     *
     * @param id - 记录 ID
     */
    function removeClipboardRecord(id: string) {
        const index = clipboardHistory.value.findIndex(r => r.id === id);
        if (index !== -1) {
            const [removed] = clipboardHistory.value.splice(index, 1);
            if (removed) {
                favoriteHashes.value = favoriteHashes.value.filter((hash) => hash !== removed.hash);
                void syncFavoriteHashesToBackend();
            }
        }
    }

    /**
     * 清空所有剪贴板历史
     */
    function clearClipboardHistory() {
        clipboardHistory.value = [];
        favoriteHashes.value = [];
        void syncFavoriteHashesToBackend();
    }

    function isFavoriteHash(hash: string): boolean {
        return favoriteHashes.value.includes(hash);
    }

    function setFavoriteHash(hash: string, favorite: boolean) {
        if (!hash) return;
        if (favorite) {
            if (!favoriteHashes.value.includes(hash)) {
                favoriteHashes.value = [hash, ...favoriteHashes.value];
                void syncFavoriteHashesToBackend();
            }
            return;
        }
        if (!favoriteHashes.value.includes(hash)) {
            return;
        }
        favoriteHashes.value = favoriteHashes.value.filter((target) => target !== hash);
        void syncFavoriteHashesToBackend();
    }

    function toggleFavoriteHash(hash: string) {
        setFavoriteHash(hash, !isFavoriteHash(hash));
    }

    /**
     * 设置剪贴板功能开关
     *
     * @param enabled - 是否启用
     */
    function setClipboardHistoryEnabled(enabled: boolean) {
        clipboardHistoryEnabled.value = enabled;
    }

    function clearRuntimeClipboardHistoryView() {
        clipboardHistory.value = [];
        currentClipboardHash.value = null;
    }

    /**
     * 设置最大记录数
     *
     * @param value - 最大记录数，0 表示不限制
     */
    function setMaxRecords(value: number) {
        maxRecords.value = value;
        if (value > 0 && clipboardHistory.value.length > value) {
            const favoriteSet = new Set(favoriteHashes.value);
            const favorites = clipboardHistory.value.filter((record) => favoriteSet.has(record.hash));
            const nonFavorites = clipboardHistory.value.filter((record) => !favoriteSet.has(record.hash));
            const keptNonFavorites = nonFavorites.slice(0, value);
            clipboardHistory.value = [...favorites, ...keptNonFavorites]
                .sort((a, b) => b.timestamp - a.timestamp);
        }
    }

    return {
        clipboardHistory,
        clipboardHistoryEnabled,
        maxRecords,
        currentClipboardHash,
        favoriteHashes,
        addClipboardRecord,
        replaceClipboardHistory,
        removeClipboardRecord,
        clearClipboardHistory,
        setClipboardHistoryEnabled,
        clearRuntimeClipboardHistoryView,
        setMaxRecords,
        setCurrentClipboardHash,
        isFavoriteHash,
        setFavoriteHash,
        toggleFavoriteHash,
    };
}, { persist: createVersionedPersistConfig("clipboard", ["clipboardHistory", "clipboardHistoryEnabled", "maxRecords", "favoriteHashes"]) });
