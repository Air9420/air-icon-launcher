<template>
    <template v-if="displayedGroupedHistory.length > 0">
        <section
            v-for="group in displayedGroupedHistory"
            :key="group.key"
            class="group-section"
        >
            <div class="group-title">{{ group.label }} · {{ group.items.length }}</div>
            <ClipboardHistoryItem
                v-for="item in group.items"
                :key="item.id"
                :item="item"
                :current-hash="currentHash"
                :anchor-flash-item-id="anchorFlashItemId"
                :is-keyboard-focus="tabRegion === 'content' && focusedRecordId === item.id"
                :is-favorite="isFavorite(item)"
                :is-expandable="isExpandableText(item)"
                :is-expanded="isExpanded(item.id)"
                :type-label="getRecordTypeLabel(item)"
                :visible-text="getVisibleText(item)"
                :image-preview="imagePreviewMap[item.id]"
                :image-loading="imageLoadingSet.has(item.id)"
                :format-time="formatTime"
                :set-item-ref="setItemRef"
                :observe-image-element="observeImageElement"
                @copy="onCopyItem"
                @toggle-favorite="onToggleFavorite"
                @delete="onDeleteItem"
                @toggle-expand="onToggleExpand"
            />
        </section>
    </template>

    <div v-if="isLoadingMore" class="load-more-hint loading">
        加载中...
    </div>
    <div v-else-if="historyCount > 0 && !hasMore" class="load-more-hint no-more">
        已加载全部
    </div>

    <ClipboardHistoryEmpty
        :displayed-grouped-history="displayedGroupedHistory"
        :grouped-history="groupedHistory"
        :is-loading-more="isLoadingMore"
    />
</template>

<script setup lang="ts">
import type { ComponentPublicInstance } from "vue";
import type { ClipboardRecord } from "../../stores/clipboardStore";
import ClipboardHistoryItem from "./ClipboardHistoryItem.vue";
import ClipboardHistoryEmpty from "./ClipboardHistoryEmpty.vue";
import type { ClipboardGroup, ClipboardTabRegion } from "./types";

defineProps<{
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
}>();
</script>

<style lang="scss" scoped>
.group-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.group-title {
    font-size: 12px;
    color: var(--text-hint);
    font-weight: 600;
    letter-spacing: 0.3px;
}

.load-more-hint {
    text-align: center;
    padding: 16px;
    font-size: 12px;
    color: var(--text-hint);
}
</style>
