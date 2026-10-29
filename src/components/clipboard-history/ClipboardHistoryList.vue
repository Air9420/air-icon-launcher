<template>
    <template v-if="rows.length > 0">
        <div class="virtual-canvas" :style="{ height: `${totalSize}px` }">
            <div
                v-for="virtualRow in virtualRows"
                :key="rows[virtualRow.index].key"
                :ref="measureRow"
                :data-index="virtualRow.index"
                class="virtual-row"
                :style="{ transform: `translateY(${virtualRow.start}px)` }"
            >
                <div v-if="rows[virtualRow.index].type === 'header'" class="group-title">
                    {{ rows[virtualRow.index].label }}
                </div>
                <ClipboardHistoryItem
                    v-else
                    :item="rows[virtualRow.index].item!"
                    :current-hash="currentHash"
                    :anchor-flash-item-id="anchorFlashItemId"
                    :is-keyboard-focus="tabRegion === 'content' && focusedRecordId === rows[virtualRow.index].item!.id"
                    :is-favorite="isFavorite(rows[virtualRow.index].item!)"
                    :is-expandable="isExpandableText(rows[virtualRow.index].item!)"
                    :is-expanded="isExpanded(rows[virtualRow.index].item!.id)"
                    :type-label="getRecordTypeLabel(rows[virtualRow.index].item!)"
                    :visible-text="getVisibleText(rows[virtualRow.index].item!)"
                    :image-preview="imagePreviewMap[rows[virtualRow.index].item!.id]"
                    :image-loading="imageLoadingSet.has(rows[virtualRow.index].item!.id)"
                    :format-time="formatTime"
                    :set-item-ref="setItemRef"
                    :observe-image-element="observeImageElement"
                    @copy="onCopyItem"
                    @toggle-favorite="onToggleFavorite"
                    @delete="onDeleteItem"
                    @toggle-expand="onToggleExpand"
                />
            </div>
        </div>
    </template>

    <ClipboardHistoryEmpty
        :displayed-grouped-history="displayedGroupedHistory"
        :grouped-history="groupedHistory"
        :is-loading-more="isLoadingMore"
    />
</template>

<script setup lang="ts">
import { computed, nextTick, watch, type ComponentPublicInstance } from "vue";
import { useVirtualizer } from "@tanstack/vue-virtual";
import type { ClipboardRecord } from "../../stores/clipboardStore";
import ClipboardHistoryItem from "./ClipboardHistoryItem.vue";
import ClipboardHistoryEmpty from "./ClipboardHistoryEmpty.vue";
import type { ClipboardGroup, ClipboardTabRegion } from "./types";

const props = defineProps<{
    displayedGroupedHistory: ClipboardGroup[];
    groupedHistory: ClipboardGroup[];
    historyCount: number;
    hasMore: boolean;
    isLoadingMore: boolean;
    currentHash: string | null;
    anchorFlashItemId: string | null;
    tabRegion: ClipboardTabRegion;
    focusedRecordId: string | null;
    imagePreviewMap: Record<string, string>;
    imageLoadingSet: Set<string>;
    formatTime: (timestamp: number) => string;
    getRecordTypeLabel: (item: ClipboardRecord) => string;
    getVisibleText: (item: ClipboardRecord) => string;
    isExpandableText: (item: ClipboardRecord) => boolean;
    isExpanded: (id: string) => boolean;
    isFavorite: (item: ClipboardRecord) => boolean;
    setItemRef: (el: Element | ComponentPublicInstance | null, recordId: string) => void;
    observeImageElement: (el: HTMLElement | null, recordId: string, imagePath: string) => void;
    onCopyItem: (item: ClipboardRecord) => void;
    onToggleFavorite: (item: ClipboardRecord) => void;
    onDeleteItem: (id: string) => void;
    onToggleExpand: (id: string, wasExpanded: boolean) => void;
    /** 父组件的滚动容器（虚拟列表需要用它计算可视区域）。 */
    scrollElement: HTMLElement | null;
}>();

/**
 * 虚拟列表的扁平行模型：分组标题 + 记录项。
 *
 * 分组渲染（已收藏 / 全部）与虚拟化需要统一成一维数组，
 * 否则无法用一个连续坐标空间计算滚动位置。
 */
type VirtualRow =
    | { type: "header"; key: string; label: string; item: null }
    | { type: "item"; key: string; label: null; item: ClipboardRecord };

const rows = computed<VirtualRow[]>(() => {
    const result: VirtualRow[] = [];
    for (const group of props.displayedGroupedHistory) {
        result.push({
            type: "header",
            key: `header:${group.key}`,
            label: `${group.label} · ${group.items.length}`,
            item: null,
        });
        for (const item of group.items) {
            result.push({ type: "item", key: item.id, label: null, item });
        }
    }
    return result;
});

const virtualizer = useVirtualizer(
    computed(() => ({
        count: rows.value.length,
        getScrollElement: () => props.scrollElement,
        estimateSize: () => 92,
        overscan: 10,
        getItemKey: (index: number) => rows.value[index]?.key ?? index,
        // 首帧（含 jsdom 等无布局环境）还没有实测到容器尺寸，
        // 给一个合理的初始视口，避免渲染为空。
        initialRect: { width: 800, height: 600 },
    }))
);

const virtualRows = computed(() => virtualizer.value.getVirtualItems());
const totalSize = computed(() => virtualizer.value.getTotalSize());

/**
 * 动态行高测量。
 *
 * 列表项高度差异很大（文本 1~1046 字符、图片、展开/收起），
 * 固定估算值会导致滚动条抖动，必须实测每一行。
 */
function measureRow(el: Element | ComponentPublicInstance | null) {
    const node = el instanceof HTMLElement ? el : (el as ComponentPublicInstance | null)?.$el;
    if (node instanceof HTMLElement) {
        // TanStack 从元素的 data-index 读取下标，这里必须传整行元素。
        virtualizer.value.measureElement(node);
    }
}

/**
 * 重新测量所有已渲染行。
 *
 * 展开/收起只改变行高、不改变行数，ref 回调不会重新触发，
 * 必须由父组件在内容高度变化后显式调用，否则滚动条会错位。
 */
function remeasure() {
    virtualizer.value.measure();
}

/** 滚动回顶部（切换筛选/搜索后调用，避免停留在越界位置）。 */
function scrollToTop() {
    virtualizer.value.scrollToOffset(0);
}

/** 记录项 id → 扁平下标。 */
const indexByRecordId = computed(() => {
    const map = new Map<string, number>();
    rows.value.forEach((row, index) => {
        if (row.type === "item" && row.item) {
            map.set(row.item.id, index);
        }
    });
    return map;
});

/**
 * 滚动到指定记录。
 *
 * 虚拟列表下未渲染的项没有 DOM，必须先 `scrollToIndex` 触发渲染。
 * 返回是否找到（找不到由调用方决定提示文案）。
 */
async function scrollToRecordId(recordId: string): Promise<boolean> {
    const index = indexByRecordId.value.get(recordId);
    if (index === undefined) return false;

    virtualizer.value.scrollToIndex(index, { align: "center" });
    await nextTick();
    return true;
}

// 行数变化（切换筛选/搜索）后回到顶部并重新测量，
// 否则可能停留在旧数据的越界滚动位置。
watch(
    () => rows.value.length,
    (length, prev) => {
        if (length !== prev) {
            scrollToTop();
        }
        virtualizer.value.measure();
    }
);

defineExpose({
    scrollToRecordId,
    remeasure,
    scrollToTop,
    rows,
});
</script>

<style lang="scss" scoped>
.virtual-canvas {
    position: relative;
    width: 100%;
}

.virtual-row {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    padding-bottom: 8px;
    box-sizing: border-box;
}

.group-title {
    font-size: 12px;
    color: var(--text-hint);
    font-weight: 600;
    letter-spacing: 0.3px;
    padding: 8px 0 4px;
}

.load-more-hint {
    text-align: center;
    padding: 16px;
    font-size: 12px;
    color: var(--text-hint);
}
</style>
