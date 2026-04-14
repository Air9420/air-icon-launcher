<template>
    <div class="clipboard-history" data-tauri-drag-region data-menu-type="Clipboard-History-View">
        <header class="clipboard-header" data-tauri-drag-region>
            <button class="back-btn" type="button" @click="onBack" @mousedown.stop>
                返回
            </button>
            <div class="title" data-tauri-drag-region>剪贴板历史</div>
            <button
                class="clear-btn"
                type="button"
                @click="onClearAll"
                @mousedown.stop
                :disabled="history.length === 0"
            >
                清空
            </button>
        </header>

        <div class="content" v-if="history.length > 0">
            <div
                v-for="item in history"
                :key="item.id"
                class="history-item"
                :class="{ 'is-current': item.hash === currentHash }"
                @click="onCopyItem(item)"
            >
                <div class="item-content">
                    <template v-if="item.content_type === 'image'">
                        <img :src="getRecordContent(item)" class="item-image" alt="剪贴板图片" />
                    </template>
                    <template v-else>
                        <div class="item-text">{{ truncateText(getRecordContent(item)) }}</div>
                    </template>
                    <div class="item-time">{{ formatTime(item.timestamp) }}</div>
                </div>
                <button
                    class="delete-btn"
                    type="button"
                    @click.stop="onDeleteItem(item.id)"
                    @mousedown.stop
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                </button>
            </div>
        </div>

        <div class="empty-state" v-else>
            <div class="empty-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
            </div>
            <div class="empty-text">暂无剪贴板历史</div>
            <div class="empty-hint">复制文本后会自动记录到这里</div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { getRecordContent } from "../stores/clipboardStore";
import { useClipboardStore } from "../stores/clipboardStore";
import { useClipboardEvents } from "../composables/useClipboardEvents";

const router = useRouter();
const clipboardStore = useClipboardStore();
const {
    history,
    onCopyItem,
    onDeleteItem,
    onClearAll,
    truncateText,
    formatTime,
} = useClipboardEvents();

const currentHash = computed(() => clipboardStore.currentClipboardHash);

function onBack() {
    router.back();
}
</script>

<style scoped>
.clipboard-history {
    width: 100vw;
    height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg-color);
}

.clipboard-header {
    height: 52px;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 12px;
    background: var(--card-bg);
    border-bottom: 1px solid var(--border-color);
    backdrop-filter: var(--backdrop-blur);
}

.back-btn,
.clear-btn {
    border: 0;
    padding: 8px 10px;
    border-radius: 10px;
    background: var(--hover-bg);
    color: var(--text-color);
    cursor: pointer;
    -webkit-app-region: no-drag;
    font-size: 13px;
}

.back-btn:hover,
.clear-btn:hover:not(:disabled) {
    background: var(--hover-bg-strong);
}

.clear-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.title {
    flex: 1;
    font-size: 16px;
    font-weight: 700;
    color: var(--text-color);
}

.content {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.content::-webkit-scrollbar {
    width: 6px;
}

.content::-webkit-scrollbar-track {
    background: transparent;
}

.content::-webkit-scrollbar-thumb {
    background: var(--border-color-strong);
    border-radius: 3px;
}

.history-item {
    display: flex;
    align-items: center;
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
    border-color: var(--primary-color);
    box-shadow: var(--card-shadow);
}

.history-item.is-current {
    background: var(--primary-bg);
    border-color: var(--primary-color);
    box-shadow: 0 0 0 1px var(--primary-color);
}

.item-content {
    flex: 1;
    min-width: 0;
}

.item-text {
    font-size: 14px;
    color: var(--text-color);
    line-height: 1.4;
    word-break: break-all;
    white-space: pre-wrap;
}

.item-time {
    font-size: 12px;
    color: var(--text-hint);
    margin-top: 4px;
}

.item-image {
    max-width: 100%;
    max-height: 120px;
    border-radius: 8px;
    margin-top: 8px;
}

.delete-btn {
    flex-shrink: 0;
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

.empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 32px;
}

.empty-icon {
    color: var(--text-hint);
}

.empty-text {
    font-size: 16px;
    font-weight: 500;
    color: var(--text-secondary);
}

.empty-hint {
    font-size: 13px;
    color: var(--text-hint);
}
</style>
