/**
 * Display / layout domain actions: cols, sort mode, home layout presets.
 */
import type {
    DisplayActions,
    HomeLayoutPresetKey,
    HomeLayoutSectionKey,
    MenuActionDeps,
} from "./types";

export function createDisplayActions(deps: MenuActionDeps): DisplayActions {
    const { uiStore, lastAction, closeContextMenu } = deps;

    function onSetCategoryCols(cols: number) {
        uiStore.setCategoryCols(cols);
        lastAction.value = `分类图标：${cols}`;
        closeContextMenu();
    }

    function onSetLauncherCols(cols: number) {
        uiStore.setLauncherCols(cols);
        lastAction.value = `启动项图标：${cols}`;
        closeContextMenu();
    }

    function onSetCategorySortMode(mode: "manual" | "smart") {
        uiStore.setCategorySortMode(mode);
        lastAction.value = mode === "smart" ? "分类排序：智能排序" : "分类排序：手动排序";
        closeContextMenu();
    }

    function onSetHomeLayoutPreset(
        section: HomeLayoutSectionKey,
        preset: HomeLayoutPresetKey
    ) {
        uiStore.setHomeSectionLayoutPreset(section, preset);
        closeContextMenu();
    }

    return {
        onSetCategoryCols,
        onSetLauncherCols,
        onSetCategorySortMode,
        onSetHomeLayoutPreset,
    };
}
