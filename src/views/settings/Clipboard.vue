<template>
    <div class="clipboard-settings">
        <div class="section">
            <div class="section-title">剪贴板</div>

            <div class="clipboard-setting-row">
                <span class="setting-label">最大记录数</span>
                <div class="segmented small-segmented" :class="{ disabled: !clipboardConfigLoaded }">
                    <button class="seg-btn" type="button"
                        :class="{ active: clipboardConfigLoaded && clipboardMaxRecords === 50 }"
                        :disabled="!clipboardConfigLoaded" @click="onSetClipboardMaxRecords(50)">
                        50
                    </button>
                    <button class="seg-btn" type="button"
                        :class="{ active: clipboardConfigLoaded && clipboardMaxRecords === 100 }"
                        :disabled="!clipboardConfigLoaded" @click="onSetClipboardMaxRecords(100)">
                        100
                    </button>
                    <button class="seg-btn" type="button"
                        :class="{ active: clipboardConfigLoaded && clipboardMaxRecords === 200 }"
                        :disabled="!clipboardConfigLoaded" @click="onSetClipboardMaxRecords(200)">
                        200
                    </button>
                    <button class="seg-btn" type="button"
                        :class="{ active: clipboardConfigLoaded && clipboardMaxRecords === 0 }"
                        :disabled="!clipboardConfigLoaded" @click="onSetClipboardMaxRecords(0)">
                        无限
                    </button>
                </div>
            </div>
            <div class="clipboard-setting-row">
                <span class="setting-label">图片大小限制</span>
                <div class="segmented small-segmented" :class="{ disabled: !clipboardConfigLoaded }">
                    <button class="seg-btn" type="button"
                        :class="{ active: clipboardConfigLoaded && clipboardMaxImageSize === 0.5 }"
                        :disabled="!clipboardConfigLoaded" @click="onSetClipboardMaxImageSize(0.5)">
                        0.5MB
                    </button>
                    <button class="seg-btn" type="button"
                        :class="{ active: clipboardConfigLoaded && clipboardMaxImageSize === 1 }"
                        :disabled="!clipboardConfigLoaded" @click="onSetClipboardMaxImageSize(1)">
                        1MB
                    </button>
                    <button class="seg-btn" type="button"
                        :class="{ active: clipboardConfigLoaded && clipboardMaxImageSize === 2 }"
                        :disabled="!clipboardConfigLoaded" @click="onSetClipboardMaxImageSize(2)">
                        2MB
                    </button>
                    <button class="seg-btn" type="button"
                        :class="{ active: clipboardConfigLoaded && clipboardMaxImageSize === 5 }"
                        :disabled="!clipboardConfigLoaded" @click="onSetClipboardMaxImageSize(5)">
                        5MB
                    </button>
                </div>
            </div>

            <div class="clipboard-setting-row" style="margin-top: 12px;">
                <span class="setting-label">存储目录</span>
                <div class="storage-path-display">
                    <span class="path-text">{{ clipboardStoragePath || '默认位置' }}</span>
                    <button class="path-btn" type="button" @click="onSelectStoragePath"
                        :disabled="!clipboardConfigLoaded || isProcessing || isMigrating">
                        选择
                    </button>
                    <button class="path-btn" type="button" @click="onResetStoragePath"
                        :disabled="isProcessing || isMigrating">
                        默认
                    </button>
                </div>
            </div>
            <div class="action-buttons">
                <button class="action-btn" type="button" @click="onOpenClipboardHistory">
                    剪贴板历史
                </button>
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
    </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { invokeOrThrow } from "../../utils/invoke-wrapper";
import { open } from "@tauri-apps/plugin-dialog";
import { useClipboardStore } from "../../stores/clipboardStore";
import { useRouter } from "vue-router";
import { showToast } from "../../composables/useGlobalToast";

const router = useRouter();
const clipboardStore = useClipboardStore();

function onOpenClipboardHistory() {
    router.push("/clipboard");
}

const clipboardMaxRecords = ref<number>(100);
const clipboardMaxImageSize = ref<number>(1);
const clipboardStoragePath = ref<string>("");
const clipboardConfigLoaded = ref<boolean>(false);
const isProcessing = ref<boolean>(false);
const isMigrating = ref<boolean>(false);
const migrationProgress = ref<number>(0);
onMounted(async () => {
    await loadClipboardConfig();
});

async function loadClipboardConfig() {
    clipboardConfigLoaded.value = false;
    try {
        const config = await invokeOrThrow<{
            max_records: number;
            max_image_size_mb: number;
            storage_path: string | null;
        }>("get_clipboard_config");
        clipboardMaxRecords.value = config.max_records;
        clipboardStore.setMaxRecords(config.max_records);
        clipboardMaxImageSize.value = config.max_image_size_mb;
        clipboardStoragePath.value = config.storage_path || "";
    } catch (e) {
        console.error("Failed to load clipboard config:", e);
    } finally {
        clipboardConfigLoaded.value = true;
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

async function onSetClipboardMaxRecords(value: number) {
    const prev = clipboardMaxRecords.value;
    clipboardMaxRecords.value = value;
    clipboardStore.setMaxRecords(value);
    try {
        const config = await invokeOrThrow<{
            max_records: number;
            max_image_size_mb: number;
            storage_path: string | null;
        }>("set_clipboard_config", {
            patch: { max_records: value },
        });
        clipboardMaxRecords.value = config.max_records;
        clipboardStore.setMaxRecords(config.max_records);
        clipboardMaxImageSize.value = config.max_image_size_mb;
    } catch (e) {
        console.error("Failed to set clipboard max records:", e);
        clipboardMaxRecords.value = prev;
        clipboardStore.setMaxRecords(prev);
        showToast("设置失败：" + (e instanceof Error ? e.message : String(e)), { type: "error" });
    }
}

async function onSetClipboardMaxImageSize(value: number) {
    const prev = clipboardMaxImageSize.value;
    clipboardMaxImageSize.value = value;
    try {
        const config = await invokeOrThrow<{
            max_records: number;
            max_image_size_mb: number;
            storage_path: string | null;
        }>("set_clipboard_config", {
            patch: { max_image_size_mb: value },
        });
        clipboardMaxRecords.value = config.max_records;
        clipboardStore.setMaxRecords(config.max_records);
        clipboardMaxImageSize.value = config.max_image_size_mb;
    } catch (e) {
        console.error("Failed to set clipboard max image size:", e);
        clipboardMaxImageSize.value = prev;
        showToast("设置失败：" + (e instanceof Error ? e.message : String(e)), { type: "error" });
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

                await invokeOrThrow("set_clipboard_storage_path", { path: filePath });

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
</script>

<style scoped>
.clipboard-settings {
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

.action-buttons {
    margin-bottom: 12px;
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

.segmented {
    display: flex;
    gap: 8px;
}

.segmented.disabled {
    opacity: 0.6;
}

.small-segmented .seg-btn {
    padding: 6px 12px;
    font-size: 12px;
    white-space: nowrap;
}

.clipboard-setting-row .segmented {
    flex-wrap: nowrap;
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

.seg-btn:disabled {
    cursor: not-allowed;
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

.hint {
    margin-top: 8px;
    font-size: 12px;
    color: var(--text-hint);
    -webkit-app-region: no-drag;
}
</style>
