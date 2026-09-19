/**
 * Clipboard history context-menu actions.
 */
import type { ClipboardActions, MenuActionDeps } from "./types";

export function createClipboardActions(deps: MenuActionDeps): ClipboardActions {
    const {
        options: { currentClipboardRecordId, currentClipboardContentType, closeContextMenu },
        clipboardStore,
        showToast,
        menuInvoke,
        router,
    } = deps;

    async function onCopyClipboardItem() {
        const recordId = currentClipboardRecordId.value;
        if (!recordId) return;
        const record = clipboardStore.clipboardHistory.find((x) => x.id === recordId);
        if (!record) {
            showToast("未找到剪贴板记录", { type: "error" });
            closeContextMenu();
            return;
        }

        try {
            if (currentClipboardContentType.value === "image" && record.image_path) {
                await menuInvoke("set_clipboard_content", {
                    content: record.image_path,
                    isImage: true,
                });
            } else {
                await menuInvoke("set_clipboard_content", {
                    content: record.text_content ?? "",
                    isImage: false,
                });
            }
            clipboardStore.promoteClipboardRecord(record);
            clipboardStore.setCurrentClipboardHash(record.hash);
            showToast("已复制剪贴板历史项");
        } catch (error) {
            console.error(error);
            showToast("复制失败", { type: "error" });
        } finally {
            closeContextMenu();
        }
    }

    async function onLocateClipboardItem() {
        const recordId = currentClipboardRecordId.value;
        if (!recordId) return;
        await router.push({ path: "/clipboard", query: { anchor: recordId } });
        closeContextMenu();
    }

    async function onDeleteClipboardItem() {
        const recordId = currentClipboardRecordId.value;
        if (!recordId) return;

        try {
            await menuInvoke("delete_clipboard_record", { id: recordId });
            clipboardStore.removeClipboardRecord(recordId);
            showToast("已删除");
        } catch (error) {
            console.error(error);
            showToast("删除失败", { type: "error" });
        } finally {
            closeContextMenu();
        }
    }

    function onLocateClipboardItemInHistory() {
        const recordId = currentClipboardRecordId.value;
        if (!recordId) return;

        const event = new CustomEvent("locate-clipboard-item", {
            detail: { recordId },
        });
        document.dispatchEvent(event);

        closeContextMenu();
    }

    return {
        onCopyClipboardItem,
        onLocateClipboardItem,
        onDeleteClipboardItem,
        onLocateClipboardItemInHistory,
    };
}
