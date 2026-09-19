<script setup lang="ts">
import { computed, defineAsyncComponent } from "vue";
import { storeToRefs } from "pinia";

import ContextMenu from "./components/contextMenu.vue";
import ConfirmDialog from "./components/common/ConfirmDialog.vue";
import InputDialog from "./components/common/InputDialog.vue";
import GlobalToast from "./components/common/GlobalToast.vue";
import FocusIndicator from "./components/common/FocusIndicator.vue";
import CountdownRing from "./components/common/CountdownRing.vue";
const OnboardingGuide = defineAsyncComponent(() => import("./components/OnboardingGuide.vue"));
// PERF-A: UpdateDialog is not needed for first paint; marked loads inside it on open.
const UpdateDialog = defineAsyncComponent(() => import("./components/UpdateDialog.vue"));

import { Store, useCategoryStore, useSettingsStore } from "./stores";
import { useUIStore } from "./stores/uiStore";

import { useContextMenu } from "./composables/useContextMenu";
import { useMenuActions } from "./composables/useMenuActions";
import { useDragDrop } from "./composables/useDragDrop";
import { useConfirmDialog } from "./composables/useConfirmDialog";
import { useInputDialog } from "./composables/useInputDialog";
import { useAutoHideCountdown } from "./composables/useAutoHideCountdown";
import { appIsTransitioning } from "./kernel/runtime/ui-shell-state";

import "./styles/themes.scss";

const store = Store();
const categoryStore = useCategoryStore();
const settingsStore = useSettingsStore();
const uiStore = useUIStore();
const isDev = import.meta.env.DEV;

const isTransitioning = appIsTransitioning;

const {
    performanceMode,
    autoHideCountdownSeconds,
    autoHideEnabled,
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
    currentItemPath,
    currentClipboardRecordId,
    currentClipboardContentType,
    currentHomeSection,
    openContextMenu,
    closeContextMenu,
} = useContextMenu();

const { lastDrop, processedDropIds } = useDragDrop();

const { state: confirmState, confirm, handleConfirm, handleCancel, handleDismiss } = useConfirmDialog();
const { state: inputState, input, handleConfirm: handleInputConfirm, handleCancel: handleInputCancel } = useInputDialog();

const { onMenuAction } = useMenuActions({
    currentCategoryId,
    currentLauncherItemId,
    currentItemPath,
    currentClipboardRecordId,
    currentClipboardContentType,
    currentHomeSection,
    lastDrop,
    processedDropIds,
    closeContextMenu,
    confirm,
    inputDialog: input,
});

const {
    isCountingDown,
    handleCountdownComplete,
} = useAutoHideCountdown({
    autoHideEnabled,
    countdownSeconds: autoHideCountdownSeconds,
});

function onStartExternalConvertDrag(payload: {
    itemPath: string;
    clientX: number;
    clientY: number;
}) {
    if (!payload.itemPath?.trim()) return;
    window.dispatchEvent(
        new CustomEvent("external-convert-drag-start", {
            detail: {
                itemPath: payload.itemPath.trim(),
                clientX: payload.clientX,
                clientY: payload.clientY,
            },
        })
    );
}

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
</script>

<template>
    <main class="main" :style="{ '--performance-mode': performanceMode ? 1 : 0, opacity: isTransitioning ? 0 : 1 }" @contextmenu="openContextMenu">
        <router-view></router-view>
    </main>
    <ContextMenu
        :current-item-id="currentLauncherItemId || undefined"
        :current-category-id="currentCategoryId || undefined"
        :current-item-path="currentItemPath || undefined"
        :current-clipboard-record-id="currentClipboardRecordId || undefined"
        :current-clipboard-content-type="currentClipboardContentType || undefined"
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
        @start-external-convert-drag="onStartExternalConvertDrag"
    />
    <ConfirmDialog
        :visible="confirmState.visible"
        :title="confirmState.title"
        :message="confirmState.message"
        :confirm-text="confirmState.confirmText"
        :cancel-text="confirmState.cancelText"
        @confirm="handleConfirm"
        @cancel="handleCancel"
        @dismiss="handleDismiss"
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
        :select-options="inputState.selectOptions"
        @confirm="handleInputConfirm"
        @cancel="handleInputCancel"
    />
    <GlobalToast />
    <CountdownRing
        v-if="isCountingDown"
        :countdown-seconds="autoHideCountdownSeconds"
        :is-visible="isCountingDown"
        @complete="handleCountdownComplete"
    />
    <OnboardingGuide />
    <FocusIndicator v-if="isDev" />
    <UpdateDialog />
</template>

<style lang="scss" scoped>
.main {
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    border-radius: calc(16px * var(--performance-mode, 0));
    box-shadow: inset 0 0 0 calc(2px * var(--performance-mode, 0)) var(--border-color-strong);
}
</style>

<style>
body {
    margin: 0;
    width: 100vw;
    height: 100vh;
}
</style>
