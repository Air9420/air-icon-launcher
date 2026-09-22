<script setup lang="ts">
import { onMounted, ref, watch, type Ref } from "vue";
import { open } from "@tauri-apps/plugin-dialog";
import { useCordis } from "../../kernel";
import type {
  PluginHostCommandContribute,
  PluginHostRuntimeInfo,
} from "../../types/plugin-host";
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
/** 已展开详情的插件 id（默认全部折叠） */
const expandedIds = ref<Set<string>>(new Set());
const debugIds = ref<Set<string>>(new Set());

function toggleSet(target: Ref<Set<string>>, id: string): void {
  const next = new Set(target.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  target.value = next;
}

function toggleDetails(id: string): void {
  toggleSet(expandedIds, id);
}

function isExpanded(id: string): boolean {
  return expandedIds.value.has(id);
}

function toggleDebug(id: string): void {
  toggleSet(debugIds, id);
}

function isDebugOpen(id: string): boolean {
  return debugIds.value.has(id);
}

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

/** 把 invoke 返回值压成一行 toast 文案；对象取常见语义字段。 */
function summarizeInvokeResult(method: string, value: unknown): string {
  if (value === null || value === undefined) return `${method}: 无返回`;
  if (typeof value === "string") return `${method}: ${value}`;
  if (typeof value === "number" || typeof value === "boolean") {
    return `${method}: ${String(value)}`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (method === "status" && "proxy_enable" in obj) {
      return obj.proxy_enable === 1 ? "系统代理：已开启" : "系统代理：已关闭";
    }
    try {
      const json = JSON.stringify(value);
      return json.length > 120 ? `${method}: ${json.slice(0, 120)}…` : `${method}: ${json}`;
    } catch {
      return `${method}: 已返回`;
    }
  }
  return `${method}: 已返回`;
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
  showToast(
    enabled ? "插件已启用并加载" : "插件已禁用并卸载",
    { type: "success" },
  );
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

/** 由 manifest `contributes.commands` 发起的插件方法调用；结果用 toast 反馈。 */
async function onInvokeCommand(
  plugin: PluginHostRuntimeInfo,
  command: { id: string; title?: string; method?: string },
) {
  const h = requireHost();
  if (!h) return;
  const method = command.method || command.id;
  const result = await h.invoke(plugin.id, method, {});
  if (result.ok) {
    showToast(summarizeInvokeResult(method, result.value), { type: "success" });
  } else {
    showToast(h.formatError(result.error), { type: "error" });
  }
}

function commandLabel(command: {
  id: string;
  title?: string;
  method?: string;
}): string {
  return command.title || command.method || command.id;
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

function pluginCommands(plugin: PluginHostRuntimeInfo): PluginHostCommandContribute[] {
  return plugin.contributes?.commands ?? [];
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

    <!-- 仅首次/空列表时显示骨架；IPC 忙碌时不卸载列表，避免滚动高度塌缩回顶 -->
    <div v-else-if="plugins.length === 0 && (loading || panelBusy)" class="loading">
      与 Plugin Host 通信中...
    </div>

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
            <label class="switch" :title="plugin.enabled ? '点击禁用并卸载' : '点击启用并加载'">
              <input
                type="checkbox"
                :checked="plugin.enabled"
                :disabled="loading || panelBusy"
                @change="onToggleEnabled(plugin, $event)"
              />
              <span class="slider"></span>
            </label>
            <button
              class="details-toggle"
              type="button"
              :aria-expanded="isExpanded(plugin.id)"
              :title="isExpanded(plugin.id) ? '折叠详情' : '展开详情'"
              @click="toggleDetails(plugin.id)"
            >
              <span class="chevron" :class="{ open: isExpanded(plugin.id) }" aria-hidden="true"></span>
              详情
            </button>
          </div>
        </div>

        <div v-if="isExpanded(plugin.id)" class="plugin-details">
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
        </div>

        <div v-if="plugin.last_error" class="plugin-error">
          {{ plugin.last_error }}
        </div>

        <div class="plugin-footer">
          <div class="footer-main">
            <span class="log-count">日志 {{ plugin.log_count }} 条</span>
            <div class="footer-actions">
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
              <button
                class="mini-btn debug-toggle"
                type="button"
                :aria-expanded="isDebugOpen(plugin.id)"
                @click="toggleDebug(plugin.id)"
              >
                调试
              </button>
            </div>
          </div>
          <div v-if="pluginCommands(plugin).length" class="footer-commands">
            <button
              v-for="cmd in pluginCommands(plugin)"
              :key="cmd.id"
              class="mini-btn command"
              type="button"
              :title="cmd.method || cmd.id"
              :disabled="loading || panelBusy || !plugin.loaded"
              @click="onInvokeCommand(plugin, cmd)"
            >
              {{ commandLabel(cmd) }}
            </button>
          </div>
        </div>

        <div v-if="isDebugOpen(plugin.id)" class="debug-row">
          <span class="debug-hint">手动生命周期（默认由开关自动 load/unload）</span>
          <button
            class="mini-btn"
            type="button"
            :disabled="loading || panelBusy || plugin.loaded"
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
        </div>
      </div>
    </div>

    <div v-if="lastError" class="host-error">
      <div class="host-error-title">最近 Host 错误</div>
      <div class="host-error-body">{{ fmtError(lastError) }}</div>
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

.plugin-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.details-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid var(--border-color-strong);
  background: transparent;
  cursor: pointer;
  -webkit-app-region: no-drag;
  font-size: 11px;
  color: var(--text-secondary);
}

.details-toggle:hover {
  background: var(--hover-bg);
  color: var(--text-color);
}

.chevron {
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 5px solid currentColor;
  transition: transform 0.15s ease;
}

.chevron.open {
  transform: rotate(180deg);
}

.plugin-details {
  margin-top: 8px;
  padding-top: 4px;
  border-top: 1px dashed var(--border-color);
}

.plugin-description {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 6px;
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
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border-color);
}

/* 第一行：日志计数 + 固定按钮（日志/删除/调试），始终同一行 */
.footer-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: nowrap;
  min-width: 0;
}

.log-count {
  font-size: 11px;
  color: var(--text-tertiary);
  flex-shrink: 0;
  white-space: nowrap;
}

.footer-actions {
  display: flex;
  flex-wrap: nowrap;
  gap: 6px;
  align-items: center;
  justify-content: flex-end;
  flex-shrink: 1;
  min-width: 0;
  margin-left: auto;
}

/* 第二行：蓝色命令按钮，允许换行 */
.footer-commands {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  width: 100%;
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

.mini-btn.command {
  border-color: var(--primary-color);
  color: var(--primary-color);
}

.mini-btn.command:hover:not(:disabled) {
  background: var(--primary-bg);
}

.mini-btn.debug-toggle {
  color: var(--text-tertiary);
}

.debug-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--border-color);
}

.debug-hint {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-right: 4px;
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
.event-title,
.logs-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.host-error-body,
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
