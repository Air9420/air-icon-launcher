import { ref } from "vue";
import { listen } from "@tauri-apps/api/event";
import { invokeOrThrow } from "../utils/invoke-wrapper";
import { useClipboardStore, type ClipboardRecord } from "../stores/clipboardStore";
import { storeToRefs } from "pinia";
import { showToast } from "./useGlobalToast";

// 全局监听器状态 - 只注册一次
let globalListenersInitialized = false;
let globalUnlisten: (() => void) | null = null;
let globalUnlistenSetFromHistory: (() => void) | null = null;
let globalSkipNextClipboardChanged = false;

/**
 * 初始化全局剪贴板事件监听器
 * 应在 App.vue 中调用一次，避免每次组件挂载都重新注册
 */
export async function initGlobalClipboardListeners() {
    if (globalListenersInitialized) {
        console.log("[clipboard-events] global listeners already initialized, skipping");
        return;
    }

    const clipboardStore = useClipboardStore();
    const startTime = performance.now();
    console.log("[clipboard-events] ▶ initGlobalClipboardListeners");

    globalUnlistenSetFromHistory = await listen<boolean>("clipboard-set-from-history", (event) => {
        if (event.payload) {
            globalSkipNextClipboardChanged = true;
        }
    });
    console.log(`[clipboard-events] ✓ clipboard-set-from-history listener (${(performance.now() - startTime).toFixed(1)}ms)`);

    globalUnlisten = await listen<ClipboardRecord>("clipboard-changed", (event) => {
        if (globalSkipNextClipboardChanged) {
            globalSkipNextClipboardChanged = false;
            return;
        }
        const currentHash = clipboardStore.currentClipboardHash;
        if (currentHash && event.payload.hash === currentHash) {
            return;
        }
        clipboardStore.addClipboardRecord(event.payload, true);
        clipboardStore.setCurrentClipboardHash(event.payload.hash);
    });
    console.log(`[clipboard-events] ✓ clipboard-changed listener (${(performance.now() - startTime).toFixed(1)}ms)`);

    globalListenersInitialized = true;
    console.log(`[clipboard-events] ✓ initGlobalClipboardListeners done (${(performance.now() - startTime).toFixed(1)}ms total)`);
}

/**
 * 清理全局剪贴板事件监听器
 */
export function cleanupGlobalClipboardListeners() {
    if (globalUnlisten) {
        globalUnlisten();
        globalUnlisten = null;
    }
    if (globalUnlistenSetFromHistory) {
        globalUnlistenSetFromHistory();
        globalUnlistenSetFromHistory = null;
    }
    globalListenersInitialized = false;
}

export function useClipboardEvents() {
    const clipboardStore = useClipboardStore();
    const { clipboardHistory: history } = storeToRefs(clipboardStore);
    const currentTime = ref(Date.now());

    function updateCurrentTime() {
        currentTime.value = Date.now();
    }

    async function onCopyItem(item: ClipboardRecord) {
        try {
            if (item.content_type === "image" && item.image_path) {
                await invokeOrThrow("set_clipboard_content", { content: item.image_path, isImage: true });
            } else {
                await invokeOrThrow("set_clipboard_content", { content: item.text_content, isImage: false });
            }
            clipboardStore.setCurrentClipboardHash(item.hash);
            updateCurrentTime();
            showToast("已复制");
        } catch (e) {
            console.error("Failed to copy to clipboard:", e);
            showToast("复制失败");
        }
    }

    async function onDeleteItem(id: string) {
        try {
            await invokeOrThrow("delete_clipboard_record", { id });
            clipboardStore.removeClipboardRecord(id);
        } catch (e) {
            console.error("Failed to delete record:", e);
        }
    }

    async function onClearAll() {
        try {
            await invokeOrThrow("clear_clipboard_history");
            clipboardStore.clearClipboardHistory();
        } catch (e) {
            console.error("Failed to clear history:", e);
        }
    }

    function truncateText(text: string, maxLength: number = 100): string {
        if (text.length <= maxLength) return text;
        return text.slice(0, maxLength) + "...";
    }

    function formatTime(timestamp: number): string {
        const date = new Date(timestamp);
        const now = new Date(currentTime.value);
        const diff = now.getTime() - date.getTime();

        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (minutes < 1) return "刚刚";
        if (minutes < 60) return `${minutes} 分钟前`;
        if (hours < 24) return `${hours} 小时前`;
        if (days < 7) return `${days} 天前`;

        return date.toLocaleDateString("zh-CN", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    }

    // 不再注册事件监听器，使用全局监听器

    return {
        history,
        currentTime,
        onCopyItem,
        onDeleteItem,
        onClearAll,
        truncateText,
        formatTime,
    };
}
