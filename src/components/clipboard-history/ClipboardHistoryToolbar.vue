<template>
    <header class="clipboard-header" data-tauri-drag-region>
        <button class="back-btn" type="button" @click="$emit('back')" @mousedown.stop>
            返回
        </button>
        <div class="title" data-tauri-drag-region>剪贴板历史</div>
        <button
            class="clear-btn"
            type="button"
            @click="$emit('clear-all')"
            @mousedown.stop
            :disabled="historyCount === 0"
        >
            清空
        </button>
    </header>

    <div class="toolbar">
        <div class="search-wrap" :class="{ 'is-keyboard-focus': tabRegion === 'search' }">
            <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
            </svg>
            <input
                ref="searchInputRef"
                :value="searchKeyword"
                type="text"
                class="search-input"
                placeholder="搜索文本、代码、图片路径"
                @input="onSearchInput"
                @keydown.escape.prevent.stop="$emit('clear-search')"
            />
            <button
                v-if="searchKeyword"
                type="button"
                class="search-clear-btn"
                title="清空搜索"
                @click="$emit('clear-search')"
                @mousedown.stop
            >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                </svg>
            </button>
        </div>

        <div class="filter-row">
            <button
                v-for="option in filterOptions"
                :key="option.key"
                type="button"
                class="filter-chip"
                :class="{
                    'is-active': selectedFilter === option.key,
                    'is-keyboard-focus': tabRegion === 'filter' && focusedFilterKey === option.key,
                }"
                :data-filter-key="option.key"
                :ref="(el) => setFilterChipRef(el, option.key)"
                @click="onSelectFilter(option.key)"
            >
                {{ option.label }}
            </button>
        </div>

        <div class="usage-hint">单击条目即可复制，点击 ☆ 收藏常用内容</div>
    </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, type ComponentPublicInstance } from "vue";
import { FILTER_OPTIONS, type ClipboardFilter, type ClipboardTabRegion } from "./types";

const props = defineProps<{
    historyCount: number;
    searchKeyword: string;
    selectedFilter: ClipboardFilter;
    tabRegion: ClipboardTabRegion;
    focusedFilterKey: ClipboardFilter;
    setFilterChipRef: (el: Element | ComponentPublicInstance | null, key: ClipboardFilter) => void;
}>();

const emit = defineEmits<{
    (e: "back"): void;
    (e: "clear-all"): void;
    (e: "clear-search"): void;
    (e: "update:searchKeyword", value: string): void;
    (e: "update:selectedFilter", value: ClipboardFilter): void;
    (e: "search-blur"): void;
}>();

const searchInputRef = ref<HTMLInputElement | null>(null);
const filterOptions = FILTER_OPTIONS;

function handleBlur() {
    emit("search-blur");
}

onMounted(() => {
    searchInputRef.value?.addEventListener("blur", handleBlur);
});

onBeforeUnmount(() => {
    searchInputRef.value?.removeEventListener("blur", handleBlur);
});

function onSearchInput(event: Event) {
    emit("update:searchKeyword", (event.target as HTMLInputElement).value);
}

function onSelectFilter(key: ClipboardFilter) {
    emit("update:selectedFilter", key);
}

defineExpose({
    searchInputRef,
    focusSearch() {
        searchInputRef.value?.focus();
    },
    blurSearch() {
        searchInputRef.value?.blur();
    },
});

void props;

</script>

<style lang="scss" scoped>
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

.toolbar {
    padding: 10px 12px 12px;
    border-bottom: 1px solid var(--border-color);
    background: var(--card-bg);
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.search-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--input-bg);
    border: 1px solid var(--border-color);
    border-radius: 10px;
    padding: 8px 10px;
}

.search-wrap.is-keyboard-focus {
    border: 1px solid var(--primary-color);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--primary-color) 35%, transparent);
}

.search-icon {
    width: 16px;
    height: 16px;
    color: var(--text-hint);
    flex-shrink: 0;
}

.search-input {
    border: 0;
    outline: none;
    background: transparent;
    width: 100%;
    color: var(--text-color);
    font-size: 13px;
}

.search-input::placeholder {
    color: var(--text-hint);
}

.search-clear-btn {
    width: 20px;
    height: 20px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--text-hint);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    -webkit-app-region: no-drag;
}

.search-clear-btn svg {
    width: 12px;
    height: 12px;
}

.search-clear-btn:hover {
    background: var(--hover-bg);
    color: var(--text-color);
}

.filter-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}

.filter-chip {
    border: 1px solid var(--border-color);
    border-radius: 999px;
    padding: 4px 10px;
    background: transparent;
    color: var(--text-secondary);
    font-size: 12px;
    cursor: pointer;
    -webkit-app-region: no-drag;
}

.filter-chip:hover {
    background: var(--hover-bg);
}

.filter-chip.is-active {
    border-style: dashed;
    border-color: color-mix(in srgb, var(--primary-color) 70%, transparent);
    background: var(--primary-bg);
    color: var(--primary-color);
}

.filter-chip.is-keyboard-focus {
    border: 1px solid var(--primary-color);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--primary-color) 35%, transparent);
}

.usage-hint {
    font-size: 12px;
    color: var(--text-hint);
}
</style>
