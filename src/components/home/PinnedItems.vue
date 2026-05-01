<template>
    <div v-if="items.length > 0" class="home-section" data-menu-type="Home-Pinned-View" data-home-section="pinned">
        <div class="home-section-header">
            <span class="home-section-title">固定启动项</span>
        </div>
        <draggable :model-value="items" item-key="key" class="home-grid" :style="{ '--cols': layout.cols }"
            ghost-class="pinned-ghost" chosen-class="pinned-chosen" drag-class="pinned-drag" :animation="150"
            :delay="200" :delay-on-touch-only="false" :force-fallback="true" fallback-class="pinned-drag"
            :fallback-tolerance="5" @update:model-value="onReorder">
            <template #item="{ element, index }">
                <HomeCard :item-id="element.item.id" :category-id="element.primaryCategoryId" :name="element.item.name"
                    :icon-base64="element.item.iconBase64" :item-type="element.item.itemType"
                    :has-dependencies="element.item.launchDependencies.length > 0"
                    :launch-status="getLaunchStatus(element.item.id)"
                    :cols="layout.cols" menu-type="Icon-Item" home-section="pinned"
                    :shortcut-index="(startIndex ?? 0) + index"
                    :show-shortcut-badge="showShortcutBadge"
                    @click="onItemClick(element)">
                </HomeCard>
            </template>
        </draggable>

    </div>
</template>

<script setup lang="ts">
import draggable from "vuedraggable";
import HomeCard from "./HomeCard.vue";
import type { PinnedMergedItem } from "../../stores";

defineProps<{
    items: PinnedMergedItem[];
    layout: { cols: number; rows: number };
    getLaunchStatus: (itemId: string) => "launching" | "success" | undefined;
    startIndex?: number;
    showShortcutBadge?: boolean;
}>();

const emit = defineEmits<{
    (e: "select", item: PinnedMergedItem): void;
    (e: "reorder", newOrder: string[]): void;
}>();

function onReorder(newItems: PinnedMergedItem[]) {
    const newOrder = newItems.map(item => item.item.id);
    emit("reorder", newOrder);
}

function onItemClick(item: PinnedMergedItem) {
    emit("select", item);
}
</script>

<style lang="scss" scoped>
.home-section-header {
    margin-bottom: 8px;
}

.home-section-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-color-secondary);
    text-shadow: var(--text-shadow);
}

.home-grid {
    --cols: 5;
    display: grid;
    grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
    gap: 8px;


}

.pinned-ghost {
    opacity: 0.4;
}

.pinned-chosen {
    cursor: grabbing;
}

.pinned-drag {
    cursor: grabbing;
    transition: none !important;

    :deep(.home-card) {
        transition: none !important;
    }
}
</style>
