<template>
    <div
        class="plugins-view"
        data-menu-type="categorie-view"
        data-tauri-drag-region
    >
        <header class="plugins-header" data-tauri-drag-region>
            <button
                class="back-btn"
                type="button"
                @click="onBack"
                @mousedown.stop
            >
                返回
            </button>
            <div class="title" data-tauri-drag-region>插件管理</div>
            <button
                class="refresh-btn"
                type="button"
                @click="onRefresh"
                @mousedown.stop
            >
                刷新
            </button>
        </header>

        <div class="content">
            <div class="section">
                <div class="section-header">
                    <div class="section-title">已安装插件</div>
                    <button class="install-btn" type="button" @click="onInstallFromFolder">
                        从文件夹安装
                    </button>
                </div>
                
                <div v-if="loading" class="loading">
                    加载中...
                </div>
                
                <div v-else-if="pluginList.length === 0" class="empty">
                    暂无已安装的插件
                </div>
                
                <div v-else class="plugin-list">
                    <div
                        v-for="plugin in pluginList"
                        :key="plugin.manifest.id"
                        class="plugin-card"
                    >
                        <div class="plugin-header">
                            <div class="plugin-icon" v-if="plugin.manifest.icon">
                                <img :src="plugin.manifest.icon" :alt="plugin.manifest.name" />
                            </div>
                            <div class="plugin-icon default" v-else>
                                {{ plugin.manifest.name.charAt(0).toUpperCase() }}
                            </div>
                            <div class="plugin-info">
                                <div class="plugin-name">{{ plugin.manifest.name }}</div>
                                <div class="plugin-meta">
                                    <span class="version">v{{ plugin.manifest.version }}</span>
                                    <span class="author">{{ plugin.manifest.author }}</span>
                                </div>
                            </div>
                            <div class="plugin-actions">
                                <label class="switch">
                                    <input
                                        type="checkbox"
                                        :checked="plugin.enabled"
                                        @change="onTogglePlugin(plugin.manifest.id, $event)"
                                    />
                                    <span class="slider"></span>
                                </label>
                            </div>
                        </div>
                        
                        <div class="plugin-description">
                            {{ plugin.manifest.description }}
                        </div>
                        
                        <div v-if="plugin.error" class="plugin-error">
                            {{ plugin.error }}
                        </div>
                        
                        <div class="plugin-footer">
                            <span class="plugin-id">{{ plugin.manifest.id }}</span>
                            <button
                                class="uninstall-btn"
                                type="button"
                                @click="onUninstall(plugin.manifest.id)"
                            >
                                卸载
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div class="section">
                <div class="section-title">插件目录</div>
                <div class="hint">
                    插件目录位置: {{ pluginDirectory || '加载中...' }}
                </div>
                <div class="hint">
                    您可以将插件文件夹放入该目录，然后点击"刷新"按钮扫描新插件。
                </div>
            </div>

            <div class="section">
                <div class="section-title">开发插件</div>
                <div class="note">
                    <p>插件开发指南：</p>
                    <ol>
                        <li>创建一个新文件夹，包含 manifest.json 和 main.js</li>
                        <li>manifest.json 定义插件元数据</li>
                        <li>main.js 导出 activate 和 deactivate 函数</li>
                        <li>将文件夹放入插件目录即可安装</li>
                    </ol>
                </div>
            </div>
        </div>

        <div v-if="toast.visible" class="toast" :class="toast.type">
            {{ toast.message }}
        </div>
    </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { open } from "@tauri-apps/plugin-dialog";
import { getPluginManager, setToastCallback } from "../plugins";

const router = useRouter();
const pluginManager = getPluginManager();

const loading = ref(false);
const pluginDirectory = ref("");
const toast = ref({
    visible: false,
    message: "",
    type: "info" as "info" | "success" | "error",
});

const { pluginList, refreshPlugins, enablePlugin, disablePlugin, installPluginFromPath, uninstallPlugin, getPluginDirectory } = pluginManager;

onMounted(async () => {
    setToastCallback(showToast);
    loading.value = true;
    try {
        pluginDirectory.value = await getPluginDirectory();
        await refreshPlugins();
    } finally {
        loading.value = false;
    }
});

function onBack() {
    router.push("/settings");
}

async function onRefresh() {
    loading.value = true;
    try {
        await refreshPlugins();
        showToast("插件列表已刷新", "success");
    } finally {
        loading.value = false;
    }
}

async function onTogglePlugin(pluginId: string, event: Event) {
    const target = event.target as HTMLInputElement;
    const enabled = target.checked;
    
    try {
        if (enabled) {
            const success = await enablePlugin(pluginId);
            if (!success) {
                target.checked = false;
                showToast("插件启用失败", "error");
                return;
            }
            showToast("插件已启用", "success");
        } else {
            await disablePlugin(pluginId);
            showToast("插件已禁用", "success");
        }
    } catch (error) {
        target.checked = !enabled;
        showToast(`操作失败: ${error}`, "error");
    }
}

async function onInstallFromFolder() {
    try {
        const selected = await open({
            directory: true,
            multiple: false,
            title: "选择插件文件夹",
        });

        if (selected) {
            loading.value = true;
            const success = await installPluginFromPath(selected as string);
            if (success) {
                showToast("插件安装成功", "success");
                await refreshPlugins();
            } else {
                showToast("插件安装失败", "error");
            }
        }
    } catch (error) {
        showToast(`安装失败: ${error}`, "error");
    } finally {
        loading.value = false;
    }
}

async function onUninstall(pluginId: string) {
    if (!confirm(`确定要卸载插件 "${pluginId}" 吗？`)) {
        return;
    }

    try {
        loading.value = true;
        const success = await uninstallPlugin(pluginId);
        if (success) {
            showToast("插件已卸载", "success");
        } else {
            showToast("卸载失败", "error");
        }
    } catch (error) {
        showToast(`卸载失败: ${error}`, "error");
    } finally {
        loading.value = false;
    }
}

function showToast(message: string, type: "info" | "success" | "error" = "info") {
    toast.value = { visible: true, message, type };
    setTimeout(() => {
        toast.value.visible = false;
    }, 3000);
}
</script>

<style scoped>
.plugins-view {
    width: 100vw;
    height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg-color);
}

.plugins-header {
    height: 52px;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 12px;
    background: var(--card-bg);
    border-bottom: 1px solid var(--border-color);
    backdrop-filter: var(--backdrop-blur);
}

.back-btn,
.refresh-btn {
    border: 0;
    padding: 8px 10px;
    border-radius: 10px;
    background: var(--hover-bg);
    cursor: pointer;
    -webkit-app-region: no-drag;
    color: var(--text-color);
}

.back-btn:hover,
.refresh-btn:hover {
    background: var(--hover-bg-strong);
}

.title {
    flex: 1;
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

.section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
}

.section-title {
    font-size: 13px;
    font-weight: 700;
    color: var(--text-secondary);
}

.install-btn {
    height: 28px;
    padding: 0 12px;
    border-radius: 8px;
    border: 1px solid var(--border-color-strong);
    background: var(--input-bg);
    cursor: pointer;
    -webkit-app-region: no-drag;
    font-size: 12px;
    color: var(--text-color);
}

.install-btn:hover {
    background: var(--hover-bg);
}

.loading,
.empty {
    text-align: center;
    padding: 24px;
    color: var(--text-hint);
    font-size: 13px;
}

.plugin-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.plugin-card {
    background: var(--input-bg);
    border: 1px solid var(--border-color-strong);
    border-radius: 12px;
    padding: 12px;
}

.plugin-header {
    display: flex;
    align-items: center;
    gap: 12px;
}

.plugin-icon {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--primary-bg);
    color: var(--primary-color);
    font-weight: 700;
    font-size: 18px;
}

.plugin-icon img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.plugin-info {
    flex: 1;
}

.plugin-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-color);
}

.plugin-meta {
    display: flex;
    gap: 8px;
    font-size: 11px;
    color: var(--text-hint);
    margin-top: 2px;
}

.version {
    background: var(--hover-bg);
    padding: 1px 6px;
    border-radius: 4px;
}

.plugin-actions {
    display: flex;
    align-items: center;
}

.switch {
    position: relative;
    display: inline-block;
    width: 44px;
    height: 24px;
}

.switch input {
    opacity: 0;
    width: 0;
    height: 0;
}

.slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: var(--border-color-strong);
    transition: 0.3s;
    border-radius: 24px;
}

.slider:before {
    position: absolute;
    content: "";
    height: 18px;
    width: 18px;
    left: 3px;
    bottom: 3px;
    background-color: white;
    transition: 0.3s;
    border-radius: 50%;
}

input:checked + .slider {
    background-color: var(--primary-color);
}

input:checked + .slider:before {
    transform: translateX(20px);
}

.plugin-description {
    font-size: 12px;
    color: var(--text-secondary);
    margin-top: 8px;
    line-height: 1.4;
}

.plugin-error {
    margin-top: 8px;
    padding: 8px;
    background: var(--error-bg);
    border-radius: 6px;
    font-size: 11px;
    color: var(--error-color);
}

.plugin-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--border-color);
}

.plugin-id {
    font-size: 11px;
    color: var(--text-tertiary);
    font-family: monospace;
}

.uninstall-btn {
    height: 24px;
    padding: 0 10px;
    border-radius: 6px;
    border: 1px solid var(--error-color);
    background: transparent;
    cursor: pointer;
    -webkit-app-region: no-drag;
    font-size: 11px;
    color: var(--error-color);
}

.uninstall-btn:hover {
    background: var(--error-bg);
}

.hint {
    margin-top: 8px;
    font-size: 12px;
    color: var(--text-hint);
    -webkit-app-region: no-drag;
}

.note {
    font-size: 12px;
    color: var(--text-tertiary);
    line-height: 1.6;
    -webkit-app-region: no-drag;
}

.note ol {
    margin: 8px 0 0 16px;
    padding: 0;
}

.note li {
    margin: 4px 0;
}

.toast {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    padding: 10px 20px;
    border-radius: 10px;
    font-size: 13px;
    color: white;
    z-index: 1000;
    animation: fadeIn 0.3s ease;
}

.toast.info {
    background: var(--primary-color);
}

.toast.success {
    background: #22c55e;
}

.toast.error {
    background: #ef4444;
}

@keyframes fadeIn {
    from {
        opacity: 0;
        transform: translateX(-50%) translateY(10px);
    }
    to {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
    }
}
</style>
