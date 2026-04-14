<template>
    <div class="search-fallback">
        <div class="fallback-icon">🔍</div>
        <div class="fallback-title">未找到 "{{ keyword }}"</div>
        <div class="fallback-subtitle">没有找到匹配的应用，你可以：</div>
        <div class="fallback-actions">
            <button class="fallback-action" @click="emit('browser-search')">
                <span class="action-icon">🌐</span>
                <span class="action-text">用浏览器搜索</span>
            </button>
            <button
                v-if="aiEnabled"
                class="fallback-action"
                :class="{ 'is-loading': isAILoading }"
                @click="onAISearch"
                :disabled="isAILoading"
            >
                <span class="action-icon">🤖</span>
                <span class="action-text">{{ isAILoading ? 'AI 思考中...' : '用 AI 推荐' }}</span>
            </button>
        </div>
        <div v-if="aiResults.length > 0" class="ai-results">
            <div class="ai-results-title">AI 推荐</div>
            <div
                v-for="result in aiResults"
                :key="result.name"
                class="ai-result-item"
                @click="onSelectAIResult(result)"
            >
                <span class="ai-result-name">{{ result.name }}</span>
                <span class="ai-result-reason">{{ result.reason }}</span>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref } from "vue";

interface AIResult {
    name: string;
    reason: string;
    path?: string;
}

defineProps<{
    keyword: string;
    aiEnabled?: boolean;
}>();

const emit = defineEmits<{
    (e: "browser-search"): void;
    (e: "ai-search"): void;
    (e: "select-result", result: AIResult): void;
}>();

const isAILoading = ref(false);
const aiResults = ref<AIResult[]>([]);

function onAISearch() {
    emit("ai-search");
}

function onSelectAIResult(result: AIResult) {
    emit("select-result", result);
}
</script>

<style lang="scss" scoped>
.search-fallback {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 32px 24px;
    gap: 12px;
}

.fallback-icon {
    font-size: 48px;
    margin-bottom: 8px;
}

.fallback-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-color);
}

.fallback-subtitle {
    font-size: 14px;
    color: var(--text-color-secondary);
    margin-bottom: 8px;
}

.fallback-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    max-width: 280px;
}

.fallback-action {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    background: var(--card-bg-solid);
    border: none;
    border-radius: 10px;
    cursor: pointer;
    transition: background 0.15s ease;
    text-align: left;

    &:hover {
        background: var(--card-bg-hover);
    }

    &.is-loading {
        opacity: 0.7;
        cursor: wait;
    }

    .action-icon {
        font-size: 18px;
    }

    .action-text {
        font-size: 14px;
        color: var(--text-color);
    }
}

.ai-results {
    margin-top: 16px;
    width: 100%;
    max-width: 320px;
}

.ai-results-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-color-secondary);
    margin-bottom: 8px;
    padding-left: 4px;
}

.ai-result-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 12px;
    background: var(--card-bg-solid);
    border-radius: 8px;
    cursor: pointer;
    transition: background 0.15s ease;
    margin-bottom: 6px;

    &:hover {
        background: var(--card-bg-hover);
    }

    .ai-result-name {
        font-size: 14px;
        font-weight: 500;
        color: var(--text-color);
    }

    .ai-result-reason {
        font-size: 12px;
        color: var(--text-color-tertiary);
    }
}
</style>
