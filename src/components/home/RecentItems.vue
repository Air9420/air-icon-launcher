<template>
    <div v-if="items.length > 0" class="home-section" data-menu-type="Home-Recent-Used-View">
        <div class="home-section-header">
            <span class="home-section-title">最近使用</span>
        </div>
        <div class="home-grid" :style="{ '--cols': layout.cols }">
            <HomeCard v-for="item in items" :key="item.key" :item-id="item.recent.itemId"
                :category-id="item.recent.categoryId" :name="item.item.name" :icon-base64="item.item.iconBase64"
                :item-type="item.item.itemType"
                :has-dependencies="item.item.launchDependencies.length > 0"
                :launch-status="getLaunchStatus(item.recent.itemId)" :cols="layout.cols" menu-type="Icon-Item" home-section="recent"
                @click="$emit('select', item)" />
        </div>
    </div>
</template>

<script setup lang="ts">
import HomeCard from "./HomeCard.vue";
import type { RecentUsedMergedItem } from "../../stores";

defineProps<{
    items: RecentUsedMergedItem[];
    layout: { cols: number; rows: number };
    getLaunchStatus: (itemId: string) => "launching" | "success" | undefined;
}>();

defineEmits<{
    (e: "select", item: RecentUsedMergedItem): void;
}>();
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
    // 动画过渡效果
    transition: all 0.3s ease;
}
</style>
