<template>
    <div
        v-if="items.length > 0"
        class="home-section"
        data-menu-type="Home-Recent-Used-View"
        :data-home-section="homeSection"
    >
        <div class="home-section-header">
            <span class="home-section-title">{{ title }}</span>
        </div>
        <div class="home-grid" :style="{ '--cols': layout.cols }">
            <HomeCard
                v-for="(item, index) in items"
                :key="item.key"
                :item-id="getItemId(item)"
                :category-id="getCategoryId(item)"
                :item-path="getItemPath(item)"
                :name="getName(item)"
                :icon-base64="getIconBase64(item)"
                :item-type="getItemType(item)"
                :has-dependencies="getHasDependencies(item)"
                :feature-badge-text="getFeatureBadgeText(item)"
                :launch-status="getLaunchStatusByItem(item, getLaunchStatus)"
                :cols="layout.cols"
                menu-type="Icon-Item"
                :home-section="homeSection"
                :shortcut-index="(startIndex ?? 0) + index"
                :show-shortcut-badge="showShortcutBadge"
                :is-selected="selectedIndex !== undefined && selectedIndex === index"
                @click="$emit('select', item)"
            />
        </div>
    </div>
</template>

<script setup lang="ts">
import HomeCard from "./HomeCard.vue";
import type { RecentUsedMergedItem } from "../../stores";
import type { HomeRecentDisplayItem } from "../../composables/useHomePageState";
import type { LaunchStatus } from "../../composables/useLaunchStatus";

type InternalRecentDisplayItem = RecentUsedMergedItem & {
    featureBadgeText?: string;
};

withDefaults(defineProps<{
    items: HomeRecentDisplayItem[];
    layout: { cols: number; rows: number };
    getLaunchStatus: (itemId: string) => LaunchStatus | undefined;
    title?: string;
    homeSection?: string;
    startIndex?: number;
    showShortcutBadge?: boolean;
    selectedIndex?: number;
}>(), {
    title: "最近使用",
    homeSection: "recent",
});

defineEmits<{
    (e: "select", item: HomeRecentDisplayItem): void;
}>();

function isExternalItem(item: HomeRecentDisplayItem): item is Exclude<HomeRecentDisplayItem, InternalRecentDisplayItem> {
    return "external" in item;
}

function getItemId(item: HomeRecentDisplayItem): string {
    if (isExternalItem(item)) {
        return item.key;
    }
    return item.recent.itemId;
}

function getCategoryId(item: HomeRecentDisplayItem): string {
    if (isExternalItem(item)) {
        return "";
    }
    return item.recent.categoryId;
}

function getName(item: HomeRecentDisplayItem): string {
    if (isExternalItem(item)) {
        return item.external.name;
    }
    return item.item.name;
}

function getItemPath(item: HomeRecentDisplayItem): string | null {
    if (isExternalItem(item)) {
        return item.external.path;
    }
    return item.item.path;
}

function getIconBase64(item: HomeRecentDisplayItem): string | null {
    if (isExternalItem(item)) {
        return item.external.iconBase64;
    }
    return item.item.iconBase64;
}

function getItemType(item: HomeRecentDisplayItem): "file" | "url" {
    if (isExternalItem(item)) {
        return "file";
    }
    return item.item.itemType;
}

function getHasDependencies(item: HomeRecentDisplayItem): boolean {
    if (isExternalItem(item)) {
        return false;
    }
    return item.item.launchDependencies.length > 0;
}

function getFeatureBadgeText(item: HomeRecentDisplayItem): string | undefined {
    if (isExternalItem(item)) {
        return item.featureBadgeText || item.external.source || "外部";
    }
    return item.featureBadgeText;
}

function getLaunchStatusByItem(item: HomeRecentDisplayItem, getter: (itemId: string) => LaunchStatus | undefined) {
    if (isExternalItem(item)) {
        return getter(item.key);
    }
    return getter(item.recent.itemId);
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
    // 动画过渡效果
    transition: all 0.3s ease;
}
</style>
