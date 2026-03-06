<template>
    <div
        class="settings-view"
        data-menu-type="categorie-view"
        data-tauri-drag-region
    >
        <header class="settings-header" data-tauri-drag-region>
            <button
                class="back-btn"
                type="button"
                @click="onBack"
                @mousedown.stop
            >
                返回
            </button>
            <div class="title" data-tauri-drag-region>设置</div>
        </header>

        <div class="content">
            <div class="section">
                <div class="section-title">主题</div>
                <div class="segmented">
                    <button
                        class="seg-btn"
                        type="button"
                        :class="{ active: theme === 'light' }"
                        @click="onSetTheme('light')"
                    >
                        亮色
                    </button>
                    <button
                        class="seg-btn"
                        type="button"
                        :class="{ active: theme === 'dark' }"
                        @click="onSetTheme('dark')"
                    >
                        暗色
                    </button>
                    <button
                        class="seg-btn"
                        type="button"
                        :class="{ active: theme === 'transparent' }"
                        @click="onSetTheme('transparent')"
                    >
                        透明
                    </button>
                    <button
                        class="seg-btn"
                        type="button"
                        :class="{ active: theme === 'system' }"
                        @click="onSetTheme('system')"
                    >
                        跟随系统
                    </button>
                </div>
            </div>

            <div class="section">
                <div class="section-title">图标大小（每行数量）</div>
                <div class="icon-size-row">
                    <span class="icon-size-label">分类</span>
                    <div class="segmented icon-size-segmented">
                        <button
                            class="seg-btn"
                            type="button"
                            :class="{ active: categoryCols === 4 }"
                            @click="onSetCategoryCols(4)"
                        >
                            4
                        </button>
                        <button
                            class="seg-btn"
                            type="button"
                            :class="{ active: categoryCols === 5 }"
                            @click="onSetCategoryCols(5)"
                        >
                            5
                        </button>
                    </div>
                </div>
                <div class="icon-size-row">
                    <span class="icon-size-label">启动项</span>
                    <div class="segmented icon-size-segmented">
                        <button
                            class="seg-btn"
                            type="button"
                            :class="{ active: launcherCols === 4 }"
                            @click="onSetLauncherCols(4)"
                        >
                            4
                        </button>
                        <button
                            class="seg-btn"
                            type="button"
                            :class="{ active: launcherCols === 5 }"
                            @click="onSetLauncherCols(5)"
                        >
                            5
                        </button>
                        <button
                            class="seg-btn"
                            type="button"
                            :class="{ active: launcherCols === 6 }"
                            @click="onSetLauncherCols(6)"
                        >
                            6
                        </button>
                    </div>
                </div>
            </div>

            <div class="section">
                <div class="section-title">快捷键</div>
                <div class="shortcut-row">
                    <span class="shortcut-label">主窗口</span>
                    <input
                        v-model="shortcutDraft"
                        class="input shortcut-input"
                        type="text"
                        placeholder="点击后按下快捷键"
                        readonly
                        @focus="startRecording('main')"
                        @click="startRecording('main')"
                    />
                </div>
                <div class="shortcut-row">
                    <span class="shortcut-label">剪贴板</span>
                    <input
                        v-model="clipboardShortcutDraft"
                        class="input shortcut-input"
                        type="text"
                        placeholder="点击后按下快捷键"
                        readonly
                        @focus="startRecording('clipboard')"
                        @click="startRecording('clipboard')"
                    />
                </div>
                <div class="hint">
                    {{
                        recording
                            ? "正在录制…按下组合键即可绑定（Esc 取消）"
                            : "点击输入框后按下组合键进行绑定"
                    }}
                </div>
                <div v-if="shortcutError" class="hint error">
                    {{ shortcutError }}
                </div>
            </div>

            <div class="section">
                <div class="section-title">窗口</div>
                <label class="check">
                    <input
                        v-model="followMouseDraft"
                        type="checkbox"
                        @change="onApplyFollowMouse"
                    />
                    <span>显示时跟随鼠标位置</span>
                </label>
                <div class="segmented" :class="{ disabled: !followMouseDraft }">
                    <button
                        class="seg-btn"
                        type="button"
                        :class="{ active: followMouseAnchorDraft === 'top' }"
                        :disabled="!followMouseDraft"
                        @click="onSetFollowMouseAnchor('top')"
                    >
                        顶部
                    </button>
                    <button
                        class="seg-btn"
                        type="button"
                        :class="{ active: followMouseAnchorDraft === 'center' }"
                        :disabled="!followMouseDraft"
                        @click="onSetFollowMouseAnchor('center')"
                    >
                        居中
                    </button>
                    <button
                        class="seg-btn"
                        type="button"
                        :class="{ active: followMouseAnchorDraft === 'bottom' }"
                        :disabled="!followMouseDraft"
                        @click="onSetFollowMouseAnchor('bottom')"
                    >
                        底部
                    </button>
                </div>
            </div>

            <div class="section">
                <div class="section-title">启动</div>
                <label class="check">
                    <input
                        v-model="autostartDraft"
                        type="checkbox"
                        :disabled="autostartServiceLoading"
                        @change="onApplyAutostartService"
                    />
                    <span>开机自启（服务方式）</span>
                </label>
                <div class="hint">
                    开启/关闭可能需要管理员权限，默认仅驻留托盘不弹窗。
                </div>
                <div v-if="autostartServiceError" class="hint error">
                    {{ autostartServiceError }}
                </div>
            </div>

            <div class="section">
                <div class="section-title">剪贴板</div>
                <div class="clipboard-setting-row">
                    <span class="setting-label">最大记录数</span>
                    <div class="segmented small-segmented">
                        <button
                            class="seg-btn"
                            type="button"
                            :class="{ active: clipboardMaxRecords === 50 }"
                            @click="onSetClipboardMaxRecords(50)"
                        >
                            50
                        </button>
                        <button
                            class="seg-btn"
                            type="button"
                            :class="{ active: clipboardMaxRecords === 100 }"
                            @click="onSetClipboardMaxRecords(100)"
                        >
                            100
                        </button>
                        <button
                            class="seg-btn"
                            type="button"
                            :class="{ active: clipboardMaxRecords === 200 }"
                            @click="onSetClipboardMaxRecords(200)"
                        >
                            200
                        </button>
                        <button
                            class="seg-btn"
                            type="button"
                            :class="{ active: clipboardMaxRecords === 0 }"
                            @click="onSetClipboardMaxRecords(0)"
                        >
                            无限
                        </button>
                    </div>
                </div>
                <div class="clipboard-setting-row">
                    <span class="setting-label">图片大小限制</span>
                    <div class="segmented small-segmented">
                        <button
                            class="seg-btn"
                            type="button"
                            :class="{ active: clipboardMaxImageSize === 0.5 }"
                            @click="onSetClipboardMaxImageSize(0.5)"
                        >
                            0.5MB
                        </button>
                        <button
                            class="seg-btn"
                            type="button"
                            :class="{ active: clipboardMaxImageSize === 1 }"
                            @click="onSetClipboardMaxImageSize(1)"
                        >
                            1MB
                        </button>
                        <button
                            class="seg-btn"
                            type="button"
                            :class="{ active: clipboardMaxImageSize === 2 }"
                            @click="onSetClipboardMaxImageSize(2)"
                        >
                            2MB
                        </button>
                        <button
                            class="seg-btn"
                            type="button"
                            :class="{ active: clipboardMaxImageSize === 5 }"
                            @click="onSetClipboardMaxImageSize(5)"
                        >
                            5MB
                        </button>
                    </div>
                </div>
                <label class="check">
                    <input
                        v-model="clipboardEncrypted"
                        type="checkbox"
                        @change="onSetClipboardEncrypted"
                        :disabled="isProcessing || isEncrypting"
                    />
                    <span>加密存储</span>
                </label>
                <div v-if="isEncrypting" class="migration-progress">
                    <div class="progress-bar">
                        <div class="progress-fill" :style="{ width: encryptProgress + '%' }"></div>
                    </div>
                    <span class="progress-text">正在处理数据... {{ encryptProgress }}%</span>
                </div>
                <div class="clipboard-setting-row" style="margin-top: 12px;">
                    <span class="setting-label">存储目录</span>
                    <div class="storage-path-display">
                        <span class="path-text">{{ clipboardStoragePath || '默认位置' }}</span>
                        <button 
                            class="path-btn" 
                            type="button" 
                            @click="onSelectStoragePath"
                            :disabled="isProcessing || isMigrating"
                        >
                            选择
                        </button>
                        <button 
                            class="path-btn" 
                            type="button" 
                            @click="onResetStoragePath"
                            :disabled="isProcessing || isMigrating"
                        >
                            默认
                        </button>
                    </div>
                </div>
                <div v-if="isMigrating" class="migration-progress">
                    <div class="progress-bar">
                        <div class="progress-fill" :style="{ width: migrationProgress + '%' }"></div>
                    </div>
                    <span class="progress-text">正在迁移数据... {{ migrationProgress }}%</span>
                </div>
                <div class="hint">
                    剪贴板历史支持文本和图片，可选择自定义存储目录。
                </div>
            </div>

            <div class="section">
                <div class="section-title">功能</div>
                <div class="action-buttons">
                    <button class="action-btn" type="button" @click="onOpenClipboard">
                        剪贴板历史
                    </button>
                    <button class="action-btn" type="button" @click="onOpenPlugins">
                        插件管理
                    </button>
                    <button class="action-btn danger" type="button" @click="onClearRecentUsed">
                        清除最近使用记录
                    </button>
                </div>
            </div>

            <div class="section">
                <div class="section-title">数据管理</div>
                <div class="data-management">
                    <div class="dm-row">
                        <button 
                            class="dm-btn" 
                            type="button" 
                            @click="onExportData"
                            :disabled="isProcessing"
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14l2-2V3a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2"/>
                                <path d="M7 10l5 5 5-5"/>
                            </svg>
                            导出数据
                        </button>
                        <button 
                            class="dm-btn" 
                            type="button" 
                            @click="onImportData"
                            :disabled="isProcessing"
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14l2-2V3a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2"/>
                                <path d="M7 14l5-5 5 5"/>
                            </svg>
                            导入数据
                        </button>
                    </div>
                    <div class="dm-row">
                        <button 
                            class="dm-btn secondary" 
                            type="button" 
                            @click="onCreateBackup"
                            :disabled="isProcessing"
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                                <polyline points="17 21 17 13 7 13 7 21"/>
                                <polyline points="7 3 7 8 15 8"/>
                            </svg>
                            创建备份
                        </button>
                        <button 
                            class="dm-btn secondary" 
                            type="button" 
                            @click="onShowBackups"
                            :disabled="isProcessing"
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10"/>
                                <polyline points="12 6 12 12 16 14"/>
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
                                <span class="backup-time">{{ new Date(backup.created_at * 1000).toLocaleString() }}</span>
                            </div>
                            <div class="backup-actions">
                                <button class="backup-btn" type="button" @click="onRestoreBackup(backup.filename)">恢复</button>
                                <button class="backup-btn danger" type="button" @click="onDeleteBackup(backup.filename)">删除</button>
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
import { onBeforeUnmount, onMounted, ref, watchEffect } from "vue";
import { useRouter } from "vue-router";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Store } from "../stores";

const router = useRouter();
const store = Store();
const {
    categoryCols,
    launcherCols,
    toggleShortcut,
    clipboardShortcut,
    followMouseOnShow,
    followMouseYAnchor,
    autostartServiceEnabled,
    autostartServiceLoading,
    autostartServiceError,
    theme,
} = storeToRefs(store);
const shortcutDraft = ref<string>("");
const clipboardShortcutDraft = ref<string>("");
const followMouseDraft = ref<boolean>(false);
const followMouseAnchorDraft = ref<"top" | "center" | "bottom">("center");
const autostartDraft = ref<boolean>(false);
const recording = ref<boolean>(false);
const recordingTarget = ref<"main" | "clipboard">("main");
const shortcutError = ref<string>("");
const clipboardMaxRecords = ref<number>(100);
const clipboardMaxImageSize = ref<number>(1);
const clipboardEncrypted = ref<boolean>(false);
const clipboardStoragePath = ref<string>("");
const isProcessing = ref<boolean>(false);
const importMergeMode = ref<boolean>(false);
const backupList = ref<any[]>([]);
const showBackupDialog = ref<boolean>(false);
const exportOptions = ref({
    includeLauncherData: true,
    includeSettings: true,
    includeClipboard: false,
    includePlugins: false,
    format: "json" as "json" | "zip",
});
const isMigrating = ref<boolean>(false);
const migrationProgress = ref<number>(0);
const isEncrypting = ref<boolean>(false);
const encryptProgress = ref<number>(0);

watchEffect(() => {
    shortcutDraft.value = toggleShortcut.value;
    clipboardShortcutDraft.value = clipboardShortcut.value;
    followMouseDraft.value = followMouseOnShow.value;
    followMouseAnchorDraft.value = followMouseYAnchor.value;
    autostartDraft.value = autostartServiceEnabled.value;
});

onMounted(async () => {
    store.refreshAutostartServiceStatus();
    await loadClipboardConfig();
});

async function loadClipboardConfig() {
    try {
        const config = await invoke<{
            max_records: number;
            max_image_size_mb: number;
            encrypted: boolean;
            storage_path: string | null;
        }>("get_clipboard_config");
        clipboardMaxRecords.value = config.max_records;
        clipboardMaxImageSize.value = config.max_image_size_mb;
        clipboardEncrypted.value = config.encrypted;
        clipboardStoragePath.value = config.storage_path || "";
    } catch (e) {
        console.error("Failed to load clipboard config:", e);
    }
    
    try {
        const path = await invoke<string>("get_clipboard_storage_path");
        if (path) {
            clipboardStoragePath.value = path;
        }
    } catch (e) {
        console.error("Failed to get clipboard storage path:", e);
    }
}

/**
 * 返回主界面。
 */
function onBack() {
    router.push("/categories");
}

/**
 * 设置分类图标每行数量。
 */
function onSetCategoryCols(cols: number) {
    store.setCategoryCols(cols);
}

/**
 * 设置启动项图标每行数量。
 */
function onSetLauncherCols(cols: number) {
    store.setLauncherCols(cols);
}

function onSetTheme(newTheme: "light" | "dark" | "transparent" | "system") {
    store.setTheme(newTheme);
}

function startRecording(target: "main" | "clipboard") {
    if (recording.value) return;
    recording.value = true;
    recordingTarget.value = target;
    shortcutError.value = "";
}

async function onApplyFollowMouse() {
    await store.setFollowMouseOnShow(!!followMouseDraft.value);
}

async function onSetFollowMouseAnchor(anchor: "top" | "center" | "bottom") {
    followMouseAnchorDraft.value = anchor;
    await store.setFollowMouseYAnchor(anchor);
}

/**
 * 应用"开机自启（服务方式）"的变更。
 */
async function onApplyAutostartService() {
    await store.setAutostartServiceEnabled(!!autostartDraft.value);
}

async function onSetClipboardMaxRecords(value: number) {
    clipboardMaxRecords.value = value;
    try {
        await invoke("set_clipboard_config", {
            maxRecords: value,
        });
    } catch (e) {
        console.error("Failed to set clipboard max records:", e);
    }
}

async function onSetClipboardMaxImageSize(value: number) {
    clipboardMaxImageSize.value = value;
    try {
        await invoke("set_clipboard_config", {
            maxImageSizeMb: value,
        });
    } catch (e) {
        console.error("Failed to set clipboard max image size:", e);
    }
}

async function onSetClipboardEncrypted() {
    if (isProcessing.value || isEncrypting.value) return;
    
    isProcessing.value = true;
    isEncrypting.value = true;
    encryptProgress.value = 0;
    
    try {
        await new Promise(resolve => setTimeout(resolve, 100));
        encryptProgress.value = 30;
        
        await invoke("set_clipboard_config", {
            encrypted: clipboardEncrypted.value,
        });
        
        encryptProgress.value = 80;
        await new Promise(resolve => setTimeout(resolve, 100));
        
        encryptProgress.value = 100;
        await new Promise(resolve => setTimeout(resolve, 300));
    } catch (e) {
        console.error("Failed to set clipboard encrypted:", e);
        clipboardEncrypted.value = !clipboardEncrypted.value;
    } finally {
        isEncrypting.value = false;
        isProcessing.value = false;
    }
}

async function onSelectStoragePath() {
    if (isProcessing.value || isMigrating.value) return;
    
    try {
        const selected = await open({
            directory: true,
            multiple: false,
            title: "选择剪贴板存储目录",
        });
        
        if (selected) {
            const dirPath = typeof selected === "string" ? selected : (selected as string[])[0];
            if (dirPath) {
                isProcessing.value = true;
                isMigrating.value = true;
                migrationProgress.value = 0;
                
                const filePath = dirPath + "\\clipboard_history.json";
                
                await new Promise(resolve => setTimeout(resolve, 100));
                migrationProgress.value = 30;
                
                await invoke("set_clipboard_storage_path", { path: filePath });
                
                migrationProgress.value = 80;
                await new Promise(resolve => setTimeout(resolve, 100));
                
                clipboardStoragePath.value = filePath;
                migrationProgress.value = 100;
                
                await new Promise(resolve => setTimeout(resolve, 300));
            }
        }
    } catch (e) {
        console.error("Failed to select storage path:", e);
    } finally {
        isMigrating.value = false;
        isProcessing.value = false;
    }
}

async function onResetStoragePath() {
    if (isProcessing.value || isMigrating.value) return;
    
    try {
        isProcessing.value = true;
        isMigrating.value = true;
        migrationProgress.value = 0;
        
        await new Promise(resolve => setTimeout(resolve, 100));
        migrationProgress.value = 30;
        
        const defaultPath = await invoke<string>("reset_clipboard_storage_path");
        
        migrationProgress.value = 80;
        await new Promise(resolve => setTimeout(resolve, 100));
        
        clipboardStoragePath.value = defaultPath;
        migrationProgress.value = 100;
        
        await new Promise(resolve => setTimeout(resolve, 300));
    } catch (e) {
        console.error("Failed to reset storage path:", e);
    } finally {
        isMigrating.value = false;
        isProcessing.value = false;
    }
}

function onOpenClipboard() {
    router.push("/clipboard");
}

function onOpenPlugins() {
    router.push("/plugins");
}

async function onExportData() {
    if (isProcessing.value) return;
    
    try {
        const defaultName = `air_launcher_export_${new Date().toISOString().slice(0, 10)}`;
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
                const categories = store.categories.map(cat => ({
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
                    theme: store.theme,
                    category_cols: store.categoryCols,
                    launcher_cols: store.launcherCols,
                    toggle_shortcut: store.toggleShortcut,
                    clipboard_shortcut: store.clipboardShortcut,
                    follow_mouse_on_show: store.followMouseOnShow,
                    follow_mouse_y_anchor: store.followMouseYAnchor,
                    clipboard_history_enabled: store.clipboardHistoryEnabled,
                    clipboard_max_records: clipboardMaxRecords.value,
                    clipboard_max_image_size_mb: clipboardMaxImageSize.value,
                    clipboard_encrypted: clipboardEncrypted.value,
                    backup_on_exit: false,
                    backup_frequency: "none",
                    backup_retention: 10,
                };
            }
            
            if (exportOptions.value.includeClipboard) {
                exportPayload.clipboard_history = store.clipboardHistory.map(record => ({
                    id: record.id,
                    content: record.content,
                    record_type: record.type,
                    timestamp: record.timestamp,
                }));
            }
            
            if (exportOptions.value.includePlugins) {
                exportPayload.plugins = [];
            }
            
            await invoke("export_data_to_file", {
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

async function loadAppSettings() {
    try {
        const settings = await invoke<{
            toggle_shortcut: string;
            clipboard_shortcut: string;
            follow_mouse_on_show: boolean;
            follow_mouse_y_anchor: string;
        }>("get_app_settings");
        
        if (settings.toggle_shortcut) {
            shortcutDraft.value = settings.toggle_shortcut;
        }
        if (settings.clipboard_shortcut) {
            clipboardShortcutDraft.value = settings.clipboard_shortcut;
        }
        followMouseDraft.value = settings.follow_mouse_on_show;
        if (settings.follow_mouse_y_anchor) {
            followMouseAnchorDraft.value = settings.follow_mouse_y_anchor as "top" | "center" | "bottom";
        }
    } catch (e) {
        console.error("Failed to load app settings:", e);
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
                    store.setCategoryCols(config.category_cols);
                }
                if (config.launcher_cols) {
                    store.setLauncherCols(config.launcher_cols);
                }
                if (config.theme) {
                    theme.value = config.theme;
                }
                if (config.toggle_shortcut) {
                    await store.setToggleShortcut(config.toggle_shortcut);
                }
                if (config.clipboard_shortcut) {
                    await store.setClipboardShortcut(config.clipboard_shortcut);
                }
                if (config.follow_mouse_on_show !== undefined) {
                    await store.setFollowMouseOnShow(config.follow_mouse_on_show);
                }
                if (config.follow_mouse_y_anchor) {
                    await store.setFollowMouseYAnchor(config.follow_mouse_y_anchor);
                }
                if (config.clipboard_max_records !== undefined) {
                    await onSetClipboardMaxRecords(config.clipboard_max_records);
                }
                if (config.clipboard_max_image_size_mb !== undefined) {
                    await onSetClipboardMaxImageSize(config.clipboard_max_image_size_mb);
                }
                if (config.clipboard_encrypted !== undefined) {
                    clipboardEncrypted.value = config.clipboard_encrypted;
                    await invoke("set_clipboard_config", { encrypted: config.clipboard_encrypted });
                }
                if (config.clipboard_history_enabled !== undefined) {
                    store.clipboardHistoryEnabled = config.clipboard_history_enabled;
                }
            }
            
            if (result.launcher_data) {
                const data = result.launcher_data;
                if (data.categories) {
                    store.importCategories(data.categories.map((c: any) => ({
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
            
            await loadClipboardConfig();
            await loadAppSettings();
            
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
        await invoke("create_backup");
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
        backupList.value = await invoke("list_backups");
        showBackupDialog.value = true;
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
                store.setCategoryCols(config.category_cols);
            }
            if (config.launcher_cols) {
                store.setLauncherCols(config.launcher_cols);
            }
            if (config.theme) {
                theme.value = config.theme;
            }
            if (config.toggle_shortcut) {
                await store.setToggleShortcut(config.toggle_shortcut);
            }
            if (config.clipboard_shortcut) {
                await store.setClipboardShortcut(config.clipboard_shortcut);
            }
            if (config.follow_mouse_on_show !== undefined) {
                await store.setFollowMouseOnShow(config.follow_mouse_on_show);
            }
            if (config.follow_mouse_y_anchor) {
                await store.setFollowMouseYAnchor(config.follow_mouse_y_anchor);
            }
            if (config.clipboard_max_records !== undefined) {
                await onSetClipboardMaxRecords(config.clipboard_max_records);
            }
            if (config.clipboard_max_image_size_mb !== undefined) {
                await onSetClipboardMaxImageSize(config.clipboard_max_image_size_mb);
            }
            if (config.clipboard_encrypted !== undefined) {
                clipboardEncrypted.value = config.clipboard_encrypted;
                await invoke("set_clipboard_config", { encrypted: config.clipboard_encrypted });
            }
            if (config.clipboard_history_enabled !== undefined) {
                store.clipboardHistoryEnabled = config.clipboard_history_enabled;
            }
        }
        
        if (result.launcher_data) {
            const data = result.launcher_data;
            if (data.categories) {
                store.importCategories(data.categories.map((c: any) => ({
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
        
        await loadClipboardConfig();
        await loadAppSettings();
        
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
        await invoke("delete_backup", { filename });
        backupList.value = await invoke("list_backups");
    } catch (e) {
        console.error("Failed to delete backup:", e);
    } finally {
        isProcessing.value = false;
    }
}

function onClearRecentUsed() {
    store.clearRecentUsed();
}

function isModifierKey(key: string) {
    return (
        key === "Shift" || key === "Control" || key === "Alt" || key === "Meta"
    );
}

function normalizeKey(key: string) {
    if (key === " ") return "space";
    if (key === "Escape") return "esc";
    return key.toLowerCase();
}

async function onRecordKeyDown(ev: KeyboardEvent) {
    if (!recording.value) return;
    ev.preventDefault();
    ev.stopPropagation();

    if (ev.key === "Escape") {
        recording.value = false;
        shortcutDraft.value = toggleShortcut.value;
        clipboardShortcutDraft.value = clipboardShortcut.value;
        shortcutError.value = "";
        return;
    }

    if (isModifierKey(ev.key)) return;

    const parts: string[] = [];
    if (ev.ctrlKey) parts.push("ctrl");
    if (ev.altKey) parts.push("alt");
    if (ev.shiftKey) parts.push("shift");
    if (ev.metaKey) parts.push("meta");
    parts.push(normalizeKey(ev.key));

    const next = parts.join("+");
    recording.value = false;
    shortcutError.value = "";

    if (recordingTarget.value === "main") {
        if (next === clipboardShortcut.value) {
            shortcutError.value = "主窗口快捷键不能与剪贴板快捷键相同";
            shortcutDraft.value = toggleShortcut.value;
            return;
        }
        shortcutDraft.value = next;
        await store.setToggleShortcut(next);
    } else {
        if (next === toggleShortcut.value) {
            shortcutError.value = "剪贴板快捷键不能与主窗口快捷键相同";
            clipboardShortcutDraft.value = clipboardShortcut.value;
            return;
        }
        clipboardShortcutDraft.value = next;
        try {
            await store.setClipboardShortcut(next);
        } catch (e: any) {
            shortcutError.value = typeof e === "string" ? e : e?.message || "设置失败";
            clipboardShortcutDraft.value = clipboardShortcut.value;
        }
    }
}

window.addEventListener("keydown", onRecordKeyDown, true);
onBeforeUnmount(() => {
    window.removeEventListener("keydown", onRecordKeyDown, true);
});
</script>

<style scoped>
.settings-view {
    width: 100vw;
    height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg-color);
}

.settings-header {
    height: 52px;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 12px;
    background: var(--card-bg);
    border-bottom: 1px solid var(--border-color);
    backdrop-filter: var(--backdrop-blur);
}

.back-btn {
    border: 0;
    padding: 8px 10px;
    border-radius: 10px;
    background: var(--hover-bg);
    cursor: pointer;
    -webkit-app-region: no-drag;
    color: var(--text-color);
}

.back-btn:hover {
    background: var(--hover-bg-strong);
}

.title {
    font-size: 16px;
    font-weight: 700;
    color: var(--text-color);
}

.content {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    height: calc(100vh - 52px - 32px);
    overflow-y: scroll;
    -ms-overflow-style: none;
    &::-webkit-scrollbar {
        display: none;
    }
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

.icon-size-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 8px;
}

.icon-size-row:last-child {
    margin-bottom: 0;
}

.icon-size-label {
    font-size: 13px;
    color: var(--text-secondary);
    min-width: 50px;
}

.icon-size-segmented {
    flex: 1;
}

.action-buttons {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.shortcut-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 8px;
}

.shortcut-row:last-child {
    margin-bottom: 0;
}

.shortcut-label {
    font-size: 13px;
    color: var(--text-secondary);
    min-width: 60px;
}

.shortcut-input {
    flex: 1;
}

.hint.error {
    color: var(--error-color);
    margin-top: 4px;
}

.clipboard-setting-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 8px;
}

.clipboard-setting-row:last-of-type {
    margin-bottom: 12px;
}

.setting-label {
    font-size: 13px;
    color: var(--text-secondary);
    min-width: 80px;
}

.small-segmented .seg-btn {
    padding: 6px 12px;
    font-size: 12px;
    white-space: nowrap;
}

.clipboard-setting-row .segmented {
    flex-wrap: nowrap;
}

.storage-path-display {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
}

.path-text {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    background: var(--input-bg);
    padding: 6px 10px;
    border-radius: 6px;
}

.path-btn {
    flex-shrink: 0;
    padding: 6px 12px;
    font-size: 12px;
    border: 0;
    border-radius: 6px;
    background: var(--hover-bg);
    color: var(--text-color);
    cursor: pointer;
    transition: all 0.15s ease;
}

.path-btn:hover {
    background: var(--hover-bg-strong);
}

.path-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.migration-progress {
    margin-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.progress-bar {
    height: 4px;
    background: var(--hover-bg);
    border-radius: 2px;
    overflow: hidden;
}

.progress-fill {
    height: 100%;
    background: var(--primary-color);
    transition: width 0.3s ease;
}

.progress-text {
    font-size: 11px;
    color: var(--text-hint);
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

.segmented {
    display: flex;
    gap: 8px;
}

.segmented.disabled {
    opacity: 0.6;
}

.seg-btn {
    flex: 1;
    height: 34px;
    border-radius: 12px;
    border: 1px solid var(--border-color-strong);
    background: var(--input-bg);
    cursor: pointer;
    -webkit-app-region: no-drag;
    color: var(--text-color);
}

.seg-btn.active {
    border-color: var(--primary-color);
    background: var(--primary-bg);
}

.row {
    display: flex;
    gap: 10px;
    align-items: center;
}

.input {
    flex: 1;
    height: 34px;
    padding: 0 10px;
    border-radius: 12px;
    border: 1px solid var(--border-color-strong);
    background: var(--input-bg);
    outline: none;
    -webkit-app-region: no-drag;
    color: var(--text-color);
}

.btn {
    height: 34px;
    padding: 0 14px;
    border-radius: 12px;
    border: 1px solid var(--border-color-strong);
    background: var(--input-bg);
    cursor: pointer;
    -webkit-app-region: no-drag;
    white-space: nowrap;
    color: var(--text-color);
}

.btn:hover {
    background: var(--hover-bg);
}

.hint {
    margin-top: 8px;
    font-size: 12px;
    color: var(--text-hint);
    -webkit-app-region: no-drag;
}

.hint.error {
    color: var(--error-color);
}

.check {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    color: var(--text-secondary);
    -webkit-app-region: no-drag;
}

.check input {
    width: 16px;
    height: 16px;
}

.note {
    font-size: 12px;
    color: var(--text-tertiary);
    line-height: 1.5;
    -webkit-app-region: no-drag;
}

.action-btn {
    width: 100%;
    height: 34px;
    border-radius: 12px;
    border: 1px solid var(--border-color-strong);
    background: var(--input-bg);
    cursor: pointer;
    -webkit-app-region: no-drag;
    color: var(--text-color);
    font-size: 13px;
}

.action-btn:hover {
    background: var(--hover-bg);
}

.action-btn.danger {
    color: var(--error-color);
    border-color: var(--error-color);
}

.action-btn.danger:hover {
    background: var(--error-bg);
}
</style>

