/**
 * @fileoverview useMenuActions 领域动作的共享类型与依赖上下文
 */
import type { Ref } from "vue";
import type { Router } from "vue-router";
import { Store, useCategoryStore, useClipboardStore, useUIStore } from "../../stores";
import { useStatsStore } from "../../stores/statsStore";
import type { ScenarioKey } from "../../stores/launcherStore";
import type { MenuAction, MenuContext } from "../../menus/contextMenuTypes";
import type { DropRecord } from "../types";
import type { useConfirmDialog } from "../useConfirmDialog";
import type { useInputDialog } from "../useInputDialog";
import type { HomeLayoutPresetKey, HomeLayoutSectionKey } from "../../stores/uiStore";
import type { ToastOptions } from "../useGlobalToast";

export type {
    HomeLayoutPresetKey,
    HomeLayoutSectionKey,
    MenuAction,
    MenuContext,
    ScenarioKey,
};

export type LauncherStoreInstance = ReturnType<typeof Store>;
export type CategoryStoreInstance = ReturnType<typeof useCategoryStore>;
export type ClipboardStoreInstance = ReturnType<typeof useClipboardStore>;
export type StatsStoreInstance = ReturnType<typeof useStatsStore>;
export type UIStoreInstance = ReturnType<typeof useUIStore>;

export interface UseMenuActionsOptions {
    currentCategoryId: Ref<string | null>;
    currentLauncherItemId: Ref<string | null>;
    currentItemPath: Ref<string | null>;
    currentClipboardRecordId: Ref<string | null>;
    currentClipboardContentType: Ref<"text" | "image" | null>;
    currentHomeSection: Ref<HomeLayoutSectionKey | null>;
    lastDrop: Ref<DropRecord | null>;
    processedDropIds: Set<string>;
    closeContextMenu: () => void;
    confirm: ReturnType<typeof useConfirmDialog>["confirm"];
    inputDialog: ReturnType<typeof useInputDialog>["input"];
}

/** Shared runtime deps passed into each domain action factory. */
export interface MenuActionDeps {
    options: UseMenuActionsOptions;
    store: LauncherStoreInstance;
    categoryStore: CategoryStoreInstance;
    clipboardStore: ClipboardStoreInstance;
    statsStore: StatsStoreInstance;
    uiStore: UIStoreInstance;
    router: Router;
    lastAction: Ref<string>;
    closeContextMenu: () => void;
    showToast: (message: string, opts?: ToastOptions) => void;
    menuInvoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
}

export interface AppsActions {
    onAddItem: () => Promise<void>;
    onAddUrlItem: () => Promise<void>;
    onEditItem: () => void;
    onDeleteItem: () => Promise<void>;
    onChangeIcon: (base64: string) => void;
    onResetIcon: () => void;
    onTogglePinned: () => void;
    onToggleScenarioMembership: (scenario: ScenarioKey) => void;
    onClearScenarioMembership: () => void;
}

export interface CategoryActions {
    onAddCategory: () => void;
    onDeleteCategory: () => Promise<void>;
    onRenameCategory: () => void;
    onChangeCategoryIcon: (base64: string) => void;
    onResetCategoryIcon: () => void;
}

export interface ClipboardActions {
    onCopyClipboardItem: () => Promise<void>;
    onLocateClipboardItem: () => Promise<void>;
    onDeleteClipboardItem: () => Promise<void>;
    onLocateClipboardItemInHistory: () => void;
}

export interface SystemActions {
    onHideWindow: () => Promise<void>;
    onOpenInExplorer: () => Promise<void>;
    onBlockExternalItem: () => void;
    onConvertExternalItem: () => Promise<void>;
    onOpenSettings: () => void;
    onOpenAbout: () => void;
}

export interface DisplayActions {
    onSetCategoryCols: (cols: number) => void;
    onSetLauncherCols: (cols: number) => void;
    onSetCategorySortMode: (mode: "manual" | "smart") => void;
    onSetHomeLayoutPreset: (
        section: HomeLayoutSectionKey,
        preset: HomeLayoutPresetKey
    ) => void;
}

export interface MenuActionsBundle {
    apps: AppsActions;
    category: CategoryActions;
    clipboard: ClipboardActions;
    system: SystemActions;
    display: DisplayActions;
    onMenuAction: (action: MenuAction, ctx: MenuContext) => Promise<void>;
}
