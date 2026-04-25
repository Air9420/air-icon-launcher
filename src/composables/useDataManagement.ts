import { open, save } from "@tauri-apps/plugin-dialog";
import { toRaw } from "vue";
import {
    Store,
    useCategoryStore,
    useClipboardStore,
    useSettingsStore,
    useUIStore,
    type Category,
    type LauncherItem,
    type RecentUsedItem,
    type ThemeMode,
} from "../stores";
import { invoke, invokeOrThrow } from "../utils/invoke-wrapper";
import {
    getAppConfig,
    saveAppConfig,
    type AppConfigSnapshot,
} from "../utils/config-sync";
import { getPluginManager } from "../plugins";

export type DataExportFormat = "json" | "zip";

export type DataExportOptions = {
    includeLauncherData: boolean;
    includeSettings: boolean;
    includePlugins: boolean;
    format: DataExportFormat;
};

export type BackupInfo = {
    filename: string;
    path: string;
    created_at: number;
    size: number;
};

type ImportedCategory = {
    id: string;
    name: string;
    custom_icon_base64?: string | null;
    items?: ImportedLauncherItem[];
};

type ImportedLauncherItem = {
    id: string;
    name: string;
    path?: string;
    url?: string;
    item_type?: 'file' | 'url';
    is_directory: boolean;
    icon_base64?: string | null;
    original_icon_base64?: string | null;
    is_favorite?: boolean;
    last_used_at?: number | null;
    launch_dependencies?: Array<{
        category_id: string;
        item_id: string;
        delay_after_seconds?: number | null;
    }>;
    launch_delay_seconds?: number | null;
};

type ImportedRecentUsedItem = {
    category_id: string;
    item_id: string;
    used_at: number;
    usage_count?: number;
};

type ImportedSettings = {
    theme?: "light" | "dark" | "transparent" | "system";
    category_cols?: number;
    launcher_cols?: number;
    toggle_shortcut?: string;
    clipboard_shortcut?: string;
    follow_mouse_on_show?: boolean;
    follow_mouse_y_anchor?: "top" | "center" | "bottom";
    ctrl_drag_enabled?: boolean;
    auto_hide_after_launch?: boolean;
    show_guide_on_startup?: boolean;
    hide_on_ctrl_right_click?: boolean;
    corner_hotspot_enabled?: boolean;
    corner_hotspot_position?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
    corner_hotspot_sensitivity?: "low" | "medium" | "high";
    performance_mode?: boolean;
    window_effect_type?: "blur" | "acrylic";
    strong_shortcut_mode?: boolean;
    plugin_sandbox_enabled?: boolean;
    clipboard_history_enabled?: boolean;
    home_section_layouts?: unknown;
    clipboard_max_records?: number;
    clipboard_max_image_size_mb?: number;
    clipboard_encrypted?: boolean;
    clipboard_storage_path?: string | null;
    backup_on_exit?: boolean;
    backup_frequency?: string;
    backup_retention?: number;
    ai_organizer_base_url?: string;
    ai_organizer_model?: string;
    ai_organizer_api_key?: string;
};

type ImportedLauncherData = {
    categories?: ImportedCategory[];
    favorite_item_ids?: string[];
    pinned_item_ids?: string[];
    recent_used_items?: ImportedRecentUsedItem[];
};

export type ImportedDataPayload = {
    settings?: ImportedSettings;
    launcher_data?: ImportedLauncherData;
};

type PersistedLauncherData = {
    version?: string;
    categories: ImportedCategory[];
    favorite_item_ids: string[];
    recent_used_items: ImportedRecentUsedItem[];
};

type ImportValidationResult = {
    valid: boolean;
    errors: string[];
};

export type ImportExecutionResult = {
    notices: string[];
};

type FrontendImportSnapshot = {
    settings: {
        theme: ThemeMode;
        categoryCols: number;
        launcherCols: number;
        homeSectionLayouts: unknown;
        toggleShortcut: string;
        clipboardShortcut: string;
        followMouseOnShow: boolean;
        followMouseYAnchor: "top" | "center" | "bottom";
        ctrlDragEnabled: boolean;
        autoHideAfterLaunch: boolean;
        showGuideOnStartup: boolean;
        hideOnCtrlRightClick: boolean;
        cornerHotspotEnabled: boolean;
        cornerHotspotPosition: "top-left" | "top-right" | "bottom-left" | "bottom-right";
        cornerHotspotSensitivity: "low" | "medium" | "high";
        performanceMode: boolean;
        windowEffectType: "blur" | "acrylic";
        strongShortcutMode: boolean;
        pluginSandboxEnabled: boolean;
        clipboardHistoryEnabled: boolean;
        clipboardMaxRecords: number;
    };
    categories: Category[];
    currentCategoryId: string | null;
    launcherItemsByCategoryId: Record<string, LauncherItem[]>;
    pinnedItemIds: string[];
    recentUsedItems: RecentUsedItem[];
};

type BackendImportSnapshot = {
    settings: AppConfigSnapshot;
    launcherData: PersistedLauncherData;
};

type ImportSnapshot = {
    frontend: FrontendImportSnapshot;
    backend: BackendImportSnapshot;
};

function cloneData<T>(value: T): T {
    const rawValue = toRaw(value);
    if (typeof globalThis.structuredClone === "function") {
        try {
            return globalThis.structuredClone(rawValue);
        } catch {}
    }
    return JSON.parse(JSON.stringify(rawValue)) as T;
}

function toErrorMessage(error: unknown): string {
    if (typeof error === "string") return error;
    if (error instanceof Error && error.message) return error.message;
    return String(error);
}

function buildValidationError(errors: string[]): Error {
    return new Error(`导入数据校验失败：${errors.join("；")}`);
}

function appendImportNotice(notices: Set<string>, message?: string) {
    const normalized = message?.trim();
    if (normalized) {
        notices.add(normalized);
    }
}

function buildImportedItemReferenceIndex(categories: ImportedCategory[]) {
    const itemIds = new Set<string>();
    const itemRefs = new Set<string>();

    categories.forEach((category) => {
        if (!category?.id?.trim()) return;

        (category.items || []).forEach((item) => {
            if (!item?.id?.trim()) return;
            itemIds.add(item.id);
            itemRefs.add(`${category.id}:${item.id}`);
        });
    });

    return {
        itemIds,
        itemRefs,
    };
}

function filterImportedPinnedIds(itemIds: Set<string>, pinnedIds: string[]): string[] {
    return [...new Set(pinnedIds.filter((itemId) => itemIds.has(itemId)))];
}

function filterImportedRecentUsedItems(
    itemRefs: Set<string>,
    recentUsedItems: ImportedRecentUsedItem[]
): ImportedRecentUsedItem[] {
    return recentUsedItems.filter((item) => {
        if (!item?.category_id?.trim() || !item?.item_id?.trim()) {
            return false;
        }
        return itemRefs.has(`${item.category_id}:${item.item_id}`);
    });
}

function buildExportItemReferenceIndex(
    categories: Category[],
    launcherItemsByCategoryId: Record<string, LauncherItem[]>
) {
    const itemIds = new Set<string>();
    const itemRefs = new Set<string>();

    categories.forEach((category) => {
        (launcherItemsByCategoryId[category.id] || []).forEach((item) => {
            if (!item?.id?.trim()) return;
            itemIds.add(item.id);
            itemRefs.add(`${category.id}:${item.id}`);
        });
    });

    return {
        itemIds,
        itemRefs,
    };
}

export function validateImportedData(result: ImportedDataPayload): ImportValidationResult {
    const errors: string[] = [];
    const settings = result.settings;
    const launcherData = result.launcher_data;

    if (settings) {
        const allowedThemes = new Set(["light", "dark", "transparent", "system"]);
        const allowedAnchors = new Set(["top", "center", "bottom"]);
        const allowedWindowEffects = new Set(["blur", "acrylic"]);
        const allowedCornerPositions = new Set([
            "top-left",
            "top-right",
            "bottom-left",
            "bottom-right",
        ]);
        const allowedCornerSensitivity = new Set(["low", "medium", "high"]);

        if (settings.theme !== undefined && !allowedThemes.has(settings.theme)) {
            errors.push(`settings.theme 非法: ${String(settings.theme)}`);
        }
        if (settings.category_cols !== undefined && !Number.isFinite(settings.category_cols)) {
            errors.push("settings.category_cols 必须是数字");
        }
        if (settings.launcher_cols !== undefined && !Number.isFinite(settings.launcher_cols)) {
            errors.push("settings.launcher_cols 必须是数字");
        }
        if (settings.toggle_shortcut !== undefined) {
            if (typeof settings.toggle_shortcut !== "string" || !settings.toggle_shortcut.trim()) {
                errors.push("settings.toggle_shortcut 必须是非空字符串");
            }
        }
        if (settings.clipboard_shortcut !== undefined) {
            if (typeof settings.clipboard_shortcut !== "string" || !settings.clipboard_shortcut.trim()) {
                errors.push("settings.clipboard_shortcut 必须是非空字符串");
            }
        }
        if (
            settings.follow_mouse_on_show !== undefined &&
            typeof settings.follow_mouse_on_show !== "boolean"
        ) {
            errors.push("settings.follow_mouse_on_show 必须是布尔值");
        }
        if (
            settings.follow_mouse_y_anchor !== undefined &&
            !allowedAnchors.has(settings.follow_mouse_y_anchor)
        ) {
            errors.push(`settings.follow_mouse_y_anchor 非法: ${String(settings.follow_mouse_y_anchor)}`);
        }
        if (
            settings.ctrl_drag_enabled !== undefined &&
            typeof settings.ctrl_drag_enabled !== "boolean"
        ) {
            errors.push("settings.ctrl_drag_enabled 必须是布尔值");
        }
        if (
            settings.auto_hide_after_launch !== undefined &&
            typeof settings.auto_hide_after_launch !== "boolean"
        ) {
            errors.push("settings.auto_hide_after_launch 必须是布尔值");
        }
        if (
            settings.show_guide_on_startup !== undefined &&
            typeof settings.show_guide_on_startup !== "boolean"
        ) {
            errors.push("settings.show_guide_on_startup 必须是布尔值");
        }
        if (
            settings.hide_on_ctrl_right_click !== undefined &&
            typeof settings.hide_on_ctrl_right_click !== "boolean"
        ) {
            errors.push("settings.hide_on_ctrl_right_click 必须是布尔值");
        }
        if (
            settings.corner_hotspot_enabled !== undefined &&
            typeof settings.corner_hotspot_enabled !== "boolean"
        ) {
            errors.push("settings.corner_hotspot_enabled 必须是布尔值");
        }
        if (
            settings.corner_hotspot_position !== undefined &&
            !allowedCornerPositions.has(settings.corner_hotspot_position)
        ) {
            errors.push(`settings.corner_hotspot_position 非法: ${String(settings.corner_hotspot_position)}`);
        }
        if (
            settings.corner_hotspot_sensitivity !== undefined &&
            !allowedCornerSensitivity.has(settings.corner_hotspot_sensitivity)
        ) {
            errors.push(`settings.corner_hotspot_sensitivity 非法: ${String(settings.corner_hotspot_sensitivity)}`);
        }
        if (
            settings.performance_mode !== undefined &&
            typeof settings.performance_mode !== "boolean"
        ) {
            errors.push("settings.performance_mode 必须是布尔值");
        }
        if (
            settings.window_effect_type !== undefined &&
            !allowedWindowEffects.has(settings.window_effect_type)
        ) {
            errors.push(`settings.window_effect_type 非法: ${String(settings.window_effect_type)}`);
        }
        if (
            settings.strong_shortcut_mode !== undefined &&
            typeof settings.strong_shortcut_mode !== "boolean"
        ) {
            errors.push("settings.strong_shortcut_mode 必须是布尔值");
        }
        if (
            settings.clipboard_history_enabled !== undefined &&
            typeof settings.clipboard_history_enabled !== "boolean"
        ) {
            errors.push("settings.clipboard_history_enabled 必须是布尔值");
        }
        if (
            settings.clipboard_max_records !== undefined &&
            (!Number.isFinite(settings.clipboard_max_records) || settings.clipboard_max_records < 0)
        ) {
            errors.push("settings.clipboard_max_records 必须是大于等于 0 的数字");
        }
        if (
            settings.clipboard_max_image_size_mb !== undefined &&
            (!Number.isFinite(settings.clipboard_max_image_size_mb) || settings.clipboard_max_image_size_mb < 0)
        ) {
            errors.push("settings.clipboard_max_image_size_mb 必须是大于等于 0 的数字");
        }
        if (
            settings.clipboard_encrypted !== undefined &&
            typeof settings.clipboard_encrypted !== "boolean"
        ) {
            errors.push("settings.clipboard_encrypted 必须是布尔值");
        }
        if (
            settings.clipboard_storage_path !== undefined &&
            settings.clipboard_storage_path !== null &&
            typeof settings.clipboard_storage_path !== "string"
        ) {
            errors.push("settings.clipboard_storage_path 必须是字符串或 null");
        }
    }

    if (launcherData) {
        if (launcherData.categories !== undefined && !Array.isArray(launcherData.categories)) {
            errors.push("launcher_data.categories 必须是数组");
        }
        if (
            launcherData.favorite_item_ids !== undefined &&
            !Array.isArray(launcherData.favorite_item_ids)
        ) {
            errors.push("launcher_data.favorite_item_ids 必须是数组");
        }
        if (
            launcherData.pinned_item_ids !== undefined &&
            !Array.isArray(launcherData.pinned_item_ids)
        ) {
            errors.push("launcher_data.pinned_item_ids 必须是数组");
        }
        if (
            launcherData.recent_used_items !== undefined &&
            !Array.isArray(launcherData.recent_used_items)
        ) {
            errors.push("launcher_data.recent_used_items 必须是数组");
        }

        const categories = Array.isArray(launcherData.categories) ? launcherData.categories : [];

        categories.forEach((category, categoryIndex) => {
            if (!category?.id?.trim()) {
                errors.push(`launcher_data.categories[${categoryIndex}] 缺少有效 id`);
            }
            if (!category?.name?.trim()) {
                errors.push(`launcher_data.categories[${categoryIndex}] 缺少有效 name`);
            }

            if (category?.items !== undefined && !Array.isArray(category.items)) {
                errors.push(`launcher_data.categories[${categoryIndex}].items 必须是数组`);
                return;
            }

            (category.items || []).forEach((item, itemIndex) => {
                if (!item?.id?.trim()) {
                    errors.push(
                        `launcher_data.categories[${categoryIndex}].items[${itemIndex}] 缺少有效 id`
                    );
                }
                if (!item?.name?.trim()) {
                    errors.push(
                        `launcher_data.categories[${categoryIndex}].items[${itemIndex}] 缺少有效 name`
                    );
                }
                if (
                    item?.item_type !== undefined &&
                    item.item_type !== "file" &&
                    item.item_type !== "url"
                ) {
                    errors.push(
                        `launcher_data.categories[${categoryIndex}].items[${itemIndex}].item_type 非法`
                    );
                }
                if (typeof item?.is_directory !== "boolean") {
                    errors.push(
                        `launcher_data.categories[${categoryIndex}].items[${itemIndex}].is_directory 必须是布尔值`
                    );
                }

                (item.launch_dependencies || []).forEach((dependency, dependencyIndex) => {
                    if (!dependency?.category_id?.trim() || !dependency?.item_id?.trim()) {
                        errors.push(
                            `launcher_data.categories[${categoryIndex}].items[${itemIndex}].launch_dependencies[${dependencyIndex}] 引用无效`
                        );
                    }
                });
            });
        });

        const { itemRefs } = buildImportedItemReferenceIndex(categories);

        (launcherData.favorite_item_ids || []).forEach((itemId, index) => {
            if (typeof itemId !== "string" || !itemId.trim()) {
                errors.push(`launcher_data.favorite_item_ids[${index}] 必须是非空字符串`);
            }
        });

        (launcherData.pinned_item_ids || []).forEach((itemId, index) => {
            if (typeof itemId !== "string" || !itemId.trim()) {
                errors.push(`launcher_data.pinned_item_ids[${index}] 必须是非空字符串`);
            }
        });

        (launcherData.recent_used_items || []).forEach((item, index) => {
            if (!item?.category_id?.trim() || !item?.item_id?.trim()) {
                errors.push(`launcher_data.recent_used_items[${index}] 引用无效`);
            }
            if (!Number.isFinite(item?.used_at)) {
                errors.push(`launcher_data.recent_used_items[${index}].used_at 必须是数字`);
            }
            if (
                item?.usage_count !== undefined &&
                (!Number.isFinite(item.usage_count) || item.usage_count < 1)
            ) {
                errors.push(
                    `launcher_data.recent_used_items[${index}].usage_count 必须是大于等于 1 的数字`
                );
            }
        });

        categories.forEach((category, categoryIndex) => {
            (category.items || []).forEach((item, itemIndex) => {
                (item.launch_dependencies || []).forEach((dependency, dependencyIndex) => {
                    const key = `${dependency.category_id}:${dependency.item_id}`;
                    if (!itemRefs.has(key)) {
                        errors.push(
                            `launcher_data.categories[${categoryIndex}].items[${itemIndex}].launch_dependencies[${dependencyIndex}] 引用不存在: ${key}`
                        );
                    }
                });
            });
        });
    }

    return {
        valid: errors.length === 0,
        errors,
    };
}

function formatLocalDateForFilename(date: Date) {
    const pad2 = (n: number) => String(n).padStart(2, "0");
    const y = date.getFullYear();
    const m = pad2(date.getMonth() + 1);
    const d = pad2(date.getDate());
    return `${y}-${m}-${d}`;
}

export function mapImportedLauncherItems(
    categories: ImportedCategory[]
): Record<string, LauncherItem[]> {
    const itemsMap: Record<string, LauncherItem[]> = {};
    for (const category of categories) {
        itemsMap[category.id] = (category.items || []).map((item) => ({
            id: item.id,
            name: item.name,
            path: item.path || '',
            url: item.url,
            itemType: item.item_type || 'file',
            isDirectory: item.is_directory,
            iconBase64: item.icon_base64 ?? null,
            originalIconBase64: item.original_icon_base64 ?? null,
            isFavorite: item.is_favorite,
            lastUsedAt: item.last_used_at ?? undefined,
            launchDependencies: (item.launch_dependencies || [])
                .filter((dependency) => dependency.category_id && dependency.item_id)
                .map((dependency) => ({
                    categoryId: dependency.category_id,
                    itemId: dependency.item_id,
                    delayAfterSeconds: Math.max(0, Math.floor(dependency.delay_after_seconds ?? 0)),
                })),
            launchDelaySeconds: Math.max(0, Math.floor(item.launch_delay_seconds ?? 0)),
        }));
    }
    return itemsMap;
}

export function buildLauncherExportData(
    categories: Category[],
    launcherItemsByCategoryId: Record<string, LauncherItem[]>,
    pinnedItemIds: string[],
    recentUsedItems: RecentUsedItem[]
) {
    const { itemIds, itemRefs } = buildExportItemReferenceIndex(
        categories,
        launcherItemsByCategoryId
    );

    return {
        version: "1.0",
        categories: categories.map((category) => ({
            id: category.id,
            name: category.name,
            custom_icon_base64: category.customIconBase64,
            items: (launcherItemsByCategoryId[category.id] || []).map((item) => ({
                id: item.id,
                name: item.name,
                path: item.path,
                url: item.url,
                item_type: item.itemType,
                is_directory: item.isDirectory,
                icon_base64: item.iconBase64,
                original_icon_base64: item.originalIconBase64,
                is_favorite: item.isFavorite || false,
                last_used_at: item.lastUsedAt || null,
                launch_dependencies: item.launchDependencies.map((dependency) => ({
                    category_id: dependency.categoryId,
                    item_id: dependency.itemId,
                    delay_after_seconds: dependency.delayAfterSeconds,
                })),
                launch_delay_seconds: item.launchDelaySeconds,
            })),
        })),
        favorite_item_ids: filterImportedPinnedIds(itemIds, pinnedItemIds),
        recent_used_items: recentUsedItems
            .filter((item) => itemRefs.has(`${item.categoryId}:${item.itemId}`))
            .map((item) => ({
                category_id: item.categoryId,
                item_id: item.itemId,
                used_at: item.usedAt,
                usage_count: item.usageCount,
            })),
    };
}

export function useDataManagement() {
    const store = Store();
    const settingsStore = useSettingsStore();
    const uiStore = useUIStore();
    const categoryStore = useCategoryStore();
    const clipboardStore = useClipboardStore();

    async function snapshotFrontendState(): Promise<FrontendImportSnapshot> {
        const pluginManager = getPluginManager();
        return {
            settings: {
                theme: settingsStore.theme,
                categoryCols: uiStore.categoryCols,
                launcherCols: uiStore.launcherCols,
                homeSectionLayouts: cloneData(uiStore.homeSectionLayouts),
                toggleShortcut: settingsStore.toggleShortcut,
                clipboardShortcut: settingsStore.clipboardShortcut,
                followMouseOnShow: settingsStore.followMouseOnShow,
                followMouseYAnchor: settingsStore.followMouseYAnchor,
                ctrlDragEnabled: settingsStore.ctrlDragEnabled,
                autoHideAfterLaunch: settingsStore.autoHideAfterLaunch,
                showGuideOnStartup: settingsStore.showGuideOnStartup,
                hideOnCtrlRightClick: settingsStore.hideOnCtrlRightClick,
                cornerHotspotEnabled: settingsStore.cornerHotspotEnabled,
                cornerHotspotPosition: settingsStore.cornerHotspotPosition,
                cornerHotspotSensitivity: settingsStore.cornerHotspotSensitivity,
                performanceMode: settingsStore.performanceMode,
                windowEffectType: settingsStore.windowEffectType,
                strongShortcutMode: settingsStore.strongShortcutMode,
                pluginSandboxEnabled: await pluginManager.loadSandboxMode(),
                clipboardHistoryEnabled: clipboardStore.clipboardHistoryEnabled,
                clipboardMaxRecords: clipboardStore.maxRecords,
            },
            categories: cloneData(categoryStore.categories),
            currentCategoryId: categoryStore.currentCategoryId,
            launcherItemsByCategoryId: cloneData(store.launcherItemsByCategoryId),
            pinnedItemIds: cloneData(store.pinnedItemIds),
            recentUsedItems: cloneData(store.recentUsedItems),
        };
    }

    async function snapshotBackendState(): Promise<BackendImportSnapshot> {
        return {
            settings: cloneData(await getAppConfig()),
            launcherData: cloneData(
                await invokeOrThrow<PersistedLauncherData>("get_launcher_data")
            ),
        };
    }

    async function snapshotCurrentState(): Promise<ImportSnapshot> {
        return {
            frontend: await snapshotFrontendState(),
            backend: await snapshotBackendState(),
        };
    }

    async function applyImportedWindowEffectSettings(
        config: Pick<ImportedSettings, "performance_mode" | "window_effect_type">,
        notices: Set<string>
    ) {
        if (typeof config.performance_mode === "boolean") {
            if (config.performance_mode) {
                if (config.window_effect_type) {
                    await settingsStore.setWindowEffectType(config.window_effect_type, {
                        applyRuntime: false,
                    });
                }
                const result = await settingsStore.setPerformanceMode(true);
                appendImportNotice(notices, result.message);
                return;
            }

            if (config.window_effect_type) {
                const result = await settingsStore.setWindowEffectType(config.window_effect_type);
                appendImportNotice(notices, result.message);
                return;
            }

            const result = await settingsStore.setPerformanceMode(false);
            appendImportNotice(notices, result.message);
            return;
        }

        if (config.window_effect_type) {
            const result = await settingsStore.setWindowEffectType(config.window_effect_type);
            appendImportNotice(notices, result.message);
        }
    }

    async function restoreFrontendState(
        snapshot: FrontendImportSnapshot
    ): Promise<ImportExecutionResult> {
        const notices = new Set<string>();
        const pluginManager = getPluginManager();

        await settingsStore.setTheme(snapshot.settings.theme);
        uiStore.setCategoryCols(snapshot.settings.categoryCols);
        uiStore.setLauncherCols(snapshot.settings.launcherCols);
        uiStore.setHomeSectionLayouts(snapshot.settings.homeSectionLayouts);
        await settingsStore.setToggleShortcut(snapshot.settings.toggleShortcut);
        await settingsStore.setClipboardShortcut(snapshot.settings.clipboardShortcut);
        await settingsStore.setFollowMouseOnShow(snapshot.settings.followMouseOnShow);
        await settingsStore.setFollowMouseYAnchor(snapshot.settings.followMouseYAnchor);
        await settingsStore.setCtrlDragEnabled(snapshot.settings.ctrlDragEnabled);
        await settingsStore.setAutoHideAfterLaunch(snapshot.settings.autoHideAfterLaunch);
        await settingsStore.setShowGuideOnStartup(snapshot.settings.showGuideOnStartup);
        await settingsStore.setHideOnCtrlRightClick(snapshot.settings.hideOnCtrlRightClick);
        await settingsStore.setCornerHotspotPosition(snapshot.settings.cornerHotspotPosition);
        await settingsStore.setCornerHotspotSensitivity(snapshot.settings.cornerHotspotSensitivity);
        await settingsStore.setCornerHotspotEnabled(snapshot.settings.cornerHotspotEnabled);
        await applyImportedWindowEffectSettings(
            {
                performance_mode: snapshot.settings.performanceMode,
                window_effect_type: snapshot.settings.windowEffectType,
            },
            notices
        );
        await settingsStore.setStrongShortcutMode(snapshot.settings.strongShortcutMode);
        await pluginManager.setSandboxMode(snapshot.settings.pluginSandboxEnabled);
        clipboardStore.setClipboardHistoryEnabled(snapshot.settings.clipboardHistoryEnabled);
        clipboardStore.setMaxRecords(snapshot.settings.clipboardMaxRecords);
        categoryStore.importCategories(snapshot.categories);
        categoryStore.setCurrentCategory(snapshot.currentCategoryId);
        store.importLauncherSnapshot({
            items: snapshot.launcherItemsByCategoryId,
            pinnedItemIds: snapshot.pinnedItemIds,
            recentUsedItems: snapshot.recentUsedItems,
        });
        await store.syncSearchIndex();

        return {
            notices: [...notices],
        };
    }

    async function rollbackToSnapshot(snapshot: ImportSnapshot): Promise<void> {
        const rollbackErrors: string[] = [];

        try {
            await saveAppConfig(snapshot.backend.settings);
        } catch (error) {
            rollbackErrors.push(`恢复 config 失败: ${toErrorMessage(error)}`);
        }

        try {
            await invokeOrThrow("save_launcher_data", {
                data: snapshot.backend.launcherData,
            });
        } catch (error) {
            rollbackErrors.push(`恢复 launcher_data 失败: ${toErrorMessage(error)}`);
        }

        try {
            await restoreFrontendState(snapshot.frontend);
        } catch (error) {
            rollbackErrors.push(`恢复前端状态失败: ${toErrorMessage(error)}`);
        }

        if (rollbackErrors.length > 0) {
            throw new Error(rollbackErrors.join("；"));
        }
    }

    async function applyImportedData(result: ImportedDataPayload): Promise<ImportExecutionResult> {
        const notices = new Set<string>();
        const pluginManager = getPluginManager();

        if (result.settings) {
            const config = result.settings;
            if (config.theme) {
                await settingsStore.setTheme(config.theme);
            }
            if (typeof config.category_cols === "number") {
                uiStore.setCategoryCols(config.category_cols);
            }
            if (typeof config.launcher_cols === "number") {
                uiStore.setLauncherCols(config.launcher_cols);
            }
            if (config.home_section_layouts) {
                uiStore.setHomeSectionLayouts(config.home_section_layouts);
            }
            if (config.toggle_shortcut) {
                await settingsStore.setToggleShortcut(config.toggle_shortcut);
            }
            if (config.clipboard_shortcut) {
                await settingsStore.setClipboardShortcut(config.clipboard_shortcut);
            }
            if (typeof config.follow_mouse_on_show === "boolean") {
                await settingsStore.setFollowMouseOnShow(config.follow_mouse_on_show);
            }
            if (config.follow_mouse_y_anchor) {
                await settingsStore.setFollowMouseYAnchor(config.follow_mouse_y_anchor);
            }
            if (typeof config.ctrl_drag_enabled === "boolean") {
                await settingsStore.setCtrlDragEnabled(config.ctrl_drag_enabled);
            }
            if (typeof config.auto_hide_after_launch === "boolean") {
                await settingsStore.setAutoHideAfterLaunch(config.auto_hide_after_launch);
            }
            if (typeof config.show_guide_on_startup === "boolean") {
                await settingsStore.setShowGuideOnStartup(config.show_guide_on_startup);
            }
            if (typeof config.hide_on_ctrl_right_click === "boolean") {
                await settingsStore.setHideOnCtrlRightClick(config.hide_on_ctrl_right_click);
            }
            if (config.corner_hotspot_position) {
                await settingsStore.setCornerHotspotPosition(config.corner_hotspot_position);
            }
            if (config.corner_hotspot_sensitivity) {
                await settingsStore.setCornerHotspotSensitivity(config.corner_hotspot_sensitivity);
            }
            if (typeof config.corner_hotspot_enabled === "boolean") {
                await settingsStore.setCornerHotspotEnabled(config.corner_hotspot_enabled);
            }
            await applyImportedWindowEffectSettings(config, notices);
            if (typeof config.strong_shortcut_mode === "boolean") {
                await settingsStore.setStrongShortcutMode(config.strong_shortcut_mode);
            }
            if (typeof config.plugin_sandbox_enabled === "boolean") {
                await pluginManager.setSandboxMode(config.plugin_sandbox_enabled);
            }
            if (typeof config.clipboard_history_enabled === "boolean") {
                clipboardStore.setClipboardHistoryEnabled(config.clipboard_history_enabled);
            }
            if (typeof config.clipboard_max_records === "number") {
                clipboardStore.setMaxRecords(config.clipboard_max_records);
            }
        }

        if (result.launcher_data) {
            const data = result.launcher_data;
            const categories = data.categories || [];
            const { itemIds, itemRefs } = buildImportedItemReferenceIndex(categories);
            categoryStore.importCategories(
                categories.map((category) => ({
                    id: category.id,
                    name: category.name,
                    customIconBase64: category.custom_icon_base64 ?? null,
                }))
            );
            const pinnedIds = data.pinned_item_ids || data.favorite_item_ids || [];
            const recentUsedItems = filterImportedRecentUsedItems(
                itemRefs,
                data.recent_used_items || []
            ).map((item) => ({
                categoryId: item.category_id,
                itemId: item.item_id,
                usedAt: item.used_at,
                usageCount: Math.max(1, Math.floor(item.usage_count ?? 1)),
            }));
            store.importLauncherSnapshot(
                {
                    items: mapImportedLauncherItems(categories),
                    pinnedItemIds: filterImportedPinnedIds(itemIds, pinnedIds),
                    recentUsedItems,
                },
                {
                    refreshDerivedIcons: true,
                }
            );
        }

        await store.syncSearchIndex();

        return {
            notices: [...notices],
        };
    }

    async function executeImportTransaction(
        action: () => Promise<ImportedDataPayload>
    ): Promise<ImportExecutionResult> {
        const snapshot = await snapshotCurrentState();

        try {
            const result = await action();
            const validation = validateImportedData(result);
            if (!validation.valid) {
                throw buildValidationError(validation.errors);
            }
            return await applyImportedData(result);
        } catch (error) {
            try {
                await rollbackToSnapshot(snapshot);
            } catch (rollbackError) {
                throw new Error(
                    `导入失败：${toErrorMessage(error)}；回滚失败：${toErrorMessage(rollbackError)}`
                );
            }
            throw error instanceof Error ? error : new Error(toErrorMessage(error));
        }
    }

    async function buildExportPayload(options: DataExportOptions) {
        const payload: Record<string, unknown> = {
            version: "1.0",
            export_time: Math.floor(Date.now() / 1000),
        };

        if (options.includeLauncherData) {
            payload.launcher_data = buildLauncherExportData(
                categoryStore.categories,
                store.launcherItemsByCategoryId,
                store.pinnedItemIds,
                store.recentUsedItems
            );
        }

        if (options.includeSettings) {
            const settings = await getAppConfig();
            payload.settings = {
                ...settings,
                ai_organizer_api_key: "",
            };
        }

        if (options.includePlugins) {
            payload.plugins = [];
        }

        return payload;
    }

    async function exportData(options: DataExportOptions) {
        const defaultName = `air_launcher_export_${formatLocalDateForFilename(new Date())}`;
        const extension = options.format === "zip" ? "zip" : "json";
        const selected = await save({
            defaultPath: `${defaultName}.${extension}`,
            filters: [
                { name: "JSON", extensions: ["json"] },
                { name: "ZIP", extensions: ["zip"] },
            ],
            title: "导出数据",
        });

        if (!selected) {
            return false;
        }

        const path = typeof selected === "string" ? selected : selected[0];
        await invokeOrThrow("export_data_to_file", {
            path,
            format: options.format,
            data: await buildExportPayload(options),
        });
        return true;
    }

    async function importData(mergeMode: boolean) {
        const selected = await open({
            multiple: false,
            filters: [{ name: "数据文件", extensions: ["json", "zip"] }],
            title: "导入数据",
        });

        if (!selected) {
            return false;
        }

        const path = typeof selected === "string" ? selected : selected[0];
        return executeImportTransaction(() =>
            invokeOrThrow<ImportedDataPayload>("import_from_file", {
                path,
                mergeMode,
            })
        );
    }

    async function createBackup() {
        return invokeOrThrow<string>("create_backup");
    }

    async function listBackups() {
        return invokeOrThrow<BackupInfo[]>("list_backups");
    }

    async function restoreBackup(filename: string) {
        return executeImportTransaction(() =>
            invokeOrThrow<ImportedDataPayload>("restore_backup", { filename })
        );
    }

    async function deleteBackup(filename: string) {
        await invokeOrThrow("delete_backup", { filename });
    }

    async function refreshBackupList() {
        const result = await invoke<BackupInfo[]>("list_backups");
        if (!result.ok) {
            return [];
        }
        return result.value;
    }

    return {
        exportData,
        importData,
        createBackup,
        listBackups,
        restoreBackup,
        deleteBackup,
        refreshBackupList,
        applyImportedData,
    };
}
