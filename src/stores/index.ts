export { useClipboardStore, type ClipboardRecord } from "./clipboardStore";
export { useSettingsStore, type ThemeMode, type AutostartType, type AutostartStatus } from "./settingsStore";
export {
    useUIStore,
    enumContextMenuType,
    HOME_LAYOUT_PRESETS,
    type HomeLayoutSectionKey,
    type HomeLayoutPresetKey,
    type HomeSectionLayout,
    type HomeSectionLayouts,
} from "./uiStore";
export { useCategoryStore, type Category } from "./categoryStore";
export {
    useLauncherStore,
    type LauncherItem,
    type GlobalSearchResult,
    type GlobalSearchMergedResult,
    type RecentUsedItem,
    type RecentUsedMergedItem,
    type PinnedMergedItem,
} from "./launcherStore";

import { useLauncherStore } from "./launcherStore";

export const Store = useLauncherStore;
