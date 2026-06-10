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
    content_subtype: string | null;
    text_content: string | null;
    image_path: string | null;
    hash: string;
    timestamp: number;
    is_favorite: boolean;
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
    const currentClipboardHash = ref<string | null>(null);
    const historyLoaded = ref<boolean>(false);
    const hasMore = ref<boolean>(true);
    const isLoadingMore = ref<boolean>(false);
    const currentFilter = ref<string>("all");
    const PAGE_SIZE = 30;

    function addClipboardRecord(record: ClipboardRecord) {
        // 新记录直接 unshift，不检查重复（数据库已去重）
        clipboardHistory.value.unshift(record);
    }

    function setCurrentClipboardHash(hash: string | null) {
        currentClipboardHash.value = hash;
    }

    function removeClipboardRecord(id: string) {
        const index = clipboardHistory.value.findIndex(r => r.id === id);
        if (index !== -1) {
            clipboardHistory.value.splice(index, 1);
        }
    }

    function clearClipboardHistory() {
        clipboardHistory.value = [];
    }

    async function toggleFavorite(id: string) {
        const record = clipboardHistory.value.find(r => r.id === id);
        if (!record) return;

        const newFavoriteState = !record.is_favorite;
        try {
            await invokeOrThrow("set_clipboard_favorite", {
                id,
                isFavorite: newFavoriteState,
            });
            // 更新本地状态
            record.is_favorite = newFavoriteState;
        } catch (error) {
            console.warn("Failed to toggle favorite:", error);
        }
    }

    async function preloadHistory(filter: string = "all") {
        const startTime = performance.now();
        console.log(`[clipboard-store] ▶ preloadHistory (filter: ${filter})`);
        
        // 立即重置状态，避免显示旧数据
        clipboardHistory.value = [];
        hasMore.value = false;
        isLoadingMore.value = false;
        
        try {
            const backendHistory = await invokeOrThrow<ClipboardRecord[]>("get_clipboard_history", {
                filter,
                limit: filter === "favorites" ? 1000 : PAGE_SIZE,
                offset: 0,
            });
            
            console.log(`[clipboard-store] got ${backendHistory.length} records (${(performance.now() - startTime).toFixed(1)}ms)`);
            clipboardHistory.value = backendHistory;
            currentFilter.value = filter;
            hasMore.value = filter !== "favorites" && backendHistory.length >= PAGE_SIZE;
            historyLoaded.value = true;
        } catch (error) {
            console.warn("[clipboard-store] Failed to preload clipboard history:", error);
        }
    }

    async function loadMore() {
        if (isLoadingMore.value || !hasMore.value) return;
        isLoadingMore.value = true;
        try {
            const offset = clipboardHistory.value.length;
            const moreRecords = await invokeOrThrow<ClipboardRecord[]>("get_clipboard_history", {
                filter: currentFilter.value,
                limit: PAGE_SIZE,
                offset,
            });
            if (moreRecords.length > 0) {
                clipboardHistory.value.push(...moreRecords);
            }
            hasMore.value = moreRecords.length >= PAGE_SIZE;
        } catch (error) {
            console.warn("[clipboard-store] Failed to load more:", error);
        } finally {
            isLoadingMore.value = false;
        }
    }

    return {
        clipboardHistory,
        clipboardHistoryEnabled,
        currentClipboardHash,
        historyLoaded,
        hasMore,
        isLoadingMore,
        currentFilter,
        addClipboardRecord,
        removeClipboardRecord,
        clearClipboardHistory,
        toggleFavorite,
        setCurrentClipboardHash,
        preloadHistory,
        loadMore,
    };
}, { persist: createVersionedPersistConfig("clipboard", ["clipboardHistory", "clipboardHistoryEnabled"]) });
