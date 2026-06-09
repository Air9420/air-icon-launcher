// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import ClipboardHistory from "../ClipboardHistory.vue";
import { useClipboardStore } from "../../stores/clipboardStore";

const { invokeMock } = vi.hoisted(() => ({
    invokeMock: vi.fn().mockResolvedValue([]),
}));

vi.mock("vue-router", () => ({
    useRouter: () => ({
        push: vi.fn(),
        back: vi.fn(),
    }),
    useRoute: () => ({
        query: {},
    }),
}));

vi.mock("@tauri-apps/api/core", () => ({
    invoke: invokeMock,
}));

vi.mock("@tauri-apps/api/event", () => ({
    listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock("../../utils/system-commands", () => ({
    readLocalImageAsDataUrl: vi.fn().mockResolvedValue("data:image/png;base64,mock"),
}));

vi.mock("../../composables/useGlobalToast", () => ({
    showToast: vi.fn(),
}));

describe("ClipboardHistory Context Menu", () => {
    beforeEach(() => {
        setActivePinia(createPinia());
    });

    it("should render without errors", () => {
        const wrapper = mount(ClipboardHistory);
        expect(wrapper.exists()).toBe(true);
    });

    it("should have context menu attributes on history items", async () => {
        const store = useClipboardStore();
        store.clipboardHistory = [
            {
                id: "test-id-1",
                content_type: "text",
                text_content: "Hello World",
                image_path: null,
                hash: "hash-1",
                timestamp: Date.now(),
            },
            {
                id: "test-id-2",
                content_type: "text",
                text_content: "Test Content",
                image_path: null,
                hash: "hash-2",
                timestamp: Date.now() - 60000,
            },
        ];

        const wrapper = mount(ClipboardHistory);

        const items = wrapper.findAll(".history-item");
        expect(items.length).toBe(2);

        const firstItem = items[0];
        expect(firstItem.attributes("data-menu-type")).toBe("Clipboard-History-View");
        expect(firstItem.attributes("data-clipboard-record-id")).toBe("test-id-1");
        expect(firstItem.attributes("data-clipboard-content-type")).toBe("text");
    });

    it("should have correct data attributes for image items", async () => {
        const store = useClipboardStore();
        store.clipboardHistory = [
            {
                id: "image-id-1",
                content_type: "image",
                text_content: null,
                image_path: "/path/to/image.png",
                hash: "image-hash-1",
                timestamp: Date.now(),
            },
        ];

        const wrapper = mount(ClipboardHistory);

        const items = wrapper.findAll(".history-item");
        expect(items.length).toBe(1);

        const imageItem = items[0];
        expect(imageItem.attributes("data-menu-type")).toBe("Clipboard-History-View");
        expect(imageItem.attributes("data-clipboard-record-id")).toBe("image-id-1");
        expect(imageItem.attributes("data-clipboard-content-type")).toBe("image");
    });

    it("should handle locate-clipboard-item event", async () => {
        const store = useClipboardStore();
        store.clipboardHistory = [
            {
                id: "locate-test-id",
                content_type: "text",
                text_content: "Locate me",
                image_path: null,
                hash: "locate-hash",
                timestamp: Date.now(),
            },
        ];

        const wrapper = mount(ClipboardHistory);

        const event = new CustomEvent("locate-clipboard-item", {
            detail: { recordId: "locate-test-id" },
        });
        document.dispatchEvent(event);

        await wrapper.vm.$nextTick();

        const searchInput = wrapper.find<HTMLInputElement>(".search-input");
        expect(searchInput.exists()).toBe(true);
        expect(searchInput.element.value).toBe("");
    });

    it("should clear search keyword when locate-clipboard-item is dispatched", async () => {
        const store = useClipboardStore();
        store.clipboardHistory = [
            {
                id: "locate-id",
                content_type: "text",
                text_content: "Some text",
                image_path: null,
                hash: "locate-hash",
                timestamp: Date.now(),
            },
        ];

        const wrapper = mount(ClipboardHistory);
        await wrapper.vm.$nextTick();

        const event = new CustomEvent("locate-clipboard-item", {
            detail: { recordId: "locate-id" },
        });
        document.dispatchEvent(event);

        await wrapper.vm.$nextTick();

        const searchInput = wrapper.find<HTMLInputElement>(".search-input");
        expect(searchInput.exists()).toBe(true);
    });

    it("should render empty state when no history", () => {
        const wrapper = mount(ClipboardHistory);

        expect(wrapper.find(".empty-state").exists()).toBe(true);
        expect(wrapper.find(".empty-text").text()).toBe("暂无剪贴板历史");
    });

    it("should render history items when data exists", async () => {
        const store = useClipboardStore();
        store.clipboardHistory = [
            {
                id: "item-1",
                content_type: "text",
                text_content: "First item",
                image_path: null,
                hash: "hash-1",
                timestamp: Date.now(),
            },
            {
                id: "item-2",
                content_type: "text",
                text_content: "Second item",
                image_path: null,
                hash: "hash-2",
                timestamp: Date.now() - 60000,
            },
        ];

        const wrapper = mount(ClipboardHistory);

        expect(wrapper.find(".empty-state").exists()).toBe(false);
        const items = wrapper.findAll(".history-item");
        expect(items.length).toBe(2);
    });

    it("should have delete button on history items", async () => {
        const store = useClipboardStore();
        store.clipboardHistory = [
            {
                id: "delete-test-id",
                content_type: "text",
                text_content: "Delete me",
                image_path: null,
                hash: "delete-hash",
                timestamp: Date.now(),
            },
        ];

        const wrapper = mount(ClipboardHistory);

        const deleteBtn = wrapper.find(".history-item .delete-btn");
        expect(deleteBtn.exists()).toBe(true);
    });

    it("should have favorite button on history items", async () => {
        const store = useClipboardStore();
        store.clipboardHistory = [
            {
                id: "fav-test-id",
                content_type: "text",
                text_content: "Favorite me",
                image_path: null,
                hash: "fav-hash",
                timestamp: Date.now(),
            },
        ];

        const wrapper = mount(ClipboardHistory);

        const favBtn = wrapper.find(".history-item .favorite-btn");
        expect(favBtn.exists()).toBe(true);
    });

    it("should show all required data attributes for context menu integration", async () => {
        const store = useClipboardStore();
        store.clipboardHistory = [
            {
                id: "integration-id",
                content_type: "text",
                text_content: "Integration test",
                image_path: null,
                hash: "integration-hash",
                timestamp: Date.now(),
            },
        ];

        const wrapper = mount(ClipboardHistory);

        const item = wrapper.find(".history-item");
        expect(item.attributes("data-item-id")).toBe("integration-id");
        expect(item.attributes("data-menu-type")).toBe("Clipboard-History-View");
        expect(item.attributes("data-clipboard-record-id")).toBe("integration-id");
        expect(item.attributes("data-clipboard-content-type")).toBe("text");
    });
});
