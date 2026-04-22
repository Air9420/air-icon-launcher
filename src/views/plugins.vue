<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { open } from "@tauri-apps/plugin-dialog";
import { getPluginManager, setToastCallback } from "../plugins";
import { setSandboxToastCallback } from "../plugins/sandbox";
import type { Permission } from "../plugins/permissions";
import PluginPermissionDialog from "../components/PluginPermissionDialog.vue";
import { showToast } from "../composables/useGlobalToast";
import { useConfirmDialog } from "../composables/useConfirmDialog";

const router = useRouter();
const pluginManager = getPluginManager();
const { confirm } = useConfirmDialog();

const loading = ref(false);
const pluginDirectory = ref("");
const sandboxMode = ref(true);

const permissionDialog = ref({
    visible: false,
    pluginId: "",
    pluginName: "",
    permissions: [] as Permission[],
});

const {
    pluginList,
    refreshPlugins,
    enablePlugin,
    disablePlugin,
    installPluginFromPath,
    uninstallPlugin,
    getPluginDirectory,
    loadSandboxMode,
    setSandboxMode,
} = pluginManager;

onMounted(async () => {
    setToastCallback((message, type) => showToast(message, { type, duration: 3000 }));
    setSandboxToastCallback((message, type) => showToast(message, { type, duration: 3000 }));
    loading.value = true;
    try {
        sandboxMode.value = await loadSandboxMode();
        pluginDirectory.value = await getPluginDirectory();
        await refreshPlugins();
    } finally {
        loading.value = false;
    }
});

function onBack() {
    router.back();
}

async function onRefresh() {
    loading.value = true;
    try {
        await refreshPlugins();
        showToast("插件列表已刷新", { type: "success" });
    } finally {
        loading.value = false;
    }
}

function wasPluginEnabled(pluginId: string): boolean {
    try {
        const saved = localStorage.getItem('plugin-enabled-state');
        if (!saved) return false;
        const states = JSON.parse(saved);
        return states[pluginId] === true;
    } catch {
        return false;
    }
}

async function onTogglePlugin(pluginId: string, event: Event) {
    const target = event.target as HTMLInputElement;
    const enabled = target.checked;
    
    try {
        if (enabled) {
            const plugin = pluginList.value.find(p => p.manifest.id === pluginId);
            if (!plugin) return;
            
            const hasPermissions = plugin.manifest.permissions && plugin.manifest.permissions.length > 0;
            const wasEnabled = wasPluginEnabled(pluginId);
            
            if (hasPermissions && !wasEnabled) {
                target.checked = false;
                permissionDialog.value = {
                    visible: true,
                    pluginId,
                    pluginName: plugin.manifest.name,
                    permissions: plugin.manifest.permissions as Permission[],
                };
                return;
            }
            
            const success = await enablePlugin(pluginId);
            if (!success) {
                target.checked = false;
                showToast("插件启用失败", { type: "error" });
                return;
            }
            showToast("插件已启用", { type: "success" });
        } else {
            await disablePlugin(pluginId);
            showToast("插件已禁用", { type: "success" });
        }
    } catch (error) {
        target.checked = !enabled;
        showToast(`操作失败: ${error}`, { type: "error" });
    }
}

async function onPermissionConfirm() {
    const { pluginId } = permissionDialog.value;
    permissionDialog.value.visible = false;
    
    const success = await enablePlugin(pluginId);
    if (!success) {
        showToast("插件启用失败", { type: "error" });
        return;
    }
    showToast("插件已启用", { type: "success" });
}

function onPermissionCancel() {
    permissionDialog.value.visible = false;
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
                showToast("插件安装成功", { type: "success" });
                await refreshPlugins();
            } else {
                showToast("插件安装失败", { type: "error" });
            }
        }
    } catch (error) {
        showToast(`安装失败: ${error}`, { type: "error" });
    } finally {
        loading.value = false;
    }
}

async function onToggleSandboxMode(event: Event) {
    const target = event.target as HTMLInputElement;
    const enabled = target.checked;

    if (!enabled) {
        const confirmed = await confirm({
            title: "关闭沙箱模式",
            message: "关闭后，插件将直接在主应用上下文执行，并可运行任意本地代码。只有在完全信任插件来源时才应继续。",
            confirmText: "仍然关闭",
            cancelText: "保持开启",
        });
        if (!confirmed) {
            target.checked = sandboxMode.value;
            return;
        }
    }

    loading.value = true;
    try {
        const result = await setSandboxMode(enabled);
        sandboxMode.value = enabled;

        if (result.failedPluginIds.length > 0) {
            showToast(
                `沙箱模式已更新，但有 ${result.failedPluginIds.length} 个插件重载失败`,
                { type: "error" }
            );
            return;
        }

        if (result.reloadedPluginIds.length > 0) {
            showToast(
                `沙箱模式已更新，已重载 ${result.reloadedPluginIds.length} 个插件`,
                { type: "success" }
            );
            return;
        }

        showToast(
            enabled ? "沙箱模式已启用" : "沙箱模式已关闭",
            { type: enabled ? "success" : "info" }
        );
    } catch (error) {
        target.checked = sandboxMode.value;
        showToast(`更新沙箱模式失败: ${error}`, { type: "error" });
    } finally {
        loading.value = false;
    }
}

async function onUninstall(pluginId: string) {
    const confirmed = await confirm({
        title: "卸载插件",
        message: `确定要卸载插件 "${pluginId}" 吗？`,
        confirmText: "卸载",
        cancelText: "取消",
    });

    if (!confirmed) {
        return;
    }

    try {
        loading.value = true;
        const success = await uninstallPlugin(pluginId);
        if (success) {
            showToast("插件已卸载", { type: "success" });
        } else {
            showToast("卸载失败", { type: "error" });
        }
    } catch (error) {
        showToast(`卸载失败: ${error}`, { type: "error" });
    } finally {
        loading.value = false;
    }
}
</script>

<template>
    <div
        class="plugins-view"
        data-menu-type="Settings-View"
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
                        
                        <div v-if="plugin.manifest.permissions && plugin.manifest.permissions.length > 0" class="plugin-permissions">
                            <span class="permissions-label">权限:</span>
                            <span 
                                v-for="perm in plugin.manifest.permissions" 
                                :key="perm" 
                                class="permission-tag"
                            >
                                {{ perm }}
                            </span>
                        </div>
                        
                        <div class="plugin-footer">
                            <div class="footer-left">
                                <span class="plugin-id">{{ plugin.manifest.id }}</span>
                                <span v-if="plugin.enabled && plugin.sandbox" class="sandbox-badge" title="运行在沙箱隔离环境中">
                                    🔒 沙箱
                                </span>
                                <span v-else-if="plugin.enabled && !plugin.sandbox" class="no-sandbox-badge" title="运行在主应用上下文中">
                                    ⚠️ 非沙箱
                                </span>
                            </div>
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
                <div class="section-title">安全设置</div>
                <div class="sandbox-setting">
                    <label class="check">
                        <input
                            type="checkbox"
                            :checked="sandboxMode"
                            @change="onToggleSandboxMode"
                        />
                        <span>沙箱隔离模式</span>
                    </label>
                    <div class="setting-desc">
                        启用后，插件将在隔离的 iframe 沙箱中运行，无法直接访问主应用上下文。
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
                <div class="section-title">安全提示</div>
                <div v-if="sandboxMode" class="note success">
                    <p>🔒 沙箱隔离模式已启用</p>
                    <p>插件运行在隔离环境中，无法直接访问主应用数据和全局对象。</p>
                </div>
                <div v-else class="note warning">
                    <p>⚠️ 沙箱隔离模式未启用</p>
                    <p>插件运行在主应用上下文中，可能存在安全风险。建议启用沙箱模式。</p>
                </div>
            </div>
        </div>

        <PluginPermissionDialog
            :visible="permissionDialog.visible"
            :plugin-name="permissionDialog.pluginName"
            :permissions="permissionDialog.permissions"
            @confirm="onPermissionConfirm"
            @cancel="onPermissionCancel"
        />
    </div>
</template>

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

.plugin-permissions {
    margin-top: 8px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
}

.permissions-label {
    font-size: 11px;
    color: var(--text-hint);
}

.permission-tag {
    font-size: 10px;
    padding: 2px 6px;
    background: var(--hover-bg);
    border-radius: 4px;
    color: var(--text-secondary);
    font-family: monospace;
}

.plugin-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--border-color);
}

.footer-left {
    display: flex;
    align-items: center;
    gap: 8px;
}

.plugin-id {
    font-size: 11px;
    color: var(--text-tertiary);
    font-family: monospace;
}

.sandbox-badge {
    font-size: 10px;
    padding: 2px 6px;
    background: rgba(105, 219, 124, 0.15);
    color: #69db7c;
    border-radius: 4px;
    border: 1px solid rgba(105, 219, 124, 0.3);
}

.no-sandbox-badge {
    font-size: 10px;
    padding: 2px 6px;
    background: rgba(255, 183, 77, 0.15);
    color: #ffb74d;
    border-radius: 4px;
    border: 1px solid rgba(255, 183, 77, 0.3);
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
    margin-top: 8px;
    font-size: 12px;
    color: var(--text-tertiary);
    line-height: 1.6;
    -webkit-app-region: no-drag;
}

.note.warning {
    color: #ffb74d;
    background: rgba(255, 183, 77, 0.1);
    padding: 10px;
    border-radius: 8px;
}

.note.warning p {
    margin: 4px 0;
}

.note.success {
    color: #69db7c;
    background: rgba(105, 219, 124, 0.1);
    padding: 10px;
    border-radius: 8px;
}

.note.success p {
    margin: 4px 0;
}

.sandbox-setting {
    margin-top: 8px;
}

.sandbox-setting .check {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    -webkit-app-region: no-drag;
}

.sandbox-setting .check input[type="checkbox"] {
    width: 16px;
    height: 16px;
    cursor: pointer;
}

.sandbox-setting .check span {
    font-size: 13px;
    color: var(--text-color);
}

.setting-desc {
    margin-top: 6px;
    font-size: 11px;
    color: var(--text-hint);
    padding-left: 24px;
}
</style>
