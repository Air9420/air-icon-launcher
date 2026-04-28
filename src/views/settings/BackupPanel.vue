<template>
    <div class="backup-panel">
        <div class="bp-row">
            <button class="bp-btn secondary" type="button" @click="onCreateBackup" :disabled="isProcessing">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    stroke-width="2">
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                    <polyline points="17 21 17 13 7 13 7 21" />
                    <polyline points="7 3 7 8 15 8" />
                </svg>
                创建备份
            </button>
            <button class="bp-btn secondary" type="button" @click="onShowBackups" :disabled="isProcessing">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    stroke-width="2">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                </svg>
                备份历史
            </button>
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
import { ref } from "vue";
import { useDataManagement, type BackupInfo } from "../../composables/useDataManagement";
import { useSearchStore } from "../../stores";
import { showToast } from "../../composables/useGlobalToast";

const isProcessing = ref<boolean>(false);
const backupList = ref<BackupInfo[]>([]);
const showBackupDialog = ref<boolean>(false);
const dataManagement = useDataManagement();

async function onCreateBackup() {
    if (isProcessing.value) return;

    try {
        isProcessing.value = true;
        await dataManagement.createBackup();
        await onShowBackups();
        showToast("备份创建成功！", { type: "success" });
    } catch (e) {
        console.error("Failed to create backup:", e);
        const message = e instanceof Error ? e.message : String(e);
        showToast("备份创建失败：" + message, { type: "error" });
    } finally {
        isProcessing.value = false;
    }
}

async function onShowBackups() {
    if (isProcessing.value) return;

    try {
        isProcessing.value = true;
        backupList.value = await dataManagement.listBackups();
        showBackupDialog.value = true;
    } catch (e) {
        console.error("Failed to list backups:", e);
        showToast("获取备份列表失败", { type: "error" });
    } finally {
        isProcessing.value = false;
    }
}

async function onRestoreBackup(filename: string) {
    if (isProcessing.value) return;

    try {
        isProcessing.value = true;
        const restored = await dataManagement.restoreBackup(filename);
        const searchStore = useSearchStore();
        await searchStore.syncFullIndex();
        showToast("备份恢复成功！", { type: "success" });
        restored.notices.forEach((notice) => {
            showToast(notice, { type: "info", duration: 5000 });
        });
        showBackupDialog.value = false;
    } catch (e) {
        console.error("Failed to restore backup:", e);
        const message = e instanceof Error ? e.message : String(e);
        showToast("备份恢复失败：" + message, { type: "error" });
    } finally {
        isProcessing.value = false;
    }
}

async function onDeleteBackup(filename: string) {
    if (isProcessing.value) return;

    try {
        isProcessing.value = true;
        await dataManagement.deleteBackup(filename);
        backupList.value = await dataManagement.listBackups();
    } catch (e) {
        console.error("Failed to delete backup:", e);
        const message = e instanceof Error ? e.message : String(e);
        showToast("删除备份失败：" + message, { type: "error" });
    } finally {
        isProcessing.value = false;
    }
}

defineExpose({
    onShowBackups,
});
</script>

<style scoped>
.backup-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.bp-row {
    display: flex;
    gap: 8px;
}

.bp-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 12px 16px;
    border: 0;
    border-radius: 10px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
}

.bp-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.bp-btn.secondary {
    background: var(--hover-bg);
    color: var(--text-color);
}

.bp-btn.secondary:hover:not(:disabled) {
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
</style>
