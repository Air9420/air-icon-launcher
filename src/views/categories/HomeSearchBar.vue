<template>
    <div class="search-header">
        <div ref="searchShellRef" class="search-shell">
            <SearchBox
                ref="searchBoxRef"
                :model-value="searchKeyword"
                placeholder="搜一搜"
                :intercept-tab="true"
                @update:model-value="emit('update:searchKeyword', $event)"
                @nav="onNav"
            >
                <template #actions>
                    <button
                        v-if="!searchKeyword.trim()"
                        class="history-toggle-btn"
                        type="button"
                        @mousedown.prevent
                        @click="emit('toggle-history')"
                    >
                        {{ showSearchHistoryPanel ? "收起历史" : "展示历史" }}
                    </button>
                </template>
            </SearchBox>

            <div v-if="showSearchHistoryPanel" class="search-history-panel">
                <div class="search-history-head">
                    <div class="search-history-title">最近搜索</div>
                    <button
                        v-if="searchHistoryEntries.length > 0"
                        class="search-history-clear-btn"
                        type="button"
                        @mousedown.prevent
                        @click="emit('clear-history')"
                    >
                        清空
                    </button>
                </div>
                <template v-if="searchHistoryEntries.length > 0">
                    <div
                        v-for="entry in searchHistoryEntries"
                        :key="entry.keyword"
                        class="search-history-row"
                    >
                        <button
                            class="search-history-item"
                            type="button"
                            @mousedown.prevent
                            @click="emit('select-history', getSearchHistoryLabel(entry))"
                        >
                            <span class="history-keyword">{{ getSearchHistoryLabel(entry) }}</span>
                            <span class="history-meta">{{ entry.count }} 次</span>
                        </button>
                        <button
                            class="search-history-remove-btn"
                            type="button"
                            :title="`删除 ${getSearchHistoryLabel(entry)}`"
                            @mousedown.prevent
                            @click.stop="emit('remove-history', entry.keyword)"
                        >
                            ×
                        </button>
                    </div>
                </template>
                <div v-else class="search-history-empty">暂无最近搜索</div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import SearchBox from "../../components/SearchBox.vue";
import type { SearchKeywordRecord } from "../../stores/statsStore";

defineProps<{
    searchKeyword: string;
    showSearchHistoryPanel: boolean;
    searchHistoryEntries: SearchKeywordRecord[];
    getSearchHistoryLabel: (entry: SearchKeywordRecord) => string;
}>();

const emit = defineEmits<{
    (e: "update:searchKeyword", value: string): void;
    (e: "nav", direction: "up" | "down" | "enter" | "tab"): void;
    (e: "toggle-history"): void;
    (e: "clear-history"): void;
    (e: "select-history", keyword: string): void;
    (e: "remove-history", keyword: string): void;
}>();

const searchBoxRef = ref<InstanceType<typeof SearchBox> | null>(null);
const searchShellRef = ref<HTMLElement | null>(null);

function onNav(direction: "up" | "down" | "enter" | "tab") {
    emit("nav", direction);
}

defineExpose({
    searchBoxRef,
    searchShellRef,
    focus() {
        searchBoxRef.value?.focus();
    },
});
</script>

<style lang="scss" scoped>
.search-header {
    padding: 8px 16px 0px 16px;
    flex-shrink: 0;
}

.search-shell {
    position: relative;
    width: min(100%, 760px);
    margin: 0 auto;
}

.history-toggle-btn {
    height: 18px;
    border: 0;
    border-radius: 999px;
    background: var(--hover-bg);
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 12px;
    transition: background 0.15s ease, color 0.15s ease;
}

.history-toggle-btn:hover {
    background: var(--hover-bg-strong);
    color: var(--text-color);
}

.search-history-panel {
    position: absolute;
    top: calc(100% + 10px);
    left: 0;
    right: 0;
    z-index: 12;
    padding: 12px;
    border-radius: 16px;
    background: var(--search-history-bg);
    border: 1px solid var(--border-color);
    box-shadow: var(--card-shadow);
    backdrop-filter: var(--backdrop-blur);
}

.search-history-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
}

.search-history-title {
    font-size: 12px;
    font-weight: 700;
    color: var(--text-hint);
}

.search-history-clear-btn {
    border: 0;
    background: transparent;
    color: var(--text-hint);
    font-size: 12px;
    cursor: pointer;
    transition: color 0.15s ease;
}

.search-history-clear-btn:hover {
    color: var(--text-color);
}

.search-history-row {
    display: flex;
    align-items: center;
    gap: 8px;
}

.search-history-item {
    flex: 1;
    border: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 12px;
    background: transparent;
    color: var(--text-color);
    cursor: pointer;
    transition: background 0.15s ease;
}

.search-history-item:hover {
    background: var(--hover-bg);
}

.search-history-remove-btn {
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: var(--text-hint);
    cursor: pointer;
    font-size: 18px;
    line-height: 1;
    transition: background 0.15s ease, color 0.15s ease;
}

.search-history-remove-btn:hover {
    background: var(--hover-bg);
    color: var(--text-color);
}

.history-keyword {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 14px;
}

.history-meta {
    flex-shrink: 0;
    font-size: 12px;
    color: var(--text-hint);
}

.search-history-empty {
    padding: 12px 8px 4px;
    color: var(--text-hint);
    font-size: 13px;
}
</style>
