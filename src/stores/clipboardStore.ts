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
    /** 原始文本的完整字符数（轻量列表接口提供）。 */
    text_length?: number;
    /** `text_content` 是否被截断（轻量列表接口为 true）。 */
    text_truncated?: boolean;
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
    /**
     * 全量加载时文本的截断长度。
     *
     * 库里存在单条 4MB+ 的文本，全量传输会产生接近 9MB 的 IPC 负载；
     * 截断到 240 字符后约 330KB。列表本来只显示预览，
     * 完整内容在展开/复制时按 id 单独获取。
     */
    const PREVIEW_CHARS = 240;

    function findRecordIndex(record: { id?: string; hash: string }): number {
        return clipboardHistory.value.findIndex(
            (r) => r.hash === record.hash || (record.id != null && r.id === record.id)
        );
    }

    function addClipboardRecord(record: ClipboardRecord) {
        const index = findRecordIndex(record);
        if (index !== -1) {
            clipboardHistory.value.splice(index, 1);
        }
        clipboardHistory.value.unshift(record);
    }

    /** 再次复制已有历史项时，保留原字段（如收藏状态）并置顶。 */
    function promoteClipboardRecord(record: ClipboardRecord) {
        const now = Date.now();
        const index = findRecordIndex(record);
        if (index === -1) {
            clipboardHistory.value.unshift({ ...record, timestamp: now });
            return;
        }
        const existing = clipboardHistory.value[index];
        const promoted: ClipboardRecord = { ...existing, timestamp: now };
        clipboardHistory.value.splice(index, 1);
        clipboardHistory.value.unshift(promoted);
    }

    function setCurrentClipboardHash(hash: string | null) {
        currentClipboardHash.value = hash;
    }

    function applyClipboardRecord(record: ClipboardRecord) {
        addClipboardRecord(record);
        setCurrentClipboardHash(record.hash);
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

        // 立即重置状态，避免显示旧数据。
        // `historyLoaded` 必须一起重置：否则第二次进入时它仍是 true，
        // 依赖它判断「数据是否就绪」的定位逻辑会在列表清空的瞬间误判为已就绪。
        clipboardHistory.value = [];
        hasMore.value = false;
        isLoadingMore.value = false;
        historyLoaded.value = false;

        try {
            // 一次性拉取整份历史（文本按预览长度截断）。
            // 虚拟列表需要完整数据集才能正确计算滚动高度与定位；
            // 完整文本在展开/复制时按 id 单独获取（见 loadFullRecord）。
            const backendHistory = await invokeOrThrow<ClipboardRecord[]>(
                "get_clipboard_history_lite",
                {
                    filter,
                    previewChars: PREVIEW_CHARS,
                }
            );

            console.log(
                `[clipboard-store] got ${backendHistory.length} records (${(performance.now() - startTime).toFixed(1)}ms)`
            );
            clipboardHistory.value = backendHistory;
            currentFilter.value = filter;
            hasMore.value = false;
            historyLoaded.value = true;
        } catch (error) {
            console.warn("[clipboard-store] Failed to preload clipboard history:", error);
        }
    }

    /** 按需拉取完整记录（列表里是截断后的预览文本）。 */
    async function loadFullRecord(id: string): Promise<ClipboardRecord | null> {
        try {
            const record = await invokeOrThrow<ClipboardRecord | null>("get_clipboard_record", {
                id,
            });
            return record ?? null;
        } catch (error) {
            console.warn("[clipboard-store] Failed to load full record:", error);
            return null;
        }
    }

    /**
     * 取得可直接用于复制/展开的完整文本。
     *
     * 列表数据来自轻量接口，长文本已被截断；
     * 这里按需补拉完整内容，避免复制到残缺文本。
     */
    async function getFullText(record: ClipboardRecord): Promise<string> {
        const text = record.text_content ?? "";
        if (!record.text_truncated) return text;

        const full = await loadFullRecord(record.id);
        return full?.text_content ?? text;
    }

    async function loadMore() {
        // 已改为一次性全量加载，保留空实现以兼容既有调用点。
    }

    async function search(query: string): Promise<ClipboardRecord[]> {
        if (!query.trim()) return [];
        
        try {
            const results = await invokeOrThrow<ClipboardRecord[]>("search_clipboard_history", {
                query,
                limit: 50,
                offset: 0,
            });
            return results;
        } catch (error) {
            console.warn("[clipboard-store] Failed to search clipboard history:", error);
            return [];
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
        promoteClipboardRecord,
        applyClipboardRecord,
        removeClipboardRecord,
        clearClipboardHistory,
        toggleFavorite,
        setCurrentClipboardHash,
        preloadHistory,
        loadMore,
        loadFullRecord,
        getFullText,
        search,
    };
}, { persist: createVersionedPersistConfig("clipboard", ["clipboardHistory", "clipboardHistoryEnabled"]) });
