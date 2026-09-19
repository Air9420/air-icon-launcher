<template>
    <div
        v-if="visible"
        class="external-convert-drag-overlay"
    >
        <div
            class="external-convert-drag-ghost"
            :style="ghostStyle"
        >
            {{ name || "添加到分类" }}
        </div>
    </div>
</template>

<script setup lang="ts">
defineProps<{
    visible: boolean;
    name: string;
    ghostStyle: Record<string, string>;
}>();
</script>

<style lang="scss" scoped>
.external-convert-drag-overlay {
    position: fixed;
    inset: 0;
    z-index: 9000;
    pointer-events: none;
}

.external-convert-drag-ghost {
    position: fixed;
    transform: translate(-50%, -130%);
    max-width: 280px;
    padding: 8px 12px;
    border-radius: 10px;
    background: var(--card-bg-solid);
    color: var(--text-color);
    border: 1px solid var(--border-color);
    box-shadow: var(--menu-shadow);
    backdrop-filter: var(--backdrop-blur);
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
</style>
