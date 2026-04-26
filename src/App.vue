<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, defineAsyncComponent } from "vue";
import { storeToRefs } from "pinia";
import { invoke } from "@tauri-apps/api/core";
import { safeInvoke, setPageUnloading } from "./utils/invoke-wrapper";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useRouter } from "vue-router";
import { showToast } from "./composables/useGlobalToast";


import ContextMenu from "./components/contextMenu.vue";
import ConfirmDialog from "./components/common/ConfirmDialog.vue";
import InputDialog from "./components/common/InputDialog.vue";
import GlobalToast from "./components/common/GlobalToast.vue";
import FocusIndicator from "./components/common/FocusIndicator.vue";
const OnboardingGuide = defineAsyncComponent(() => import("./components/OnboardingGuide.vue"));
import { Store, useCategoryStore, useSettingsStore, useGuideStore } from "./stores";
import { useUIStore } from "./stores/uiStore";
import { initOverrideLookupFromStore } from "./utils/classification/pipeline";

import { useContextMenu } from "./composables/useContextMenu";
import { useMenuActions } from "./composables/useMenuActions";
import { useDragDrop } from "./composables/useDragDrop";
import { useTauriEvents } from "./composables/useTauriEvents";
import { useGlobalEvents } from "./composables/useGlobalEvents";
import { useTheme } from "./composables/useTheme";
import { useWindowDrag } from "./composables/useWindowDrag";
import { useConfirmDialog } from "./composables/useConfirmDialog";
import { useInputDialog } from "./composables/useInputDialog";
import { useWindowPosition } from "./composables/useWindowPosition";
import { getPluginManager } from "./plugins";

import "./styles/themes.css";

const store = Store();
const categoryStore = useCategoryStore();
const settingsStore = useSettingsStore();
const uiStore = useUIStore();
const guideStore = useGuideStore();
const router = useRouter();
const isDev = import.meta.env.DEV;

const {
    theme,
    windowEffectsEnabled,
    performanceMode,
    showGuideOnStartup,
    followMouseOnShow,
} = storeToRefs(settingsStore);

const {
    categoryCols,
    launcherCols,
    categorySortMode,
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
const { state: inputState, input, handleConfirm: handleInputConfirm, handleCancel: handleInputCancel } = useInputDialog();

const { onMenuAction } = useMenuActions({
    currentCategoryId,
    currentLauncherItemId,
    currentHomeSection,
    lastDrop,
    processedDropIds,
    closeContextMenu,
    confirm,
    inputDialog: input,
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

const {
    saveWindowPosition,
    restoreWindowPosition,
    initializePositionTracking,
    cleanupPositionTracking,
} = useWindowPosition();

const isCurrentItemPinned = computed(() => {
    if (!currentLauncherItemId.value) return false;
    return store.isItemPinned(currentLauncherItemId.value);
});

const hasCurrentItemCustomIcon = computed(() => {
    if (!currentCategoryId.value || !currentLauncherItemId.value) return false;
    return store.hasCustomIcon(currentCategoryId.value, currentLauncherItemId.value);
});

const hasCurrentCategoryCustomIcon = computed(() => {
    if (!currentCategoryId.value) return false;
    return !!categoryStore.getCategoryById(currentCategoryId.value)?.customIconBase64;
});

const hasLauncherItems = computed(() =>
    Object.values(store.launcherItemsByCategoryId).some((items) => items.length > 0)
);

onMounted(async () => {
    initOverrideLookupFromStore();

    await settingsStore.hydratePersistedConfig();
    await settingsStore.refreshAutostartStatus();

    const pluginManager = getPluginManager();
    await pluginManager.refreshPlugins();

    const windowEffectResult = await settingsStore.applyCurrentWindowEffectState();
    if (windowEffectResult.changed && windowEffectResult.message) {
        showToast(windowEffectResult.message, { type: "info", duration: 5000 });
    }

    if (showGuideOnStartup.value && !guideStore.hasSeenOnboarding && !hasLauncherItems.value) {
        await router.replace("/ai-organizer");
    } else if (showGuideOnStartup.value && !guideStore.hasSeenOnboarding) {
        guideStore.startOnboarding();
    }

    initializeGlobalEvents();
    initializeDragDrop();
    await initializeTauriEvents();
    initializeWindowDrag();
    await initializePositionTracking();

    applyTheme(theme.value);
    applyEffectsDisabled(!windowEffectsEnabled.value);
    watchThemeChanges();

    const isAutostart = await invoke<boolean>("check_is_autostart_launch");
    if (!isAutostart) {
        try {
            const win = getCurrentWindow();
            const restored = await restoreWindowPosition();
            if (restored) {
                await win.show();
                await win.setFocus();
            } else {
                if (followMouseOnShow.value) {
                    await safeInvoke("show_window_with_follow_mouse");
                } else {
                    await win.show();
                    await win.setFocus();
                }
            }
        } catch (e) {
            console.error("Failed to show window:", e);
        }
    }
});

onBeforeUnmount(async () => {
    setPageUnloading(true);
    await saveWindowPosition();
    cleanupPositionTracking();
    cleanupGlobalEvents();
    cleanupTauriEvents();
    cleanupWindowDrag();
    cleanupThemeWatcher();
});
</script>

<template>
    <main class="main" :style="{ '--performance-mode': performanceMode ? 1 : 0 }" @contextmenu="openContextMenu">
        <router-view></router-view>
    </main>
    <ContextMenu
        :current-item-id="currentLauncherItemId || undefined"
        :current-category-id="currentCategoryId || undefined"
        :is-current-item-favorite="isCurrentItemPinned"
        :has-custom-icon-prop="hasCurrentItemCustomIcon"
        :has-current-category-custom-icon="hasCurrentCategoryCustomIcon"
        :category-cols="categoryCols"
        :launcher-cols="launcherCols"
        :current-category-sort-mode="categorySortMode"
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
    <InputDialog
        :visible="inputState.visible"
        :title="inputState.title"
        :message="inputState.message"
        :confirm-text="inputState.confirmText"
        :cancel-text="inputState.cancelText"
        :default-value="inputState.defaultValue"
        :placeholder="inputState.placeholder"
        :input-type="inputState.inputType"
        :second-input-label="inputState.secondInputLabel"
        :second-input-placeholder="inputState.secondInputPlaceholder"
        :second-input-type="inputState.secondInputType"
        :second-default-value="inputState.secondDefaultValue"
        @confirm="handleInputConfirm"
        @cancel="handleInputCancel"
    />
    <GlobalToast />
    <OnboardingGuide />
    <FocusIndicator v-if="isDev" />
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
