<template>
    <div
        ref="clipboardHistoryRef"
        class="clipboard-history"
        data-tauri-drag-region
        data-menu-type="Clipboard-History-View"
    >
        <ClipboardHistoryToolbar
            ref="toolbarRef"
            :history-count="history.length"
            :search-keyword="searchKeyword"
            :selected-filter="selectedFilter"
            :tab-region="tabRegion"
            :focused-filter-key="focusedFilterKey"
            :set-filter-chip-ref="setFilterChipRef"
            @back="onBack"
            @clear-all="handleClearAll"
            @clear-search="clearSearchKeyword"
            @update:search-keyword="searchKeyword = $event"
            @update:selected-filter="selectedFilter = $event"
            @search-blur="onSearchInputBlur"
        />

        <div ref="contentRef" class="content" @scroll="onContentScroll">
            <ClipboardHistoryList
                :displayed-grouped-history="displayedGroupedHistory"
                :grouped-history="groupedHistory"
                :history-count="history.length"
                :has-more="hasMore"
                :is-loading-more="isLoadingMore"
                :current-hash="currentHash"
                :anchor-flash-item-id="anchorFlashItemId"
                :tab-region="tabRegion"
                :focused-record-id="focusedRecordId"
                :image-preview-map="imagePreviewMap"
                :image-loading-set="imageLoadingSet"
                :format-time="formatTime"
                :get-record-type-label="getRecordTypeLabel"
                :get-visible-text="getVisibleText"
                :is-expandable-text="isExpandableText"
                :is-expanded="isExpanded"
                :is-favorite="isFavoriteRecord"
                :set-item-ref="setItemRef"
                :observe-image-element="observeImageElement"
                :on-copy-item="onCopyItem"
                :on-toggle-favorite="onToggleFavorite"
                :on-delete-item="onDeleteItem"
                :on-toggle-expand="onToggleExpandItem"
            />
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { ClipboardRecord } from "../stores/clipboardStore";
import { useClipboardStore } from "../stores/clipboardStore";
import { useClipboardEvents } from "../composables/useClipboardEvents";
import { useConfirmDialog } from "../composables/useConfirmDialog";
import ClipboardHistoryToolbar from "./clipboard-history/ClipboardHistoryToolbar.vue";
import ClipboardHistoryList from "./clipboard-history/ClipboardHistoryList.vue";
import { useClipboardFilter } from "./clipboard-history/use-clipboard-filter";
import { useClipboardKeyboard } from "./clipboard-history/use-clipboard-keyboard";
import { useClipboardViewport } from "./clipboard-history/use-clipboard-viewport";
import { isFavorite } from "./clipboard-history/record-helpers";
import { FILTER_OPTIONS, TEXT_PREVIEW_LENGTH } from "./clipboard-history/types";

const router = useRouter();
const route = useRoute();
const clipboardStore = useClipboardStore();
const { confirm } = useConfirmDialog();
const { history, onCopyItem, onDeleteItem, onClearAll, formatTime } = useClipboardEvents();

const currentHash = computed(() => clipboardStore.currentClipboardHash);
const hasMore = computed(() => clipboardStore.hasMore);
const isLoadingMore = computed(() => clipboardStore.isLoadingMore);

const clipboardHistoryRef = ref<HTMLElement | null>(null);
const contentRef = ref<HTMLElement | null>(null);
const toolbarRef = ref<InstanceType<typeof ClipboardHistoryToolbar> | null>(null);
const expandedRecordIds = ref<Record<string, boolean>>({});

const {
    searchKeyword,
    selectedFilter,
    displayedGroupedHistory,
    groupedHistory,
    clearSearchKeyword,
    getRecordTypeLabel,
} = useClipboardFilter({ history, clipboardStore });

const flatVisibleRecords = computed<ClipboardRecord[]>(() => {
    const rows: ClipboardRecord[] = [];
    for (const group of groupedHistory.value) {
        rows.push(...group.items);
    }
    return rows;
});

const filterOrder = computed(() => FILTER_OPTIONS.map((option) => option.key));

const searchInputProxy = computed<HTMLInputElement | null>(
    () => (toolbarRef.value?.searchInputRef as HTMLInputElement | null) ?? null
);

const {
    tabRegion,
    itemRefs,
    focusedFilterKey,
    focusedRecordId,
    onSearchInputBlur,
    setFilterChipRef,
    setItemRef,
    onClipboardKeydown,
    onClipboardMouseDown,
} = useClipboardKeyboard({
    flatVisibleRecords,
    filterOrder,
    searchInputRef: searchInputProxy,
    onBack,
    onCopyItem,
});

const {
    imagePreviewMap,
    imageLoadingSet,
    anchorFlashItemId,
    onContentScroll,
    onLocateClipboardItem,
    scrollToRecord,
    afterToggleExpand,
    observeImageElement,
    dispose: disposeViewport,
} = useClipboardViewport({
    history,
    contentRef,
    itemRefs,
    hasMore,
    isLoadingMore,
    loadMore: () => clipboardStore.loadMore(),
    clearSearchKeyword,
});

watch(history, (records) => {
    const validIds = new Set(records.map((record) => record.id));
    expandedRecordIds.value = Object.fromEntries(
        Object.entries(expandedRecordIds.value).filter(([id]) => validIds.has(id))
    );
    itemRefs.value = Object.fromEntries(
        Object.entries(itemRefs.value).filter(([id]) => validIds.has(id))
    ) as Record<string, HTMLElement | null>;
});

watch(
    () => route.query.anchor,
    async (anchor) => {
        if (typeof anchor !== "string" || !anchor) return;
        await nextTick();
        await scrollToRecord(anchor);
    },
    { immediate: true }
);

function handleKeyDown(e: KeyboardEvent) {
    onClipboardKeydown(e, selectedFilter);
}

function handleMouseDown(event: MouseEvent) {
    onClipboardMouseDown(event, clipboardHistoryRef);
}

onMounted(async () => {
    console.log("[clipboard-history] ▶ onMounted");
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("mousedown", handleMouseDown, true);
    document.addEventListener("locate-clipboard-item", onLocateClipboardItem);

    await clipboardStore.preloadHistory(selectedFilter.value);

    nextTick(() => {
        toolbarRef.value?.focusSearch();
        console.log("[clipboard-history] ✓ onMounted complete, focus set");
    });
});

onBeforeUnmount(() => {
    document.removeEventListener("keydown", handleKeyDown, true);
    document.removeEventListener("mousedown", handleMouseDown, true);
    document.removeEventListener("locate-clipboard-item", onLocateClipboardItem);
    disposeViewport();
});

async function handleClearAll() {
    const filter = selectedFilter.value;
    let title = "清空全部历史";
    let message = "确定要清空全部剪贴板历史吗？此操作不可撤销。";

    if (filter === "text") {
        title = "清空文本历史";
        message = "确定要清空所有文本类型的剪贴板历史吗？此操作不可撤销。";
    } else if (filter === "image") {
        title = "清空图片历史";
        message = "确定要清空所有图片类型的剪贴板历史吗？此操作不可撤销。";
    } else if (filter === "code") {
        title = "清空代码历史";
        message = "确定要清空所有代码类型的剪贴板历史吗？此操作不可撤销。";
    } else if (filter === "favorites") {
        title = "清空收藏";
        message = "确定要清空所有收藏吗？收藏的记录不会被删除，只是取消收藏状态。";
    }

    const confirmed = await confirm({
        title,
        message,
        confirmText: "清空",
        cancelText: "取消",
    });

    if (confirmed) {
        await onClearAll(filter);
    }
}

function onBack() {
    router.back();
}

function isExpandableText(record: ClipboardRecord): boolean {
    if (record.content_type !== "text") return false;
    return (record.text_content || "").length > TEXT_PREVIEW_LENGTH;
}

function isExpanded(recordId: string): boolean {
    return !!expandedRecordIds.value[recordId];
}

function getVisibleText(record: ClipboardRecord): string {
    const content = record.text_content || "";
    if (!isExpandableText(record) || isExpanded(record.id)) {
        return content;
    }
    return content.slice(0, TEXT_PREVIEW_LENGTH) + "...";
}

function isFavoriteRecord(record: ClipboardRecord): boolean {
    return isFavorite(record);
}

function onToggleFavorite(record: ClipboardRecord) {
    clipboardStore.toggleFavorite(record.id);
}

async function onToggleExpandItem(recordId: string, wasExpanded: boolean) {
    const next = { ...expandedRecordIds.value };
    next[recordId] = !wasExpanded;
    expandedRecordIds.value = next;
    await afterToggleExpand(recordId, wasExpanded);
}
</script>

<style lang="scss" scoped>
@use "../styles/scrollbar" as *;

.clipboard-history {
    width: 100vw;
    height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg-color);
}

.content {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    padding-right: 6px;
    display: flex;
    flex-direction: column;
    gap: 8px;

    @include custom-scrollbar;
}
</style>
