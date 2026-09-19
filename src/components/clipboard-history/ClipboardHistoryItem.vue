<template>
    <div
        class="history-item"
        :ref="(el) => setItemRef(el, item.id)"
        :data-item-id="item.id"
        data-menu-type="Clipboard-History-View"
        :data-clipboard-record-id="item.id"
        :data-clipboard-content-type="item.content_type"
        :data-item-path="item.image_path || undefined"
        :class="{
            'is-current': item.hash === currentHash,
            'is-anchor-flashing': anchorFlashItemId === item.id,
            'is-keyboard-focus': isKeyboardFocus,
        }"
        @click="$emit('copy', item)"
    >
        <div class="item-content">
            <div class="item-head">
                <span class="item-type">{{ typeLabel }}</span>
                <span class="item-copy-tip">点击复制</span>
            </div>

            <template v-if="item.content_type === 'image'">
                <img
                    v-if="imagePreview"
                    :src="imagePreview"
                    class="item-image"
                    alt="剪贴板图片"
                />
                <div
                    v-else
                    class="item-image-placeholder"
                    :ref="(el) => observeImageElement(el as HTMLElement | null, item.id, item.image_path || '')"
                >
                    {{ imageLoading ? '图片加载中...' : '图片预览' }}
                </div>
                <div v-if="item.image_path" class="item-meta">{{ item.image_path }}</div>
            </template>

            <template v-else>
                <div class="item-text">
                    {{ visibleText }}
                </div>
                <button
                    v-if="isExpandable"
                    type="button"
                    class="expand-btn"
                    @click.stop="$emit('toggle-expand', item.id, isExpanded)"
                    @mousedown.stop
                >
                    {{ isExpanded ? "收起" : "展开" }}
                </button>
            </template>

            <div class="item-time">{{ formatTime(item.timestamp) }}</div>
        </div>

        <div class="item-actions">
            <button
                class="favorite-btn"
                type="button"
                :class="{ 'is-active': isFavorite }"
                :title="isFavorite ? '取消收藏' : '收藏'"
                @click.stop="$emit('toggle-favorite', item)"
                @mousedown.stop
            >
                {{ isFavorite ? "★" : "☆" }}
            </button>
            <button
                class="delete-btn"
                type="button"
                @click.stop="$emit('delete', item.id)"
                @mousedown.stop
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
import type { ComponentPublicInstance } from "vue";
import type { ClipboardRecord } from "../../stores/clipboardStore";

const props = defineProps<{
    item: ClipboardRecord;
    currentHash: string | null;
    anchorFlashItemId: string | null;
    isKeyboardFocus: boolean;
    isFavorite: boolean;
    isExpandable: boolean;
    isExpanded: boolean;
    typeLabel: string;
    visibleText: string;
    imagePreview?: string;
    imageLoading: boolean;
    formatTime: (timestamp: number) => string;
    setItemRef: (el: Element | ComponentPublicInstance | null, recordId: string) => void;
    observeImageElement: (el: HTMLElement | null, recordId: string, imagePath: string) => void;
}>();

defineEmits<{
    (e: "copy", item: ClipboardRecord): void;
    (e: "toggle-favorite", item: ClipboardRecord): void;
    (e: "delete", id: string): void;
    (e: "toggle-expand", id: string, wasExpanded: boolean): void;
}>();

// Keep props referenced for template narrowing
void props;
</script>

<style lang="scss" scoped>
.history-item {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px 14px;
    background: var(--card-bg);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.15s ease;
    -webkit-app-region: no-drag;
}

.history-item:hover {
    background: var(--card-bg-solid);
    border-color: color-mix(in srgb, var(--primary-color) 60%, transparent);
    box-shadow: var(--card-shadow);
}

.history-item.is-current {
    background: var(--primary-bg);
    border: 1px dashed color-mix(in srgb, var(--primary-color) 70%, transparent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--primary-color) 22%, transparent);
}

.history-item.is-keyboard-focus:not(.is-current) {
    border: 1px solid var(--primary-color);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--primary-color) 35%, transparent), var(--card-shadow);
}

.history-item.is-current.is-keyboard-focus {
    border: 1px solid var(--primary-color);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--primary-color) 40%, transparent), var(--card-shadow);
}

.history-item.is-anchor-flashing:not(.is-current) {
    animation: anchor-item-flash 2s ease-in-out;
}

.history-item.is-current.is-anchor-flashing {
    animation: anchor-item-flash-current 2s ease-in-out;
}

@keyframes anchor-item-flash {
    0%,
    100% {
        background: var(--card-bg);
        border-color: var(--border-color);
        box-shadow: none;
    }
    20%,
    60% {
        background: var(--primary-bg);
        border-color: var(--primary-color);
        box-shadow: 0 0 0 1px var(--primary-color);
    }
    40%,
    80% {
        background: var(--card-bg);
        border-color: var(--border-color);
        box-shadow: none;
    }
}

@keyframes anchor-item-flash-current {
    0%,
    100% {
        background: var(--primary-bg);
        border-color: var(--primary-color);
        box-shadow: 0 0 0 1px var(--primary-color);
    }
    25%,
    75% {
        background: var(--card-bg-solid);
        border-color: var(--primary-color);
        box-shadow: 0 0 0 2px var(--primary-color);
    }
}

.item-content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.item-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
}

.item-type {
    font-size: 11px;
    color: var(--text-hint);
    background: var(--hover-bg);
    border-radius: 999px;
    padding: 2px 8px;
}

.item-copy-tip {
    font-size: 11px;
    color: var(--text-hint);
}

.item-text {
    font-size: 14px;
    color: var(--text-color);
    line-height: 1.4;
    word-break: break-all;
    white-space: pre-wrap;
}

.item-meta {
    margin-top: 8px;
    font-size: 11px;
    color: var(--text-hint);
    word-break: break-all;
}

.expand-btn {
    margin-top: 6px;
    border: 0;
    background: transparent;
    color: var(--primary-color);
    cursor: pointer;
    font-size: 12px;
    padding: 0;
}

.item-time {
    font-size: 12px;
    color: var(--text-hint);
}

.item-image {
    max-width: 100%;
    max-height: 200px;
    border-radius: 8px;
    object-fit: contain;
}

.item-image-placeholder {
    margin-top: 8px;
    padding: 12px;
    border-radius: 8px;
    background: var(--hover-bg);
    color: var(--text-hint);
    font-size: 12px;
    min-height: 100px;
    display: flex;
    align-items: center;
    justify-content: center;
}

.item-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
}

.favorite-btn {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 0;
    background: transparent;
    color: var(--text-hint);
    cursor: pointer;
    border-radius: 6px;
    font-size: 16px;
    line-height: 1;
}

.favorite-btn:hover {
    background: var(--hover-bg);
    color: #f6b100;
}

.favorite-btn.is-active {
    color: #f6b100;
}

.delete-btn {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 0;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    border-radius: 6px;
    transition: all 0.15s ease;
}

.delete-btn:hover {
    background: var(--error-bg);
    color: var(--error-color);
}
</style>
