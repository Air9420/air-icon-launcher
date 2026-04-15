import { open, save } from "@tauri-apps/plugin-dialog";
import {
    Store,
    useCategoryStore,
    useClipboardStore,
    useSettingsStore,
    useUIStore,
    type Category,
    type LauncherItem,
    type RecentUsedItem,
} from "../stores";
import { invoke, invokeOrThrow } from "../utils/invoke-wrapper";
import { getAppConfig } from "../utils/config-sync";

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
        favorite_item_ids: pinnedItemIds,
        recent_used_items: recentUsedItems.map((item) => ({
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

    async function applyImportedData(result: ImportedDataPayload) {
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
            if (typeof config.clipboard_history_enabled === "boolean") {
                clipboardStore.setClipboardHistoryEnabled(config.clipboard_history_enabled);
            }
            if (typeof config.clipboard_max_records === "number") {
                clipboardStore.setMaxRecords(config.clipboard_max_records);
            }
        }

        if (result.launcher_data) {
            const data = result.launcher_data;
            if (data.categories) {
                categoryStore.importCategories(
                    data.categories.map((category) => ({
                        id: category.id,
                        name: category.name,
                        customIconBase64: category.custom_icon_base64 ?? null,
                    }))
                );
                store.importLauncherItems(mapImportedLauncherItems(data.categories));
            }

            const pinnedIds = data.pinned_item_ids || data.favorite_item_ids;
            if (pinnedIds) {
                const currentPinned = store.pinnedItemIds;
                const mergedPinned = [...new Set([...currentPinned, ...pinnedIds])];
                store.importPinnedItemIds(mergedPinned);
            }

            if (data.recent_used_items) {
                store.importRecentUsedItems(
                    data.recent_used_items.map((item) => ({
                        categoryId: item.category_id,
                        itemId: item.item_id,
                        usedAt: item.used_at,
                        usageCount: Math.max(1, Math.floor(item.usage_count ?? 1)),
                    }))
                );
            }
        }

        await store.syncSearchIndex();
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
            payload.settings = await getAppConfig();
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
        const result = await invokeOrThrow<ImportedDataPayload>("import_from_file", {
            path,
            mergeMode,
        });
        await applyImportedData(result);
        return true;
    }

    async function createBackup() {
        return invokeOrThrow<string>("create_backup");
    }

    async function listBackups() {
        return invokeOrThrow<BackupInfo[]>("list_backups");
    }

    async function restoreBackup(filename: string) {
        const result = await invokeOrThrow<ImportedDataPayload>("restore_backup", { filename });
        await applyImportedData(result);
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
