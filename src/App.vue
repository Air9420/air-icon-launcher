<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount } from "vue";
import { storeToRefs } from "pinia";
import { invoke } from "@tauri-apps/api/core";
import { safeInvoke } from "./utils/invoke-wrapper";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useRouter } from "vue-router";

import ContextMenu from "./components/contextMenu.vue";
import ConfirmDialog from "./components/common/ConfirmDialog.vue";
import { Store, useSettingsStore } from "./stores";
import { useUIStore } from "./stores/uiStore";

import { useContextMenu } from "./composables/useContextMenu";
import { useMenuActions } from "./composables/useMenuActions";
import { useDragDrop } from "./composables/useDragDrop";
import { useTauriEvents } from "./composables/useTauriEvents";
import { useGlobalEvents } from "./composables/useGlobalEvents";
import { useTheme } from "./composables/useTheme";
import { useWindowDrag } from "./composables/useWindowDrag";
import { useConfirmDialog } from "./composables/useConfirmDialog";
import { getPluginManager } from "./plugins";

import "./styles/themes.css";

const store = Store();
const settingsStore = useSettingsStore();
const uiStore = useUIStore();
const router = useRouter();

const {
    theme,
    windowEffectsEnabled,
    showGuideOnStartup,
    cornerHotspotEnabled,
    cornerHotspotPosition,
    cornerHotspotSensitivity,
} = storeToRefs(settingsStore);

const {
    categoryCols,
    launcherCols,
    homeSectionLayouts,
} = storeToRefs(uiStore);

const {
    currentCategoryId,
    currentLauncherItemId,
    currentHomeSection,
    openContextMenu,
    closeContextMenu,
    getDropTargetInfoAtPoint,
} = useContextMenu();

const { initializeDragDrop, lastDrop, processedDropIds } = useDragDrop({
    getDropTargetInfoAtPoint,
});

const { state: confirmState, confirm, handleConfirm, handleCancel } = useConfirmDialog();

const { onMenuAction } = useMenuActions({
    currentCategoryId,
    currentLauncherItemId,
    currentHomeSection,
    lastDrop,
    processedDropIds,
    closeContextMenu,
    confirm,
});

const { initializeTauriEvents, cleanupTauriEvents } = useTauriEvents();

const { initializeGlobalEvents, cleanupGlobalEvents } = useGlobalEvents({
    closeContextMenu,
});

const {
    applyTheme,
    applyEffectsDisabled,
    watchThemeChanges,
    cleanupThemeWatcher,
} = useTheme();

const { initializeWindowDrag, cleanupWindowDrag } = useWindowDrag();

const isCurrentItemPinned = computed(() => {
    if (!currentLauncherItemId.value) return false;
    return store.isItemPinned(currentLauncherItemId.value);
});

const hasCurrentItemCustomIcon = computed(() => {
    if (!currentCategoryId.value || !currentLauncherItemId.value) return false;
    return store.hasCustomIcon(currentCategoryId.value, currentLauncherItemId.value);
});

onMounted(async () => {
    await settingsStore.hydrateAppSettings();
    await settingsStore.refreshAutostartStatus();

    const pluginManager = getPluginManager();
    await pluginManager.refreshPlugins();

    if (showGuideOnStartup.value) {
        router.push("/guide");
    }

    initializeGlobalEvents();
    initializeDragDrop();
    await initializeTauriEvents();
    initializeWindowDrag();

    applyTheme(theme.value);
    applyEffectsDisabled(!windowEffectsEnabled.value);
    watchThemeChanges();

    safeInvoke('set_corner_hotspot_config', {
        enabled: cornerHotspotEnabled.value,
        position: cornerHotspotPosition.value,
        sensitivity: cornerHotspotSensitivity.value,
    });

    const isAutostart = await invoke<boolean>("check_is_autostart_launch");
    if (!isAutostart) {
        try {
            await getCurrentWindow().show();
        } catch (e) {
            console.error("Failed to show window:", e);
        }
    }
});

onBeforeUnmount(() => {
    cleanupGlobalEvents();
    cleanupTauriEvents();
    cleanupWindowDrag();
    cleanupThemeWatcher();
});
</script>

<template>
    <main class="main" @contextmenu="openContextMenu">
        <router-view></router-view>
    </main>
    <ContextMenu
        :current-item-id="currentLauncherItemId || undefined"
        :current-category-id="currentCategoryId || undefined"
        :is-current-item-favorite="isCurrentItemPinned"
        :has-custom-icon-prop="hasCurrentItemCustomIcon"
        :category-cols="categoryCols"
        :launcher-cols="launcherCols"
        :current-home-section="currentHomeSection || undefined"
        :pinned-layout-preset="homeSectionLayouts.pinned.preset"
        :recent-layout-preset="homeSectionLayouts.recent.preset"
        @action="onMenuAction"
    />
    <ConfirmDialog
        :visible="confirmState.visible"
        :title="confirmState.title"
        :message="confirmState.message"
        :confirm-text="confirmState.confirmText"
        :cancel-text="confirmState.cancelText"
        @confirm="handleConfirm"
        @cancel="handleCancel"
    />
</template>

<style lang="scss" scoped>
.main {
    width: 100vw;
    height: 100vh;
    overflow: hidden;
}
</style>

<style>
body {
    margin: 0;
    width: 100vw;
    height: 100vh;
}
</style>
