<template>
    <div>
        <header class="category-header" data-tauri-drag-region>
            <button
                ref="backBtnRef"
                class="back-btn"
                :class="{ 'is-keyboard-focus': tabRegion === 'back' }"
                type="button"
                @click="emit('back')"
                @mousedown.stop
            >
                返回
            </button>
            <div class="category-title" data-tauri-drag-region>
                {{ title }}
            </div>
            <div class="header-search">
                <SearchBox
                    ref="searchBoxRef"
                    :model-value="searchKeyword"
                    placeholder="搜索启动项..."
                    @update:model-value="emit('update:searchKeyword', $event)"
                />
            </div>
        </header>

        <div class="category-status-bar">
            <div class="status-group">
                <span class="status-label">启动项图标</span>
                <button
                    v-for="cols in launcherColsOptions"
                    :key="`launcher-cols-${cols}`"
                    class="status-chip"
                    :class="{ 'is-active': launcherCols === cols }"
                    type="button"
                    :aria-pressed="launcherCols === cols"
                    @click="emit('set-launcher-cols', cols)"
                >
                    {{ cols }}
                </button>
            </div>
            <div class="status-group">
                <span class="status-label">排序方式</span>
                <button
                    class="status-chip"
                    :class="{ 'is-active': categorySortMode === 'manual' }"
                    type="button"
                    :aria-pressed="categorySortMode === 'manual'"
                    @click="emit('set-sort-mode', 'manual')"
                >
                    手动
                </button>
                <button
                    class="status-chip"
                    :class="{ 'is-active': categorySortMode === 'smart' }"
                    type="button"
                    :aria-pressed="categorySortMode === 'smart'"
                    @click="emit('set-sort-mode', 'smart')"
                >
                    智能
                </button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import SearchBox from "../../components/SearchBox.vue";

defineProps<{
    title: string;
    searchKeyword: string;
    launcherCols: number;
    categorySortMode: string;
    tabRegion: "search" | "items" | "back";
}>();

const emit = defineEmits<{
    (e: "back"): void;
    (e: "update:searchKeyword", value: string): void;
    (e: "set-launcher-cols", cols: number): void;
    (e: "set-sort-mode", mode: "manual" | "smart"): void;
}>();

const launcherColsOptions = [4, 5, 6] as const;
const searchBoxRef = ref<InstanceType<typeof SearchBox> | null>(null);
const backBtnRef = ref<HTMLButtonElement | null>(null);

defineExpose({
    searchBoxRef,
    backBtnRef,
    focusSearch() {
        searchBoxRef.value?.focus();
    },
    focusBack() {
        backBtnRef.value?.focus();
    },
});
</script>

<style lang="scss" scoped>
.category-header {
    height: 52px;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 12px;
    background: var(--card-bg);
    border-bottom: 1px solid var(--border-color);
    backdrop-filter: var(--backdrop-blur);
    user-select: none;
}

.category-status-bar {
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 12px;
    background: var(--card-bg);
    border-bottom: 1px solid var(--border-color);
}

.status-group {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
}

.status-label {
    font-size: 12px;
    color: var(--text-secondary);
}

.status-chip {
    appearance: none;
    border: 1px solid transparent;
    padding: 2px 8px;
    border-radius: 6px;
    background: var(--hover-bg);
    color: var(--text-secondary);
    font-size: 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
}

.status-chip:hover {
    background: var(--hover-bg-strong);
}

.status-chip.is-active {
    color: var(--primary-color);
    font-weight: 700;
    background: color-mix(in srgb, var(--primary-color) 16%, transparent);
    border-color: color-mix(in srgb, var(--primary-color) 36%, transparent);
}

.back-btn {
    border: 0;
    padding: 8px 10px;
    border-radius: 10px;
    background: var(--hover-bg);
    cursor: pointer;
    -webkit-app-region: no-drag;
    color: var(--text-color);
}

.back-btn:hover {
    background: var(--hover-bg-strong);
}

.back-btn.is-keyboard-focus {
    box-shadow: 0 0 0 2px var(--primary-color, #0078d4) !important;
}

.category-title {
    font-size: 16px;
    font-weight: 700;
    color: var(--text-color);
}

.header-search {
    margin-left: auto;
    width: 200px;
    -webkit-app-region: no-drag;
}
</style>
