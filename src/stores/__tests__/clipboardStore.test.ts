import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useClipboardStore, type ClipboardRecord } from "../clipboardStore";

function makeRecord(partial: Partial<ClipboardRecord> & Pick<ClipboardRecord, "id" | "hash">): ClipboardRecord {
    return {
        content_type: "text",
        content_subtype: null,
        text_content: partial.hash,
        image_path: null,
        timestamp: partial.timestamp ?? 1000,
        is_favorite: false,
        ...partial,
    };
}

describe("clipboardStore 重复内容置顶", () => {
    beforeEach(() => {
        setActivePinia(createPinia());
    });

    it("再次加入历史中已存在的 hash 时移除旧条目并置顶", () => {
        const store = useClipboardStore();
        store.addClipboardRecord(makeRecord({ id: "1", hash: "h3", text_content: "3", timestamp: 1000 }));
        store.addClipboardRecord(makeRecord({ id: "2", hash: "h1", text_content: "1", timestamp: 2000 }));

        store.applyClipboardRecord(
            makeRecord({ id: "3", hash: "h3", text_content: "3", timestamp: 3000 })
        );

        expect(store.clipboardHistory).toHaveLength(2);
        expect(store.clipboardHistory[0].hash).toBe("h3");
        expect(store.clipboardHistory[0].id).toBe("3");
        expect(store.clipboardHistory[1].hash).toBe("h1");
        expect(store.currentClipboardHash).toBe("h3");
    });

    it("promoteClipboardRecord 置顶已有条目并保留收藏状态", () => {
        const store = useClipboardStore();
        store.addClipboardRecord(
            makeRecord({ id: "c3", hash: "h3", text_content: "3", timestamp: 1000, is_favorite: true })
        );
        store.addClipboardRecord(makeRecord({ id: "c1", hash: "h1", text_content: "1", timestamp: 2000 }));

        const before = Date.now();
        store.promoteClipboardRecord(
            makeRecord({ id: "c3", hash: "h3", text_content: "3", is_favorite: false })
        );

        expect(store.clipboardHistory[0].id).toBe("c3");
        expect(store.clipboardHistory[0].hash).toBe("h3");
        expect(store.clipboardHistory[0].is_favorite).toBe(true);
        expect(store.clipboardHistory[0].timestamp).toBeGreaterThanOrEqual(before);
        expect(store.clipboardHistory[1].hash).toBe("h1");
        expect(store.clipboardHistory).toHaveLength(2);
    });
});
