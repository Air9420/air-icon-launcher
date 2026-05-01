<template>
  <div class="categories-page" ref="mainContainerRef" tabindex="-1">
    <PinnedItems
      :items="pinnedItems"
      :start-index="0"
      :show-shortcut-badge="showShortcutHints"
    />
    <RecentItems
      :items="recentItems"
      :start-index="pinnedCount"
      :show-shortcut-badge="showShortcutHints"
    />

    <div v-if="hasBothSections" class="section-divider" />

    <template v-for="category in displayCategories" :key="category.id">
      <div class="category-group" @contextmenu.prevent="handleCategoryContextMenu($event, category)">
        <div class="category-header" @click="toggleCategory(category.id)">
          <span class="category-arrow" :class="{ expanded: expandedCategories.has(category.id) }">
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path
                d="M9 6l6 6-6 6"
                stroke="currentColor"
                stroke-width="2"
                fill="none"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </span>
          <div class="category-title">
            <img
              v-if="category.iconSrc"
              :src="category.iconSrc"
              class="category-icon"
              alt=""
            />
            <span>{{ category.displayName }}</span>
          </div>
        </div>
        <div v-if="expandedCategories.has(category.id)" class="category-grid">
          <HomeCard
            v-for="item in category.items"
            :key="item.id"
            :item="item"
            :category-id="category.id"
            :show-shortcut-badge="false"
            @contextmenu.prevent="handleItemContextMenu($event, item, category.id)"
          />
        </div>
      </div>
      <div
        v-if="category !== displayCategories[displayCategories.length - 1]"
        class="category-divider"
      />
    </template>

    <ContextMenu
      v-if="contextMenu.visible"
      :items="contextMenu.items"
      :x="contextMenu.x"
      :y="contextMenu.y"
      @close="closeContextMenu"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import HomeCard from "../components/home/HomeCard.vue";
import PinnedItems from "../components/home/PinnedItems.vue";
import RecentItems from "../components/home/RecentItems.vue";
import ContextMenu from "../components/common/ContextMenu.vue";
import { useLauncherStore } from "../stores/launcherStore";
import { useSearchStore } from "../stores/searchStore";
import { useSettingsStore } from "../stores/settingsStore";
import { getSearchShortcutIndex, getHomeShortcutTarget } from "../utils/search-ui";
import type { LauncherItem } from "../types/config";
import type { CategoryDefinition } from "../types/config";

const router = useRouter();
const launcherStore = useLauncherStore();
const searchStore = useSearchStore();
const settingsStore = useSettingsStore();
const mainContainerRef = ref<HTMLElement | null>(null);

const showShortcutHints = ref(false);
let ctrlPressed = false;

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Control" && !e.repeat) {
    ctrlPressed = true;
    showShortcutHints.value = true;
  }

  if (ctrlPressed && searchStore.searchQuery.length === 0) {
    const shortcutIndex = getSearchShortcutIndex(e.code, e.key);
    if (shortcutIndex !== null) {
      const target = getHomeShortcutTarget(
        shortcutIndex,
        pinnedItems.value.length,
        recentItems.value.length
      );
      if (target) {
        let item: LauncherItem | undefined;
        if (target.type === "pinned") {
          item = pinnedItems.value[target.index];
        } else if (target.type === "recent") {
          item = recentItems.value[target.index];
        }
        if (item) {
          e.preventDefault();
          launcherStore.launchItem(item, item.categoryId || "");
        }
      }
    }
  }
}

function onKeyup(e: KeyboardEvent) {
  if (e.key === "Control") {
    ctrlPressed = false;
    showShortcutHints.value = false;
  }
}

onMounted(() => {
  document.addEventListener("keydown", onKeydown);
  document.addEventListener("keyup", onKeyup);
});

onUnmounted(() => {
  document.removeEventListener("keydown", onKeydown);
  document.removeEventListener("keyup", onKeyup);
});

const contextMenu = ref<{
  visible: boolean;
  x: number;
  y: number;
  items: { label: string; action: () => void }[];
}>({
  visible: false,
  x: 0,
  y: 0,
  items: [],
});

function closeContextMenu() {
  contextMenu.value.visible = false;
}

const homeSectionLayouts = computed(() => settingsStore.homeSectionLayouts);

const expandedCategories = ref<Set<string>>(new Set());

const categories = computed<CategoryDefinition[]>(() => {
  return launcherStore.categories
    .filter((category) => category.items.length > 0)
    .map((category) => {
      const trimmedName = category.name.trim();
      const displayName = trimmedName.length > 0 ? trimmedName : "Untitled";
      let iconSrc = "";
      if (category.customIconBase64) {
        iconSrc = `data:image/png;base64,${category.customIconBase64}`;
      }
      return {
        ...category,
        displayName,
        iconSrc,
      };
    });
});

const displayCategories = computed<CategoryDefinition[]>(() => {
  return categories.value.map((category) => {
    return {
      ...category,
      items: category.items,
    };
  });
});

const pinnedItems = computed<LauncherItem[]>(() => {
  return launcherStore.favoriteItems;
});

const pinnedCount = computed(() => pinnedItems.value.length);

const recentItems = computed<LauncherItem[]>(() => {
  return launcherStore.recentUsedItems;
});

const hasBothSections = computed(() => {
  return pinnedItems.value.length > 0 && recentItems.value.length > 0;
});

function toggleCategory(categoryId: string) {
  if (expandedCategories.value.has(categoryId)) {
    expandedCategories.value.delete(categoryId);
  } else {
    expandedCategories.value.add(categoryId);
  }
}

function handleCategoryContextMenu(event: MouseEvent, category: CategoryDefinition) {
  event.preventDefault();
  closeContextMenu();
  contextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    items: [
      { label: "重命名分类", action: () => {
        closeContextMenu();
        const newName = prompt("输入新分类名", category.name);
        if (newName && newName.trim()) {
          launcherStore.renameCategory(category.id, newName.trim());
        }
      }},
      { label: "删除分类", action: () => {
        closeContextMenu();
        if (confirm(`确认删除分类 "${category.name}"？`)) {
          launcherStore.removeCategory(category.id);
        }
      }},
      { label: "管理项目", action: () => {
        closeContextMenu();
        router.push(`/category/${encodeURIComponent(category.id)}`);
      }},
    ],
  };
}

function handleItemContextMenu(event: MouseEvent, item: LauncherItem, categoryId: string) {
  event.preventDefault();
  closeContextMenu();
  contextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    items: [
      { label: "打开文件位置", action: () => {
        closeContextMenu();
        launcherStore.openFileLocation(item);
      }},
      { label: "编辑项目", action: () => {
        closeContextMenu();
        router.push(`/category/${encodeURIComponent(categoryId)}/edit/${encodeURIComponent(item.id)}`);
      }},
      { label: item.isFavorite ? "取消固定" : "固定到首页", action: () => {
        closeContextMenu();
        launcherStore.toggleFavorite(item.id, item.categoryId || categoryId);
      }},
      { label: "删除项目", action: () => {
        closeContextMenu();
        if (confirm(`确认删除 "${item.name}"？`)) {
          launcherStore.removeItem(item.id, item.categoryId || categoryId);
        }
      }},
    ],
  };
}
</script>

<style scoped>
.categories-page {
  outline: none;
}

.section-divider {
  height: 1px;
  background: var(--color-text-secondary);
  opacity: 0.12;
  margin: 10px 0 14px;
}

.category-group {
  margin-bottom: 4px;
}

.category-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border-radius: 8px;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s;
}

.category-header:hover {
  background: var(--color-bg-secondary);
}

.category-arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
  transition: transform 0.2s;
  width: 20px;
}

.category-arrow.expanded {
  transform: rotate(90deg);
}

.category-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.category-icon {
  width: 18px;
  height: 18px;
  object-fit: contain;
  flex-shrink: 0;
}

.category-grid {
  display: grid;
  grid-template-columns: repeat(v-bind('homeSectionLayouts.recent.cols'), 1fr);
  gap: 4px;
  margin-top: 4px;
  padding-left: 8px;
}

.category-divider {
  height: 1px;
  background: var(--color-text-secondary);
  opacity: 0.08;
  margin: 10px 0;
}
</style>