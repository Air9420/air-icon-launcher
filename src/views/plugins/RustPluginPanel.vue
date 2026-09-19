<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { open } from "@tauri-apps/plugin-dialog";
import { useCordis } from "../../kernel";
import type { PluginHostRuntimeInfo } from "../../types/plugin-host";
import type { AppError } from "../../utils/invoke-wrapper";
import { showToast } from "../../composables/useGlobalToast";
import { useConfirmDialog } from "../../composables/useConfirmDialog";

const ctx = useCordis();
const host = ctx.pluginHost;
const { confirm } = useConfirmDialog();

const plugins = host?.plugins ?? ref<PluginHostRuntimeInfo[]>([]);
const loading = host?.loading ?? ref(false);
const lastError = host?.lastError ?? ref<AppError | null>(null);
const hostEvents = host?.hostEvents ?? ref<
  { plugin_id: string; event: string; payload: unknown }[]
>([]);

const hostMissing = !host;
const panelBusy = ref(false);
const logsOpen = ref(false);
const logsPluginId = ref("");
const logs = ref<string[]>([]);
const invokePluginId = ref("");
const invokeResultText = ref("");
const invokeFailed = ref(false);

onMounted(async () => {
  if (!host) return;
  const result = await host.refresh();
  if (!result.ok) {
    showToast(host.formatError(result.error), { type: "error" });
  }
});

watch(hostEvents, async () => {
  if (!host || !logsOpen.value || !logsPluginId.value) return;
  const result = await host.getLog(logsPluginId.value);
  if (result.ok) logs.value = result.value;
});

function requireHost() {
  if (!host) {
    showToast("PluginHostService 未注册（ctx.pluginHost 缺失）", { type: "error" });
    return null;
  }
  return host;
}

function fmtError(error: AppError | null | undefined): string {
  return host?.formatError(error) ?? "";
}

function fmtValue(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function onRefresh() {
  const h = requireHost();
  if (!h) return;
  panelBusy.value = true;
  try {
    const result = await h.refresh();
    if (result.ok) {
      showToast("Rust 插件列表已刷新", { type: "success" });
    } else {
      showToast(h.formatError(result.error), { type: "error" });
    }
  } finally {
    panelBusy.value = false;
  }
}

async function onToggleEnabled(plugin: PluginHostRuntimeInfo, event: Event) {
  const h = requireHost();
  if (!h) return;
  const target = event.target as HTMLInputElement;
  const enabled = target.checked;
  const result = await h.setEnabled(plugin.id, enabled);
  if (!result.ok) {
    target.checked = !enabled;
    showToast(h.formatError(result.error), { type: "error" });
    return;
  }
  showToast(enabled ? "插件已启用" : "插件已禁用", { type: "success" });
}

async function onLoad(plugin: PluginHostRuntimeInfo) {
  const h = requireHost();
  if (!h) return;
  const result = await h.load(plugin.id);
  if (result.ok) {
    showToast(`已加载 ${plugin.id}`, { type: "success" });
  } else {
    showToast(h.formatError(result.error), { type: "error" });
  }
}

async function onUnload(plugin: PluginHostRuntimeInfo) {
  const h = requireHost();
  if (!h) return;
  const result = await h.unload(plugin.id);
  if (result.ok) {
    showToast(`已卸载 ${plugin.id}`, { type: "success" });
  } else {
    showToast(h.formatError(result.error), { type: "error" });
  }
}

async function onInvokeHello(plugin: PluginHostRuntimeInfo) {
  const h = requireHost();
  if (!h) return;
  invokePluginId.value = plugin.id;
  invokeResultText.value = "";
  invokeFailed.value = false;
  const result = await h.invoke(plugin.id, "hello", { name: "Air" });
  if (result.ok) {
    invokeResultText.value = fmtValue(result.value);
    showToast("调用成功", { type: "success" });
  } else {
    invokeFailed.value = true;
    invokeResultText.value = fmtError(result.error);
    showToast(h.formatError(result.error), { type: "error" });
  }
}

async function onShowLogs(plugin: PluginHostRuntimeInfo) {
  const h = requireHost();
  if (!h) return;
  logsPluginId.value = plugin.id;
  logsOpen.value = true;
  logs.value = [];
  const result = await h.getLog(plugin.id);
  if (result.ok) {
    logs.value = result.value;
  } else {
    showToast(h.formatError(result.error), { type: "error" });
  }
}

function onCloseLogs() {
  logsOpen.value = false;
  logsPluginId.value = "";
  logs.value = [];
}

async function onInstallFromFolder() {
  const h = requireHost();
  if (!h) return;
  try {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "选择 Rust 插件文件夹（含 manifest.json v2）",
    });
    if (!selected) return;
    panelBusy.value = true;
    const result = await h.install(selected as string);
    if (result.ok) {
      showToast(`已安装 ${result.value.id}`, { type: "success" });
      await h.refresh();
    } else {
      showToast(h.formatError(result.error), { type: "error" });
    }
  } catch (error) {
    showToast(`安装失败: ${error}`, { type: "error" });
  } finally {
    panelBusy.value = false;
  }
}

async function onUninstall(plugin: PluginHostRuntimeInfo) {
  const h = requireHost();
  if (!h) return;
  const confirmed = await confirm({
    title: "卸载 Rust 插件",
    message: `确定要卸载插件 "${plugin.id}" 吗？插件目录将被删除。`,
    confirmText: "卸载",
    cancelText: "取消",
  });
  if (!confirmed) return;
  const result = await h.uninstall(plugin.id);
  if (result.ok) {
    showToast("插件已卸载", { type: "success" });
  } else {
    showToast(h.formatError(result.error), { type: "error" });
  }
}

function capList(plugin: PluginHostRuntimeInfo): string {
  return plugin.capabilities?.length ? plugin.capabilities.join(", ") : "（无）";
}

function commandList(plugin: PluginHostRuntimeInfo): string {
  const cmds = plugin.contributes?.commands ?? [];
  return cmds.length ? cmds.map((c) => c.id).join(", ") : "—";
}
</script>

<template>
  <div class="rust-panel">
    <div class="section-header">
      <div class="section-title-group">
        <div class="section-title">Rust 能力插件</div>
        <div class="section-subtitle">
          Plugin Host · manifest v2 · runtime=rust
          <span class="reserved-hint">Worker JS 运行时已预留，本包未实现</span>
        </div>
      </div>
      <div class="section-actions">
        <button
          class="action-btn"
          type="button"
          :disabled="loading || panelBusy || hostMissing"
          @click="onRefresh"
        >
          扫描 / 刷新
        </button>
        <button
          class="action-btn primary"
          type="button"
          :disabled="loading || panelBusy || hostMissing"
          @click="onInstallFromFolder"
        >
          从文件夹安装
        </button>
      </div>
    </div>

    <div v-if="hostMissing" class="empty">
      ctx.pluginHost 未注册，请检查 kernel bootstrap。
    </div>

    <div v-else-if="loading || panelBusy" class="loading">与 Plugin Host 通信中...</div>

    <div v-else-if="plugins.length === 0" class="empty">
      暂无 Rust 能力插件。可将含 manifest.json v2 的插件目录通过「从文件夹安装」导入。
    </div>

    <div v-else class="plugin-list">
      <div v-for="plugin in plugins" :key="plugin.id" class="plugin-card">
        <div class="plugin-header">
          <div class="plugin-icon">
            {{ (plugin.name || plugin.id).charAt(0).toUpperCase() }}
          </div>
          <div class="plugin-info">
            <div class="plugin-name">
              {{ plugin.name }}
              <span class="runtime-badge">{{ plugin.runtime }}</span>
              <span v-if="plugin.loaded" class="status-badge loaded">已加载</span>
              <span v-else class="status-badge">未加载</span>
            </div>
            <div class="plugin-meta">
              <span class="version">v{{ plugin.version }}</span>
              <span v-if="plugin.author" class="author">{{ plugin.author }}</span>
              <span class="plugin-id">{{ plugin.id }}</span>
            </div>
          </div>
          <div class="plugin-actions">
            <label class="switch" :title="plugin.enabled ? '点击禁用' : '点击启用'">
              <input
                type="checkbox"
                :checked="plugin.enabled"
                :disabled="loading || panelBusy"
                @change="onToggleEnabled(plugin, $event)"
              />
              <span class="slider"></span>
            </label>
          </div>
        </div>

        <div v-if="plugin.description" class="plugin-description">
          {{ plugin.description }}
        </div>

        <div class="kv-row">
          <span class="kv-label">capabilities</span>
          <span class="kv-value caps">{{ capList(plugin) }}</span>
        </div>
        <div class="kv-row">
          <span class="kv-label">commands</span>
          <span class="kv-value">{{ commandList(plugin) }}</span>
        </div>
        <div class="kv-row">
          <span class="kv-label">entry</span>
          <span class="kv-value mono">{{ plugin.entry }}</span>
        </div>

        <div v-if="plugin.last_error" class="plugin-error">
          {{ plugin.last_error }}
        </div>

        <div class="plugin-footer">
          <div class="footer-left">
            <span class="log-count">日志 {{ plugin.log_count }} 条</span>
          </div>
          <div class="footer-actions">
            <button
              class="mini-btn"
              type="button"
              :disabled="loading || panelBusy"
              @click="onLoad(plugin)"
            >
              加载
            </button>
            <button
              class="mini-btn"
              type="button"
              :disabled="loading || panelBusy || !plugin.loaded"
              @click="onUnload(plugin)"
            >
              卸载
            </button>
            <button
              class="mini-btn"
              type="button"
              :disabled="loading || panelBusy || !plugin.loaded"
              @click="onInvokeHello(plugin)"
            >
              调用 hello
            </button>
            <button
              class="mini-btn"
              type="button"
              :disabled="loading || panelBusy"
              @click="onShowLogs(plugin)"
            >
              日志
            </button>
            <button
              class="mini-btn danger"
              type="button"
              :disabled="loading || panelBusy"
              @click="onUninstall(plugin)"
            >
              删除
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="lastError" class="host-error">
      <div class="host-error-title">最近 Host 错误</div>
      <div class="host-error-body">{{ fmtError(lastError) }}</div>
    </div>

    <div v-if="invokePluginId" class="invoke-result">
      <div class="invoke-title">
        invoke · {{ invokePluginId }} · hello
        <span v-if="invokeFailed" class="invoke-fail-tag">失败</span>
        <span v-else class="invoke-ok-tag">成功</span>
      </div>
      <pre class="invoke-body">{{ invokeResultText }}</pre>
    </div>

    <div v-if="hostEvents.length" class="event-feed">
      <div class="event-title">Host 事件（最近 {{ hostEvents.length }}）</div>
      <div v-for="(ev, idx) in hostEvents" :key="idx" class="event-line">
        <span class="event-plugin">{{ ev.plugin_id }}</span>
        <span class="event-name">{{ ev.event }}</span>
        <span class="event-payload">{{ fmtValue(ev.payload) }}</span>
      </div>
    </div>

    <div v-if="logsOpen" class="logs-panel">
      <div class="logs-header">
        <div class="logs-title">日志 · {{ logsPluginId }}</div>
        <button class="mini-btn" type="button" @click="onCloseLogs">关闭</button>
      </div>
      <div v-if="logs.length === 0" class="empty logs-empty">暂无日志</div>
      <pre v-else class="logs-body">{{ logs.join("\n") }}</pre>
    </div>
  </div>
</template>

<style scoped>
.rust-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 4px;
}

.section-title-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.section-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-secondary);
}

.section-subtitle {
  font-size: 11px;
  color: var(--text-hint);
}

.reserved-hint {
  margin-left: 8px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--hover-bg);
  color: var(--text-tertiary);
}

.section-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.action-btn {
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

.action-btn:hover:not(:disabled) {
  background: var(--hover-bg);
}

.action-btn.primary {
  border-color: var(--primary-color);
  color: var(--primary-color);
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.loading,
.empty {
  text-align: center;
  padding: 24px;
  color: var(--text-hint);
  font-size: 13px;
}

.logs-empty {
  padding: 12px;
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
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--primary-bg);
  color: var(--primary-color);
  font-weight: 700;
  font-size: 18px;
  flex-shrink: 0;
}

.plugin-info {
  flex: 1;
  min-width: 0;
}

.plugin-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-color);
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.runtime-badge,
.status-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 500;
}

.runtime-badge {
  background: var(--hover-bg);
  color: var(--text-secondary);
  font-family: monospace;
}

.status-badge {
  background: var(--hover-bg);
  color: var(--text-hint);
}

.status-badge.loaded {
  background: rgba(105, 219, 124, 0.15);
  color: #69db7c;
}

.plugin-meta {
  display: flex;
  flex-wrap: wrap;
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

.plugin-id {
  font-family: monospace;
  color: var(--text-tertiary);
}

.plugin-description {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 8px;
  line-height: 1.4;
}

.kv-row {
  display: flex;
  gap: 8px;
  margin-top: 6px;
  font-size: 11px;
  align-items: baseline;
}

.kv-label {
  color: var(--text-hint);
  min-width: 80px;
  flex-shrink: 0;
  font-family: monospace;
}

.kv-value {
  color: var(--text-secondary);
  word-break: break-all;
}

.kv-value.mono {
  font-family: monospace;
}

.kv-value.caps {
  font-family: monospace;
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
  gap: 8px;
  flex-wrap: wrap;
}

.footer-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.log-count {
  font-size: 11px;
  color: var(--text-tertiary);
}

.footer-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.mini-btn {
  height: 24px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid var(--border-color-strong);
  background: transparent;
  cursor: pointer;
  -webkit-app-region: no-drag;
  font-size: 11px;
  color: var(--text-color);
}

.mini-btn:hover:not(:disabled) {
  background: var(--hover-bg);
}

.mini-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.mini-btn.danger {
  border-color: var(--error-color);
  color: var(--error-color);
}

.mini-btn.danger:hover:not(:disabled) {
  background: var(--error-bg);
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

input:disabled + .slider {
  opacity: 0.5;
  cursor: not-allowed;
}

.host-error,
.invoke-result,
.event-feed,
.logs-panel {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 12px;
}

.host-error {
  border-color: var(--error-color);
}

.host-error-title,
.invoke-title,
.event-title,
.logs-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.host-error-body,
.invoke-body,
.logs-body {
  font-size: 11px;
  font-family: monospace;
  color: var(--error-color);
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 180px;
  overflow: auto;
}

.invoke-body {
  color: var(--text-secondary);
}

.invoke-fail-tag {
  margin-left: 8px;
  color: var(--error-color);
  font-weight: 500;
}

.invoke-ok-tag {
  margin-left: 8px;
  color: #69db7c;
  font-weight: 500;
}

.event-line {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 11px;
  font-family: monospace;
  color: var(--text-tertiary);
  padding: 4px 0;
  border-bottom: 1px solid var(--border-color);
}

.event-line:last-child {
  border-bottom: 0;
}

.event-plugin {
  color: var(--primary-color);
}

.event-name {
  color: var(--text-secondary);
}

.event-payload {
  color: var(--text-hint);
  word-break: break-all;
}

.logs-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.logs-body {
  color: var(--text-secondary);
  max-height: 220px;
}
</style>
