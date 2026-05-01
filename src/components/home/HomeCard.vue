<template>
  <div
    class="home-card"
    :class="{
      'card-hovered': isHovered,
      'card-url': item.itemType === 'url',
    }"
    @mouseenter="isHovered = true"
    @mouseleave="isHovered = false"
    @click.stop="openItem"
    @contextmenu.prevent="$emit('contextmenu', $event)"
  >
    <div class="card-icon-wrapper">
      <img
        v-if="item.iconBase64 || item.originalIconBase64"
        :src="iconSrc"
        class="card-icon"
        alt=""
      />
      <div v-else class="card-icon-placeholder">
        <svg viewBox="0 0 24 24" width="18" height="18">
          <path
            d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
            fill="currentColor"
            opacity="0.3"
          />
          <path
            d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm-1 2l5 5h-5z"
            fill="currentColor"
          />
        </svg>
      </div>
      <div
        v-if="showShortcutBadgeValue && shortcutIndex >= 0 && shortcutIndex <= 9"
        class="shortcut-badge"
        :key="`badge-${shortcutIndex}-${forceUpdate}`"
      >
        {{ shortcutIndex === 9 ? 0 : shortcutIndex + 1 }}
      </div>
    </div>
    <div class="card-name">{{ item.name }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useLauncherStore } from "../../stores/launcherStore";
import type { LauncherItem } from "../../types/config";

const props = defineProps<{
  item: LauncherItem;
  categoryId: string;
  shortcutIndex?: number;
  showShortcutBadge?: boolean;
}>();

defineEmits<{
  contextmenu: [event: MouseEvent];
}>();

const launcherStore = useLauncherStore();
const isHovered = ref(false);
const forceUpdate = ref(0);

const showShortcutBadgeValue = computed(() => props.showShortcutBadge ?? false);

watch(() => props.showShortcutBadge, () => {
  forceUpdate.value++;
});

watch(() => props.shortcutIndex, () => {
  forceUpdate.value++;
});

const iconSrc = computed(() => {
  const base64 = props.item.iconBase64 || props.item.originalIconBase64;
  if (!base64) return "";
  return `data:image/png;base64,${base64}`;
});

function openItem() {
  launcherStore.launchItem(props.item, props.categoryId);
}
</script>

<style scoped>
.home-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 6px 4px 4px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s, transform 0.1s;
  position: relative;
}

.home-card.card-hovered {
  background: var(--color-bg-secondary);
  transform: translateY(-1px);
}

.card-icon-wrapper {
  position: relative;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.card-icon {
  width: 32px;
  height: 32px;
  object-fit: contain;
}

.card-icon-placeholder {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
}

.shortcut-badge {
  position: absolute;
  top: 4px;
  right: -6px;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--color-accent);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  pointer-events: none;
}

.card-name {
  font-size: 11px;
  color: var(--color-text-primary);
  text-align: center;
  max-width: 72px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>