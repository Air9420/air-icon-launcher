import { onMounted, onBeforeUnmount, ref } from "vue";
import { listen } from "@tauri-apps/api/event";
import { invokeOrThrow } from "../utils/invoke-wrapper";
import { useClipboardStore, type ClipboardRecord } from "../stores/clipboardStore";
import { storeToRefs } from "pinia";
import { showToast } from "./useGlobalToast";

export function useClipboardEvents() {
    const clipboardStore = useClipboardStore();
    const { clipboardHistory: history } = storeToRefs(clipboardStore);
    const currentTime = ref(Date.now());
    let unlisten: (() => void) | null = null;
    let unlistenSetFromHistory: (() => void) | null = null;
    let skipNextClipboardChanged = false;

    function updateCurrentTime() {
        currentTime.value = Date.now();
    }

    async function fetchCurrentClipboardHash() {
        try {
            const hash = await invokeOrThrow<string>("get_current_clipboard_hash");
            clipboardStore.setCurrentClipboardHash(hash);
        } catch (e) {
            console.error("Failed to get current clipboard hash:", e);
        }
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

    onMounted(async () => {
        try {
            const backendHistory = await invokeOrThrow<ClipboardRecord[]>("get_clipboard_history");
            const sortedHistory = [...backendHistory].sort((a, b) => b.timestamp - a.timestamp);
            clipboardStore.replaceClipboardHistory(sortedHistory);
        } catch (e) {
            console.error("Failed to load clipboard history:", e);
        }

        await fetchCurrentClipboardHash();

        unlistenSetFromHistory = await listen<boolean>("clipboard-set-from-history", (event) => {
            if (event.payload) {
                skipNextClipboardChanged = true;
            }
        });

        unlisten = await listen<ClipboardRecord>("clipboard-changed", (event) => {
            if (skipNextClipboardChanged) {
                skipNextClipboardChanged = false;
                return;
            }
            const currentHash = clipboardStore.currentClipboardHash;
            if (currentHash && event.payload.hash === currentHash) {
                return;
            }
            clipboardStore.addClipboardRecord(event.payload, true);
            clipboardStore.setCurrentClipboardHash(event.payload.hash);
            updateCurrentTime();
        });
    });

    onBeforeUnmount(() => {
        if (unlisten) {
            unlisten();
        }
        if (unlistenSetFromHistory) {
            unlistenSetFromHistory();
        }
    });

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
