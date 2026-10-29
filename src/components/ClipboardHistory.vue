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

        <div ref="contentRef" class="content" @scroll="handleContentScroll">
            <ClipboardHistoryList
                ref="clipboardListRef"
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
                :scroll-element="contentRef"
            />
        </div>

        <!--
            回到顶部 / 回到最新。
            历史是「越新越靠上」，滚到很下面时（6200+ 条、约 1170 屏）
            没有任何快速返回手段，这里给一个常驻的悬浮按钮。
        -->
        <Transition name="back-to-top">
            <button
                v-if="showBackToTop"
                type="button"
                class="back-to-top-btn"
                :title="backToTopLabel"
                @click="scrollToTop"
                @mousedown.stop
            >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 19V5" />
                    <path d="m5 12 7-7 7 7" />
                </svg>
                <span class="back-to-top-text">{{ backToTopLabel }}</span>
            </button>
        </Transition>
    </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { ClipboardRecord } from "../stores/clipboardStore";
import { useClipboardStore } from "../stores/clipboardStore";
import { useClipboardEvents } from "../composables/useClipboardEvents";
import { useConfirmDialog } from "../composables/useConfirmDialog";
import { showToast } from "../composables/useGlobalToast";
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
    // 延迟读取：useClipboardViewport 在下方才创建，这里用函数避免初始化顺序问题。
    getScrollToRecordId: () => scrollToRecordIdBridge,
});

const {
    imagePreviewMap,
    imageLoadingSet,
    anchorFlashItemId,
    onContentScroll,
    onLocateClipboardItem,
    locateRecord,
    setScrollToRecordId,
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
    currentKeyword: () => searchKeyword.value,
    waitForHistoryReady: async () => {
        await waitForHistoryLoaded();
        await nextTick();
    },
    onLocateMiss: () => {
        showToast("该记录已不在剪贴板历史中", { type: "info" });
    },
});

/** 回到顶部按钮的显示状态：滚动超过一屏后出现。 */
const showBackToTop = ref(false);
const backToTopLabel = computed(() =>
    searchKeyword.value.trim() ? "回到顶部" : "回到最新"
);

/** 滚动位置监听（节流到 rAF，避免长列表滚动时频繁触发）。 */
let backToTopRafId: number | null = null;
function updateBackToTopVisibility() {
    if (backToTopRafId !== null) return;
    backToTopRafId = requestAnimationFrame(() => {
        backToTopRafId = null;
        const container = contentRef.value;
        if (!container) return;
        showBackToTop.value = container.scrollTop > container.clientHeight;
    });
}

function scrollToTop() {
    clipboardListRef.value?.scrollToTop();
    // 同步更新按钮状态，避免滚动动画期间按钮残留
    showBackToTop.value = false;
}

const clipboardListRef = ref<InstanceType<typeof ClipboardHistoryList> | null>(null);

/** 键盘导航需要的「滚动到指定记录」桥接（虚拟列表未渲染项也能定位）。 */
let scrollToRecordIdBridge: ((id: string) => Promise<boolean> | boolean) | null = null;

/** 挂载阶段暂存的 anchor（onMounted 里统一处理）。 */
let pendingAnchor: string | null = null;
let isMountedOnce = false;

// 虚拟列表暴露 scrollToRecordId；同时供「定位」与「键盘导航」使用。
// 用 flush: 'post' 确保子组件已挂载、exposed 已可用。
watch(
    clipboardListRef,
    (list) => {
        const method = list?.scrollToRecordId ?? null;
        setScrollToRecordId(method);
        scrollToRecordIdBridge = method;
    },
    { immediate: true, flush: "post" }
);

watch(history, (records) => {
    const validIds = new Set(records.map((record) => record.id));
    expandedRecordIds.value = Object.fromEntries(
        Object.entries(expandedRecordIds.value).filter(([id]) => validIds.has(id))
    );
    itemRefs.value = Object.fromEntries(
        Object.entries(itemRefs.value).filter(([id]) => validIds.has(id))
    ) as Record<string, HTMLElement | null>;
});

/**
 * 等待剪贴板历史加载就绪。
 *
 * `preloadHistory()` 会先清空 `history` 再异步填充，
 * 因此「已加载」的可靠判据是 `historyLoaded === true` 且 `history` 非空。
 */
async function waitForHistoryLoaded(timeoutMs = 6000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (clipboardStore.historyLoaded && history.value.length > 0) {
            return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
}

/**
 * 处理「定位到某条记录」。
 *
 * 时序陷阱（这是定位一直失败的根本原因）：
 * 1. `anchor` 查询参数在组件挂载时就已存在；
 * 2. `onMounted` 里的 `preloadHistory()` 会**先清空** history 再异步加载；
 * 3. 早期版本在 `watch(..., { immediate: true })` 里直接定位，
 *    此时 history 是空的、虚拟列表也是空的，`scrollToRecordId` 必然返回 false；
 * 4. 即使等到 `historyLoaded === true` 也不够——首次进入时它可能仍是初始值。
 *
 * 因此必须先等数据就绪，再判断目标是否存在，最后交给虚拟列表滚动。
 */
async function locateAnchor(anchor: string): Promise<void> {
    const ready = await waitForHistoryLoaded();
    if (!ready) {
        showToast("剪贴板历史加载失败", { type: "error" });
        return;
    }

    const inList = history.value.some((item) => item.id === anchor);
    if (!inList) {
        // 记录可能已被删除，或不在当前筛选范围内
        showToast("该记录已不在剪贴板历史中", { type: "info" });
        return;
    }

    // 等虚拟列表把首屏行渲染出来
    await nextTick();
    await nextTick();

    const located = await locateRecordForAnchor(anchor);
    if (!located) {
        showToast("无法定位到该记录", { type: "info" });
    }
}
async function locateRecordForAnchor(anchor: string): Promise<boolean> {
    return locateRecord(anchor, clipboardListRef.value?.scrollToRecordId ?? null);
}

/** 内容区滚动：驱动虚拟列表 + 回到顶部按钮显隐。 */
function handleContentScroll(event: Event) {
    onContentScroll(event);
    updateBackToTopVisibility();
}

watch(
    () => route.query.anchor,
    async (anchor) => {
        if (typeof anchor !== "string" || !anchor) return;
        // 组件挂载阶段由 onMounted 统一处理（那时数据才真正就绪）；
        // 这里只处理「已挂载后 anchor 变化」的情况。
        if (!isMountedOnce) {
            pendingAnchor = anchor;
            return;
        }
        await locateAnchor(anchor);
    }
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

    // 数据就绪后再定位：此时 history 已填充、虚拟列表可计算位置。
    // 必须在 preloadHistory 之后，否则 scrollToRecordId 找不到目标行。
    isMountedOnce = true;
    const anchor = pendingAnchor ?? (typeof route.query.anchor === "string" ? route.query.anchor : null);
    pendingAnchor = null;
    if (anchor) {
        await nextTick();
        await locateAnchor(anchor);
    }

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
    // 轻量接口返回的文本已被截断，用后端回传的真实长度判断是否可展开，
    // 否则 240 字符以上的记录会被误判为「不可展开」。
    if (record.text_truncated) return true;
    const length = record.text_length ?? (record.text_content || "").length;
    return length > TEXT_PREVIEW_LENGTH;
}

function isExpanded(recordId: string): boolean {
    return !!expandedRecordIds.value[recordId];
}

/**
 * 展开后需要显示完整文本。
 *
 * 轻量接口只给了前 240 字符，展开时按需补拉完整内容并缓存到本地，
 * 避免「点了展开还是截断的」。
 */
const fullTextCache = ref<Record<string, string>>({});

function getVisibleText(record: ClipboardRecord): string {
    const cached = fullTextCache.value[record.id];
    const content = cached ?? record.text_content ?? "";
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

    // 展开时补拉完整文本（仅首次）
    if (!wasExpanded) {
        const record = history.value.find((item) => item.id === recordId);
        if (record?.text_truncated && fullTextCache.value[recordId] === undefined) {
            const full = await clipboardStore.loadFullRecord(recordId);
            if (full?.text_content != null) {
                fullTextCache.value = {
                    ...fullTextCache.value,
                    [recordId]: full.text_content,
                };
            }
        }
    }

    // 展开/收起改变行高但不改变行数，必须显式让虚拟列表重新测量，
    // 否则后续行的位置会错位。
    await nextTick();
    clipboardListRef.value?.remeasure();
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
    min-height: 0;
    overflow-y: auto;
    padding: 12px;
    padding-right: 6px;
    /* 底部留白，避免最后一条被「回到最新」悬浮按钮遮挡 */
    padding-bottom: 56px;
    /* 虚拟列表内部使用绝对定位 + 固定高度的画布，
       外层不能再是 flex 布局，否则画布高度会被压缩。 */
    display: block;

    @include custom-scrollbar;
}

/* 回到顶部：右下角悬浮，避开滚动条与内容 */
.back-to-top-btn {
    position: fixed;
    right: 22px;
    bottom: 24px;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 34px;
    padding: 0 14px;
    border: 1px solid var(--border-color);
    border-radius: 17px;
    background: var(--card-bg-solid);
    color: var(--text-secondary);
    font-size: 12px;
    cursor: pointer;
    box-shadow: var(--card-shadow);
    transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease,
        transform 0.15s ease;

    svg {
        width: 14px;
        height: 14px;
        flex-shrink: 0;
    }

    &:hover {
        background: var(--hover-bg);
        color: var(--primary-color);
        border-color: var(--primary-color);
        transform: translateY(-1px);
    }

    &:active {
        transform: translateY(0);
    }
}

.back-to-top-text {
    line-height: 1;
}

.back-to-top-enter-active,
.back-to-top-leave-active {
    transition: opacity 0.18s ease, transform 0.18s ease;
}

.back-to-top-enter-from,
.back-to-top-leave-to {
    opacity: 0;
    transform: translateY(6px);
}
</style>
