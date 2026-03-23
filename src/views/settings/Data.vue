<template>
    <div class="data-settings">
        <div class="section">
            <div class="section-title">数据管理</div>
            <div class="data-management">
                <div class="dm-row">
                    <button class="dm-btn" type="button" @click="onExportData" :disabled="isProcessing">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="2">
                            <path
                                d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14l2-2V3a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2" />
                            <path d="M7 10l5 5 5-5" />
                        </svg>
                        导出数据
                    </button>
                    <button class="dm-btn" type="button" @click="onImportData" :disabled="isProcessing">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="2">
                            <path
                                d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14l2-2V3a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2" />
                            <path d="M7 14l5-5 5 5" />
                        </svg>
                        导入数据
                    </button>
                </div>
                <div class="dm-row">
                    <button class="dm-btn secondary" type="button" @click="onCreateBackup" :disabled="isProcessing">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="2">
                            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                            <polyline points="17 21 17 13 7 13 7 21" />
                            <polyline points="7 3 7 8 15 8" />
                        </svg>
                        创建备份
                    </button>
                    <button class="dm-btn secondary" type="button" @click="onShowBackups" :disabled="isProcessing">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="2">
                            <circle cx="12" cy="12" r="10" />
                            <polyline points="12 6 12 12 16 14" />
                        </svg>
                        备份历史
                    </button>
                </div>
            </div>
        </div>

        <div class="section">
            <div class="section-title">说明</div>
            <div class="note">启动台隐藏后可通过系统托盘左键唤醒窗口。</div>
        </div>

        <div v-if="showBackupDialog" class="dialog-overlay" @click="showBackupDialog = false">
            <div class="dialog" @click.stop>
                <div class="dialog-header">
                    <span class="dialog-title">备份历史</span>
                    <button class="dialog-close" type="button" @click="showBackupDialog = false">×</button>
                </div>
                <div class="dialog-content">
                    <div v-if="backupList.length === 0" class="empty-backups">
                        暂无备份记录
                    </div>
                    <div v-else class="backup-list">
                        <div v-for="backup in backupList" :key="backup.filename" class="backup-item">
                            <div class="backup-info">
                                <span class="backup-name">{{ backup.filename }}</span>
                                <span class="backup-time">{{ new Date(backup.created_at * 1000).toLocaleString()
                                    }}</span>
                            </div>
                            <div class="backup-actions">
                                <button class="backup-btn" type="button"
                                    @click="onRestoreBackup(backup.filename)">恢复</button>
                                <button class="backup-btn danger" type="button"
                                    @click="onDeleteBackup(backup.filename)">删除</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { storeToRefs } from "pinia";
import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { invoke as safeInvoke } from "../../utils/invoke-wrapper";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Store, useSettingsStore, useCategoryStore, useUIStore, useClipboardStore } from "../../stores";

const store = Store();
const settingsStore = useSettingsStore();
const uiStore = useUIStore();
const categoryStore = useCategoryStore();
const clipboardStore = useClipboardStore();
const {
    theme,
} = storeToRefs(settingsStore);

const isProcessing = ref<boolean>(false);
const importMergeMode = ref<boolean>(false);
const backupList = ref<{ filename: string; path: string; created_at: number; size: number }[]>([]);
const showBackupDialog = ref<boolean>(false);
const exportOptions = ref({
    includeLauncherData: true,
    includeSettings: true,
    includeClipboard: false,
    includePlugins: false,
    format: "json" as "json" | "zip",
});

function formatLocalDateForFilename(date: Date) {
    const pad2 = (n: number) => String(n).padStart(2, "0");
    const y = date.getFullYear();
    const m = pad2(date.getMonth() + 1);
    const d = pad2(date.getDate());
    return `${y}-${m}-${d}`;
}

async function onExportData() {
    if (isProcessing.value) return;

    try {
        const defaultName = `air_launcher_export_${formatLocalDateForFilename(new Date())}`;
        const extension = exportOptions.value.format === "zip" ? "zip" : "json";

        const selected = await save({
            defaultPath: `${defaultName}.${extension}`,
            filters: [
                { name: "JSON", extensions: ["json"] },
                { name: "ZIP", extensions: ["zip"] },
            ],
            title: "导出数据",
        });

        if (selected) {
            isProcessing.value = true;

            const path = typeof selected === "string" ? selected : (selected as string[])[0];

            const exportPayload: any = {
                version: "1.0",
                export_time: Math.floor(Date.now() / 1000),
            };

            if (exportOptions.value.includeLauncherData) {
                const categories = categoryStore.categories.map(cat => ({
                    id: cat.id,
                    name: cat.name,
                    custom_icon_base64: cat.customIconBase64,
                    items: (store.launcherItemsByCategoryId[cat.id] || []).map(item => ({
                        id: item.id,
                        name: item.name,
                        path: item.path,
                        is_directory: item.isDirectory,
                        icon_base64: item.iconBase64,
                        original_icon_base64: item.originalIconBase64,
                        is_favorite: item.isFavorite || false,
                        last_used_at: item.lastUsedAt || null,
                    })),
                }));

                exportPayload.launcher_data = {
                    version: "1.0",
                    categories,
                    favorite_item_ids: store.favoriteItemIds,
                    recent_used_items: store.recentUsedItems.map(item => ({
                        category_id: item.categoryId,
                        item_id: item.itemId,
                        used_at: item.usedAt,
                    })),
                };
            }

            if (exportOptions.value.includeSettings) {
                exportPayload.settings = {
                    version: "1.0",
                    theme: settingsStore.theme,
                    category_cols: uiStore.categoryCols,
                    launcher_cols: uiStore.launcherCols,
                    toggle_shortcut: settingsStore.toggleShortcut,
                    clipboard_shortcut: settingsStore.clipboardShortcut,
                    follow_mouse_on_show: settingsStore.followMouseOnShow,
                    follow_mouse_y_anchor: settingsStore.followMouseYAnchor,
                    clipboard_history_enabled: clipboardStore.clipboardHistoryEnabled,
                    home_section_layouts: uiStore.homeSectionLayouts,
                    backup_on_exit: false,
                    backup_frequency: "none",
                    backup_retention: 10,
                };
            }

            if (exportOptions.value.includeClipboard) {
                exportPayload.clipboard_history = clipboardStore.clipboardHistory.map(record => ({
                    id: record.id,
                    content: record.content,
                    record_type: record.type,
                    timestamp: record.timestamp,
                }));
            }

            if (exportOptions.value.includePlugins) {
                exportPayload.plugins = [];
            }

            await safeInvoke("export_data_to_file", {
                path,
                format: exportOptions.value.format,
                data: exportPayload,
            });

            alert("导出成功！");
        }
    } catch (e) {
        console.error("Failed to export data:", e);
        alert("导出失败：" + e);
    } finally {
        isProcessing.value = false;
    }
}

async function onImportData() {
    if (isProcessing.value) return;

    try {
        const selected = await open({
            multiple: false,
            filters: [
                { name: "数据文件", extensions: ["json", "zip"] },
            ],
            title: "导入数据",
        });

        if (selected) {
            isProcessing.value = true;

            const path = typeof selected === "string" ? selected : (selected as string[])[0];

            const result = await invoke<any>("import_from_file", {
                path,
                mergeMode: importMergeMode.value,
            });

            if (result.settings) {
                const config = result.settings;
                if (config.category_cols) {
                    uiStore.setCategoryCols(config.category_cols);
                }
                if (config.launcher_cols) {
                    uiStore.setLauncherCols(config.launcher_cols);
                }
                if (config.home_section_layouts) {
                    uiStore.setHomeSectionLayouts(config.home_section_layouts);
                }
                if (config.theme) {
                    theme.value = config.theme;
                }
                if (config.toggle_shortcut) {
                    await settingsStore.setToggleShortcut(config.toggle_shortcut);
                }
                if (config.clipboard_shortcut) {
                    await settingsStore.setClipboardShortcut(config.clipboard_shortcut);
                }
                if (config.follow_mouse_on_show !== undefined) {
                    await settingsStore.setFollowMouseOnShow(config.follow_mouse_on_show);
                }
                if (config.follow_mouse_y_anchor) {
                    await settingsStore.setFollowMouseYAnchor(config.follow_mouse_y_anchor);
                }
            }

            if (result.launcher_data) {
                const data = result.launcher_data;
                if (data.categories) {
                    categoryStore.importCategories(data.categories.map((c: any) => ({
                        id: c.id,
                        name: c.name,
                        customIconBase64: c.custom_icon_base64,
                    })));

                    const itemsMap: Record<string, any[]> = {};
                    for (const category of data.categories) {
                        if (category.items) {
                            itemsMap[category.id] = category.items.map((item: any) => ({
                                id: item.id,
                                name: item.name,
                                path: item.path,
                                isDirectory: item.is_directory,
                                iconBase64: item.icon_base64,
                                originalIconBase64: item.original_icon_base64,
                                isFavorite: item.is_favorite,
                                lastUsedAt: item.last_used_at,
                            }));
                        }
                    }
                    store.importLauncherItems(itemsMap);
                }
                if (data.favorite_item_ids) {
                    store.importFavoriteItemIds(data.favorite_item_ids);
                }
                if (data.recent_used_items) {
                    store.importRecentUsedItems(data.recent_used_items.map((item: any) => ({
                        categoryId: item.category_id,
                        itemId: item.item_id,
                        usedAt: item.used_at,
                    })));
                }
            }

            alert("导入成功！");
        }
    } catch (e) {
        console.error("Failed to import data:", e);
        alert("导入失败：" + e);
    } finally {
        isProcessing.value = false;
    }
}

async function onCreateBackup() {
    if (isProcessing.value) return;

    try {
        isProcessing.value = true;
        await safeInvoke("create_backup");
        await onShowBackups();
        alert("备份创建成功！");
    } catch (e) {
        console.error("Failed to create backup:", e);
        alert("备份创建失败：" + e);
    } finally {
        isProcessing.value = false;
    }
}

async function onShowBackups() {
    if (isProcessing.value) return;

    try {
        isProcessing.value = true;
        const result = await invoke<{ filename: string; path: string; created_at: number; size: number }[]>("list_backups");
        console.log("list_backups result:", result);
        if (result) {
            backupList.value = result;
            showBackupDialog.value = true;
        }
    } catch (e) {
        console.error("Failed to list backups:", e);
    } finally {
        isProcessing.value = false;
    }
}

async function onRestoreBackup(filename: string) {
    if (isProcessing.value) return;

    try {
        isProcessing.value = true;

        const result = await invoke<any>("restore_backup", { filename });

        if (result.settings) {
            const config = result.settings;
            if (config.category_cols) {
                uiStore.setCategoryCols(config.category_cols);
            }
            if (config.launcher_cols) {
                uiStore.setLauncherCols(config.launcher_cols);
            }
            if (config.home_section_layouts) {
                uiStore.setHomeSectionLayouts(config.home_section_layouts);
            }
            if (config.theme) {
                theme.value = config.theme;
            }
            if (config.toggle_shortcut) {
                await settingsStore.setToggleShortcut(config.toggle_shortcut);
            }
            if (config.clipboard_shortcut) {
                await settingsStore.setClipboardShortcut(config.clipboard_shortcut);
            }
            if (config.follow_mouse_on_show !== undefined) {
                await settingsStore.setFollowMouseOnShow(config.follow_mouse_on_show);
            }
            if (config.follow_mouse_y_anchor) {
                await settingsStore.setFollowMouseYAnchor(config.follow_mouse_y_anchor);
            }
        }

        if (result.launcher_data) {
            const data = result.launcher_data;
            if (data.categories) {
                categoryStore.importCategories(data.categories.map((c: any) => ({
                    id: c.id,
                    name: c.name,
                    customIconBase64: c.custom_icon_base64,
                })));

                const itemsMap: Record<string, any[]> = {};
                for (const category of data.categories) {
                    if (category.items) {
                        itemsMap[category.id] = category.items.map((item: any) => ({
                            id: item.id,
                            name: item.name,
                            path: item.path,
                            isDirectory: item.is_directory,
                            iconBase64: item.icon_base64,
                            originalIconBase64: item.original_icon_base64,
                            isFavorite: item.is_favorite,
                            lastUsedAt: item.last_used_at,
                        }));
                    }
                }
                store.importLauncherItems(itemsMap);
            }
            if (data.favorite_item_ids) {
                store.importFavoriteItemIds(data.favorite_item_ids);
            }
            if (data.recent_used_items) {
                store.importRecentUsedItems(data.recent_used_items.map((item: any) => ({
                    categoryId: item.category_id,
                    itemId: item.item_id,
                    usedAt: item.used_at,
                })));
            }
        }

        alert("备份恢复成功！");
        showBackupDialog.value = false;
    } catch (e) {
        console.error("Failed to restore backup:", e);
        alert("备份恢复失败：" + e);
    } finally {
        isProcessing.value = false;
    }
}

async function onDeleteBackup(filename: string) {
    if (isProcessing.value) return;

    try {
        isProcessing.value = true;
        await safeInvoke("delete_backup", { filename });
        const result = await invoke<{ filename: string; path: string; created_at: number; size: number }[]>("list_backups");
        if (result) {
            backupList.value = result;
        }
    } catch (e) {
        console.error("Failed to delete backup:", e);
    } finally {
        isProcessing.value = false;
    }
}
</script>

<style scoped>
.data-settings {
    display: flex;
    flex-direction: column;
    gap: 14px;
}

.section {
    background: var(--card-bg);
    border: 1px solid var(--border-color);
    border-radius: 16px;
    padding: 14px;
}

.section-title {
    font-size: 13px;
    font-weight: 700;
    color: var(--text-secondary);
    margin-bottom: 10px;
}

.data-management {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.dm-row {
    display: flex;
    gap: 8px;
}

.dm-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 12px 16px;
    border: 0;
    border-radius: 10px;
    background: var(--primary-color);
    color: white;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
}

.dm-btn:hover:not(:disabled) {
    opacity: 0.9;
    transform: translateY(-1px);
}

.dm-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.dm-btn.secondary {
    background: var(--hover-bg);
    color: var(--text-color);
}

.dm-btn.secondary:hover:not(:disabled) {
    background: var(--hover-bg-strong);
}

.note {
    font-size: 12px;
    color: var(--text-tertiary);
    line-height: 1.5;
    -webkit-app-region: no-drag;
}

.dialog-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
}

.dialog {
    background: var(--card-bg-solid);
    border-radius: 12px;
    min-width: 400px;
    max-width: 600px;
    max-height: 80vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
}

.dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px;
    border-bottom: 1px solid var(--border-color);
}

.dialog-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-color);
}

.dialog-close {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 0;
    background: transparent;
    color: var(--text-secondary);
    font-size: 20px;
    cursor: pointer;
    border-radius: 6px;
}

.dialog-close:hover {
    background: var(--hover-bg);
}

.dialog-content {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
}

.empty-backups {
    text-align: center;
    color: var(--text-hint);
    padding: 32px;
}

.backup-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.backup-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px;
    background: var(--hover-bg);
    border-radius: 8px;
}

.backup-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.backup-name {
    font-size: 13px;
    color: var(--text-color);
}

.backup-time {
    font-size: 11px;
    color: var(--text-hint);
}

.backup-actions {
    display: flex;
    gap: 8px;
}

.backup-btn {
    padding: 6px 12px;
    font-size: 12px;
    border: 0;
    border-radius: 6px;
    background: var(--primary-color);
    color: white;
    cursor: pointer;
}

.backup-btn:hover {
    opacity: 0.9;
}

.backup-btn.danger {
    background: var(--error-color);
}
</style>
