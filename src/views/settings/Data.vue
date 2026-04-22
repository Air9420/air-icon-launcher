<template>
    <div class="data-settings">
        <div class="section">
            <div class="section-title">数据管理</div>
            <div class="data-management">
                <div class="options-card">
                    <div class="options-title">导出范围</div>
                    <label class="option-item">
                        <input v-model="exportOptions.includeLauncherData" type="checkbox">
                        <span>启动项与分类</span>
                    </label>
                    <label class="option-item">
                        <input v-model="exportOptions.includeSettings" type="checkbox">
                        <span>应用设置</span>
                    </label>
                    <label class="option-item">
                        <input v-model="exportOptions.includePlugins" type="checkbox">
                        <span>插件清单</span>
                    </label>
                    <label class="option-item">
                        <span>导出格式</span>
                        <select v-model="exportOptions.format" class="option-select">
                            <option value="json">JSON</option>
                            <option value="zip">ZIP</option>
                        </select>
                    </label>
                </div>

                <div class="options-card">
                    <div class="options-title">导入方式</div>
                    <label class="option-item">
                        <input v-model="importMergeMode" type="checkbox">
                        <span>合并导入而不是完全覆盖</span>
                    </label>
                </div>

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
                <BackupPanel />
            </div>
        </div>

        <div class="section">
            <div class="section-title">说明</div>
            <div class="note">启动台隐藏后可通过系统托盘左键唤醒窗口。</div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useDataManagement } from "../../composables/useDataManagement";
import BackupPanel from "./BackupPanel.vue";
import { showToast } from "../../composables/useGlobalToast";

const isProcessing = ref<boolean>(false);
const importMergeMode = ref<boolean>(false);
const exportOptions = ref({
    includeLauncherData: true,
    includeSettings: true,
    includePlugins: false,
    format: "json" as "json" | "zip",
});
const dataManagement = useDataManagement();

async function onExportData() {
    if (isProcessing.value) return;

    try {
        isProcessing.value = true;
        const exported = await dataManagement.exportData(exportOptions.value);
        if (exported) {
            showToast("导出成功！", { type: "success" });
        }
    } catch (e) {
        console.error("Failed to export data:", e);
        const message = e instanceof Error ? e.message : String(e);
        showToast("导出失败：" + message, { type: "error" });
    } finally {
        isProcessing.value = false;
    }
}

async function onImportData() {
    if (isProcessing.value) return;

    try {
        isProcessing.value = true;
        const imported = await dataManagement.importData(importMergeMode.value);
        if (imported) {
            showToast("导入成功！", { type: "success" });
            imported.notices.forEach((notice) => {
                showToast(notice, { type: "info", duration: 5000 });
            });
        }
    } catch (e) {
        console.error("Failed to import data:", e);
        const message = e instanceof Error ? e.message : String(e);
        showToast("导入失败：" + message, { type: "error" });
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

.options-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    border-radius: 12px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
}

.options-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-secondary);
}

.option-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    font-size: 13px;
    color: var(--text-secondary);
    -webkit-app-region: no-drag;
}

.option-item input[type="checkbox"] {
    margin-right: auto;
}

.option-select {
    min-width: 96px;
    padding: 6px 10px;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    background: var(--input-bg);
    color: var(--text-color);
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

.note {
    font-size: 12px;
    color: var(--text-tertiary);
    line-height: 1.5;
    -webkit-app-region: no-drag;
}
</style>
