<template>
    <div class="global-search-results">
        <div class="search-result-header">
            搜索结果 ( {{ results.length }} )
        </div>
        <div class="search-result-list">
            <div
                v-for="(result, index) in results"
                :key="result.key"
                :ref="el => setItemRef(el, index)"
                class="search-result-item"
                :class="{
                    'is-launching': getLaunchStatus(result.item.id) === 'launching',
                    'is-success': getLaunchStatus(result.item.id) === 'success',
                    'is-selected': selectedIndex === index
                }"
                :data-menu-type="'Icon-Item'"
                :data-item-id="result.item.id"
                :data-category-id="result.categories[0]?.id || ''"
                @click.left="$emit('select', result)"
            >
                <div class="result-icon">
                    <img
                        v-if="result.item.iconBase64"
                        class="icon-real"
                        :src="getIconSrc(result.item.iconBase64)"
                        alt=""
                        draggable="false"
                    />
                    <div v-else class="icon-fallback">
                        {{ getFallbackText(result.item.name) }}
                    </div>
                </div>
                <div class="result-info">
                    <div class="result-name" :title="result.item.name">
                        {{ result.item.name }}
                    </div>
                    <div class="result-categories">
                        <span
                            v-for="c in result.categories"
                            :key="c.id"
                            class="result-category-chip"
                            :title="c.name"
                        >
                            {{ c.name }}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, type ComponentPublicInstance } from "vue";
import type { GlobalSearchMergedResult } from "../../stores";

const props = defineProps<{
    results: GlobalSearchMergedResult[];
    getLaunchStatus: (itemId: string) => "launching" | "success" | undefined;
    selectedIndex: number;
}>();

defineEmits<{
    (e: "select", result: GlobalSearchMergedResult): void;
}>();

const itemRefs = ref<(HTMLElement | null)[]>([]);

function setItemRef(el: Element | ComponentPublicInstance | null, index: number) {
    itemRefs.value[index] = el as HTMLElement | null;
}

watch(() => props.selectedIndex, async (newIndex) => {
    if (newIndex >= 0 && newIndex < props.results.length) {
        await nextTick();
        const el = itemRefs.value[newIndex];
        if (el) {
            el.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
    }
});

function getIconSrc(iconBase64: string) {
    if (iconBase64.startsWith("data:")) return iconBase64;
    return `data:image/png;base64,${iconBase64}`;
}

function getFallbackText(name: string) {
    const text = name.trim();
    if (!text) return "?";
    return text.slice(0, 1).toUpperCase();
}
</script>

<style lang="scss" scoped>
.global-search-results {
    flex: 1;
    padding: 0 16px 16px;
    overflow-y: auto;
    &::-webkit-scrollbar {
        display: none;
    }
}

.search-result-header {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-color-secondary);
    text-shadow: var(--text-shadow);
    margin-bottom: 12px;
}

.search-result-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.search-result-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    background: var(--card-bg-solid);
    border-radius: 12px;
    cursor: pointer;
    transition: background 0.15s ease, transform 0.2s ease, box-shadow 0.2s ease;
    box-shadow: var(--card-shadow-light);

    &:hover {
        @media (hover: hover) {
            background: var(--card-bg-hover);
            transform: scale(calc(1 + 0.02 * (1 - var(--performance-mode, 0))));
            box-shadow: var(--card-shadow-light), 0 4px 12px calc(0px * var(--performance-mode, 0)) rgba(0, 0, 0, 0.15);
        }
    }

    &.is-launching {
        animation: launching-shadow 1.2s ease-in-out infinite;
    }

    &.is-success {
        animation: success-shadow 1.2s ease-in-out infinite;
    }

    &.is-selected {
        background: var(--card-bg-hover);
        box-shadow: 0 0 0 2px var(--primary-color, #0078d4), var(--card-shadow-light);
    }
}

.result-icon {
    width: 40px;
    height: 40px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;

    .icon-real {
        width: 100%;
        height: 100%;
        object-fit: contain;
    }

    .icon-fallback {
        width: 100%;
        height: 100%;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--bg-color-secondary);
        font-weight: 800;
        color: var(--text-color);
        font-size: 18px;
    }
}

.result-info {
    flex: 1;
    min-width: 0;
}

.result-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-color);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}

.result-categories {
    margin-top: 3px;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    max-height: 34px;
    overflow-y: auto;
    scrollbar-width: none;
    -ms-overflow-style: none;
    &::-webkit-scrollbar {
        display: none;
    }
}

.result-category-chip {
    font-size: 11px;
    color: var(--text-color-tertiary);
    background: var(--bg-color-secondary);
    padding: 2px 6px;
    border-radius: 999px;
    max-width: 100%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}

@keyframes launching-shadow {
    0% {
        box-shadow: 0 0 0 2px rgba(0, 120, 212, 0.3), var(--card-shadow-light);
    }
    50% {
        box-shadow: 0 0 0 4px rgba(0, 120, 212, 0.6), var(--card-shadow-light);
    }
    100% {
        box-shadow: 0 0 0 2px rgba(0, 120, 212, 0.3), var(--card-shadow-light);
    }
}

@keyframes success-shadow {
    0% {
        box-shadow: 0 0 0 2px rgba(76, 175, 80, 0.3), var(--card-shadow-light);
    }
    50% {
        box-shadow: 0 0 0 4px rgba(76, 175, 80, 0.6), var(--card-shadow-light);
    }
    100% {
        box-shadow: 0 0 0 2px rgba(76, 175, 80, 0.3), var(--card-shadow-light);
    }
}
</style>
