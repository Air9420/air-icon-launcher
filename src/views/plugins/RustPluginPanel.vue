<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { open } from "@tauri-apps/plugin-dialog";
import { useCordis } from "../../kernel";
import type { PluginHostRuntimeInfo } from "../../types/plugin-host";
import type { AppError } from "../../utils/invoke-wrapper";
import { showToast } from "../../composables/useGlobalToast";

const ctx = useCordis();
const host = ctx.pluginHost;
const router = useRouter();

const plugins = host?.plugins ?? ref<PluginHostRuntimeInfo[]>([]);
const loading = host?.loading ?? ref(false);
const lastError = host?.lastError ?? ref<AppError | null>(null);

const hostMissing = !host;
const busy = ref(false);

const runningCount = computed(() => plugins.value.filter((p) => p.loaded).length);

onMounted(async () => {
  if (!host) return;
  const result = await host.refresh();
  if (!result.ok) showToast(host.formatError(result.error), { type: "error" });
});

function fmtError(e: AppError | null | undefined): string {
  return host?.formatError(e) ?? "";
}

async function onRefresh() {
  if (!host) return;
  busy.value = true;
  try {
    const r = await host.refresh();
    if (!r.ok) showToast(host.formatError(r.error), { type: "error" });
  } finally {
    busy.value = false;
  }
}

async function onInstall() {
  if (!host) return;
  try {
    const dir = await open({
      directory: true,
      multiple: false,
      title: "选择插件文件夹（含 manifest.json v2）",
    });
    if (!dir) return;
    busy.value = true;
    const r = await host.install(dir as string);
    if (r.ok) {
      showToast(`已安装 ${r.value.id}`, { type: "success" });
      await host.refresh();
    } else {
      showToast(host.formatError(r.error), { type: "error" });
    }
  } catch (e) {
    showToast(`安装失败: ${e}`, { type: "error" });
  } finally {
    busy.value = false;
  }
}

async function onToggle(plugin: PluginHostRuntimeInfo, ev: Event) {
  if (!host) return;
  const el = ev.target as HTMLInputElement;
  const enabled = el.checked;
  const r = await host.setEnabled(plugin.id, enabled);
  if (!r.ok) {
    el.checked = !enabled;
    showToast(host.formatError(r.error), { type: "error" });
    return;
  }
  showToast(enabled ? `${plugin.name} 已启用` : `${plugin.name} 已停用`, { type: "success" });
}

function openDetail(plugin: PluginHostRuntimeInfo) {
  router.push({ name: "plugin-detail", params: { pluginId: plugin.id } });
}

/** 概要信息：能力数 + 设置数 */
function summary(plugin: PluginHostRuntimeInfo): string {
  const parts: string[] = [];
  const caps = plugin.capabilities?.length ?? 0;
  const cmds = plugin.contributes?.commands?.length ?? 0;
  const sets = plugin.contributes?.settings?.length ?? 0;
  if (cmds) parts.push(`${cmds} 个命令`);
  if (sets) parts.push(`${sets} 项设置`);
  if (caps) parts.push(`${caps} 项能力`);
  return parts.join(" · ") || "无附加功能";
}
</script>

<template>
  <div class="plugin-panel">
    <!-- 工具条：极简，一行搞定 -->
    <div class="toolbar">
      <span class="toolbar-stat">
        {{ plugins.length }} 个插件<template v-if="runningCount"> · {{ runningCount }} 运行中</template>
      </span>
      <div class="toolbar-actions">
        <button class="btn" type="button" :disabled="loading || busy || hostMissing" @click="onRefresh">
          刷新
        </button>
        <button class="btn btn-primary" type="button" :disabled="loading || busy || hostMissing" @click="onInstall">
          安装
        </button>
      </div>
    </div>

    <div v-if="hostMissing" class="notice notice-error">
      ctx.pluginHost 未注册，请检查 kernel bootstrap。
    </div>

    <div v-else-if="plugins.length === 0 && (loading || busy)" class="notice">正在加载…</div>

    <div v-else-if="plugins.length === 0" class="notice">
      <div class="notice-title">还没有插件</div>
      <div class="notice-sub">点「安装」导入含 manifest.json v2 的目录</div>
    </div>

    <!-- 列表：一行一个插件，只留必要信息 -->
    <ul v-else class="plugin-rows">
      <li
        v-for="plugin in plugins"
        :key="plugin.id"
        class="plugin-row"
        :class="{ 'is-on': plugin.loaded }"
        @click="openDetail(plugin)"
      >
        <span class="row-avatar">{{ (plugin.name || plugin.id).charAt(0) }}</span>

        <span class="row-main">
          <span class="row-title">
            <span class="row-name">{{ plugin.name }}</span>
            <span v-if="plugin.last_error" class="row-badge badge-error">异常</span>
          </span>
          <span class="row-sub">{{ summary(plugin) }}</span>
        </span>

        <label class="switch" @click.stop>
          <input
            type="checkbox"
            :checked="plugin.enabled"
            :disabled="loading || busy"
            @change="onToggle(plugin, $event)"
          />
          <span class="slider"></span>
        </label>

        <span class="row-arrow"></span>
      </li>
    </ul>

    <div v-if="lastError" class="notice notice-error">
      <div class="notice-title">Host 错误</div>
      <div class="notice-sub">{{ fmtError(lastError) }}</div>
    </div>
  </div>
</template>

<style scoped>
.plugin-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 13px;
  color: var(--text-color);
}

/* 工具条 */
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.toolbar-stat {
  font-size: 11.5px;
  color: var(--text-hint);
}

.toolbar-actions {
  display: flex;
  gap: 6px;
}

.btn {
  height: 28px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid var(--border-color-strong);
  background: var(--input-bg);
  color: var(--text-color);
  font-size: 12px;
  cursor: pointer;
  -webkit-app-region: no-drag;
  transition: background 0.15s ease, opacity 0.15s ease;
  white-space: nowrap;
}

.btn:hover:not(:disabled) {
  background: var(--hover-bg);
}

.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.btn-primary {
  border-color: var(--primary-color);
  background: var(--primary-color);
  color: #fff;
}

.btn-primary:hover:not(:disabled) {
  filter: brightness(1.1);
  background: var(--primary-color);
}

/* 提示块 */
.notice {
  padding: 16px;
  text-align: center;
  border: 1px dashed var(--border-color);
  border-radius: 10px;
  color: var(--text-hint);
  font-size: 12px;
}

.notice-error {
  border-style: solid;
  border-color: rgba(255, 107, 107, 0.3);
  background: rgba(255, 107, 107, 0.06);
  color: #ff8787;
  text-align: left;
}

.notice-title {
  font-weight: 600;
  color: var(--text-color);
  margin-bottom: 3px;
}

.notice-sub {
  font-size: 11px;
  opacity: 0.85;
  line-height: 1.5;
}

/* 列表行 —— 无卡片、无多余 padding */
.plugin-rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.plugin-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border-radius: 10px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: background 0.14s ease, border-color 0.14s ease;
}

.plugin-row:hover {
  background: var(--hover-bg);
  border-color: var(--border-color);
}

.row-avatar {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--primary-bg);
  color: var(--primary-color);
  font-weight: 700;
  font-size: 14px;
  flex-shrink: 0;
}

.row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.row-title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.row-name {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-badge {
  flex-shrink: 0;
  padding: 0 6px;
  border-radius: 999px;
  font-size: 10px;
  line-height: 15px;
}

.badge-error {
  background: rgba(255, 107, 107, 0.15);
  color: #ff8787;
}

.row-sub {
  font-size: 11px;
  color: var(--text-hint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 开关 */
.switch {
  position: relative;
  display: inline-block;
  width: 38px;
  height: 21px;
  flex-shrink: 0;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  inset: 0;
  cursor: pointer;
  background: var(--hover-bg);
  border: 1px solid var(--border-color-strong);
  border-radius: 999px;
  transition: background 0.2s ease, border-color 0.2s ease;
}

.slider::before {
  content: "";
  position: absolute;
  height: 15px;
  width: 15px;
  left: 2px;
  top: 50%;
  transform: translateY(-50%);
  background: var(--text-hint);
  border-radius: 50%;
  transition: transform 0.2s ease, background 0.2s ease;
}

.switch input:checked + .slider {
  background: var(--primary-color);
  border-color: var(--primary-color);
}

.switch input:checked + .slider::before {
  transform: translateY(-50%) translateX(17px);
  background: #fff;
}

.switch input:disabled + .slider {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 行尾箭头 */
.row-arrow {
  width: 6px;
  height: 6px;
  border-right: 1.5px solid var(--text-hint);
  border-bottom: 1.5px solid var(--text-hint);
  transform: rotate(-45deg);
  flex-shrink: 0;
  opacity: 0.5;
}

.plugin-row:hover .row-arrow {
  opacity: 1;
}
</style>
