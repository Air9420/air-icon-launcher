<template>
  <div v-if="items.length > 0" class="pinned-section">
    <div class="section-label">Pinned</div>
    <div class="pinned-grid" :style="gridStyle">
      <HomeCard
        v-for="(item, index) in items"
        :key="item.id"
        :item="item"
        :category-id="item.categoryId || ''"
        :shortcut-index="startIndex + index"
        :show-shortcut-badge="showShortcutBadge"
        @contextmenu.prevent="$emit('itemContextmenu', $event, item)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import HomeCard from "./HomeCard.vue";
import { useSettingsStore } from "../../stores/settingsStore";
import type { LauncherItem } from "../../types/config";

const props = defineProps<{
  items: LauncherItem[];
  startIndex?: number;
  showShortcutBadge?: boolean;
}>();

defineEmits<{
  itemContextmenu: [event: MouseEvent, item: LauncherItem];
}>();

const settingsStore = useSettingsStore();

const gridStyle = computed(() => {
  const layout = settingsStore.homeSectionLayouts.pinned;
  return {
    gridTemplateColumns: `repeat(${layout.cols}, 1fr)`,
  };
});
</script>

<style scoped>
.pinned-section {
  margin-bottom: 6px;
}

.section-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
  padding-left: 4px;
}

.pinned-grid {
  display: grid;
  gap: 2px;
}
</style>