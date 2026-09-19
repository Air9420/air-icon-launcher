<template>
    <div
        v-if="displayedGroupedHistory.length === 0 && groupedHistory.length > 0"
        class="filtered-empty"
    >
        <div class="filtered-empty-title">未找到匹配内容</div>
        <div class="filtered-empty-hint">可以尝试更短关键词或切换筛选类型</div>
    </div>

    <div
        v-if="displayedGroupedHistory.length === 0 && groupedHistory.length === 0 && !isLoadingMore"
        class="empty-state"
    >
        <div class="empty-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
        </div>
        <div class="empty-text">暂无剪贴板历史</div>
        <div class="empty-hint">复制文本后会自动记录到这里</div>
    </div>
</template>

<script setup lang="ts">
import type { ClipboardGroup } from "./types";

defineProps<{
    displayedGroupedHistory: ClipboardGroup[];
    groupedHistory: ClipboardGroup[];
    isLoadingMore: boolean;
}>();
</script>

<style lang="scss" scoped>
.filtered-empty {
    border: 1px dashed var(--border-color);
    border-radius: 12px;
    padding: 24px 16px;
    text-align: center;
    background: var(--card-bg);
}

.filtered-empty-title {
    font-size: 14px;
    color: var(--text-secondary);
    margin-bottom: 4px;
}

.filtered-empty-hint {
    font-size: 12px;
    color: var(--text-hint);
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
