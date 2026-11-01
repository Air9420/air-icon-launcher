<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useCordis } from "../../kernel";
import type {
  PluginHostCommandContribute,
  PluginHostRuntimeInfo,
  PluginHostSettingField,
} from "../../types/plugin-host";
import { showToast } from "../../composables/useGlobalToast";
import { useConfirmDialog } from "../../composables/useConfirmDialog";

const props = defineProps<{ pluginId: string }>();

const ctx = useCordis();
const host = ctx.pluginHost;
const router = useRouter();
const { confirm } = useConfirmDialog();

const plugins = host?.plugins ?? ref<PluginHostRuntimeInfo[]>([]);
const loading = host?.loading ?? ref(false);

const plugin = computed<PluginHostRuntimeInfo | undefined>(() =>
  plugins.value.find((p) => p.id === props.pluginId),
);

const busy = ref(false);
const settings = ref<Record<string, unknown>>({});
const settingsLoaded = ref(false);

const logs = ref<string[]>([]);
const logsOpen = ref(false);
const logsLoading = ref(false);

const settingFields = computed<PluginHostSettingField[]>(
  () => plugin.value?.contributes?.settings ?? [],
);
const commands = computed<PluginHostCommandContribute[]>(
  () => plugin.value?.contributes?.commands ?? [],
);

onMounted(async () => {
  if (!host) return;
  if (plugins.value.length === 0) {
    await host.refresh();
  }
  await loadSettings();
});

function requireHost() {
  if (!host) {
    showToast("PluginHostService 未注册", { type: "error" });
    return null;
  }
  return host;
}

/* ---------------- 热键录制 ---------------- */

/** 正在录制的设置项 key；null 表示未录制 */
const recordingKey = ref<string | null>(null);

/** 修饰键按下中，等待主键 */
const pendingMods = ref<string[]>([]);

function isModifier(key: string): boolean {
  return key === "Shift" || key === "Control" || key === "Alt" || key === "Meta";
}

/** 把 KeyboardEvent.key 转成插件能识别的键名 */
function normalizeKeyName(key: string): string {
  const map: Record<string, string> = {
    PageUp: "pgup",
    PageDown: "pgdn",
    " ": "space",
    Escape: "esc",
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
    Insert: "insert",
    Delete: "delete",
    Home: "home",
    End: "end",
    Enter: "enter",
    Tab: "tab",
    Backspace: "backspace",
    CapsLock: "capslock",
    PrintScreen: "printscreen",
    ScrollLock: "scrolllock",
    Pause: "pause",
  };
  if (map[key]) return map[key];
  if (key.length === 1) return key.toLowerCase();
  return key.toLowerCase();
}

function startRecording(field: PluginHostSettingField) {
  recordingKey.value = field.key;
  pendingMods.value = [];
}

function cancelRecording() {
  recordingKey.value = null;
  pendingMods.value = [];
}

function onRecordKeyDown(ev: KeyboardEvent) {
  if (!recordingKey.value) return;

  // 录制中拦掉所有默认行为，避免触发页面快捷键
  ev.preventDefault();
  ev.stopPropagation();

  // Esc 取消
  if (ev.key === "Escape") {
    cancelRecording();
    return;
  }

  // 只按修饰键：先记下，等主键
  if (isModifier(ev.key)) {
    const mods: string[] = [];
    if (ev.ctrlKey) mods.push("ctrl");
    if (ev.altKey) mods.push("alt");
    if (ev.shiftKey) mods.push("shift");
    if (ev.metaKey) mods.push("meta");
    pendingMods.value = mods;
    return;
  }

  // 组装：修饰键 + 主键
  const parts: string[] = [];
  if (ev.ctrlKey) parts.push("ctrl");
  if (ev.altKey) parts.push("alt");
  if (ev.shiftKey) parts.push("shift");
  if (ev.metaKey) parts.push("meta");
  parts.push(normalizeKeyName(ev.key));

  const spec = parts.join("+");
  const key = recordingKey.value;
  cancelRecording();
  void saveSetting(key, spec);
}

/** 录制中的提示文案 */
const recordingHint = computed(() => {
  if (!recordingKey.value) return "";
  if (pendingMods.value.length === 0) return "请按下按键…";
  return pendingMods.value.join("+") + " + ?";
});

onMounted(() => {
  window.addEventListener("keydown", onRecordKeyDown, true);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onRecordKeyDown, true);
});

async function loadSettings() {
  const h = requireHost();
  if (!h || !plugin.value?.loaded) return;
  const r = await h.invoke(props.pluginId, "settings.get", {});
  if (r.ok && r.value && typeof r.value === "object") {
    settings.value = r.value as Record<string, unknown>;
    settingsLoaded.value = true;
  }
}

async function saveSetting(key: string, value: unknown) {
  const h = requireHost();
  if (!h) return;
  const prev = { ...settings.value };
  settings.value = { ...settings.value, [key]: value };
  busy.value = true;
  try {
    const r = await h.invoke(props.pluginId, "settings.set", { [key]: value });
    if (!r.ok) {
      settings.value = prev;
      showToast(h.formatError(r.error), { type: "error" });
      return;
    }
    if (r.value && typeof r.value === "object") {
      settings.value = r.value as Record<string, unknown>;
    }
    showToast("已保存", { type: "success" });
  } finally {
    busy.value = false;
  }
}

/* ---- 设置控件 ---- */

function valueOf(field: PluginHostSettingField): unknown {
  if (field.key in settings.value) return settings.value[field.key];
  return field.default;
}

function asText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function onText(field: PluginHostSettingField, ev: Event) {
  const el = ev.target as HTMLInputElement;
  if (field.type === "number") {
    const n = Number(el.value);
    if (Number.isFinite(n)) void saveSetting(field.key, n);
  } else {
    void saveSetting(field.key, el.value);
  }
}

function onBool(field: PluginHostSettingField, ev: Event) {
  void saveSetting(field.key, (ev.target as HTMLInputElement).checked);
}

function onSelect(field: PluginHostSettingField, ev: Event) {
  const el = ev.target as HTMLSelectElement;
  const opt = (field.options ?? []).find((o) => String(o.value) === el.value);
  void saveSetting(field.key, opt ? opt.value : el.value);
}

function isChecked(field: PluginHostSettingField, optValue: unknown): boolean {
  const cur = valueOf(field);
  return Array.isArray(cur) && cur.includes(optValue);
}

function onMulti(field: PluginHostSettingField, optValue: unknown, checked: boolean) {
  const cur = valueOf(field);
  const arr: unknown[] = Array.isArray(cur) ? [...cur] : [];
  const i = arr.findIndex((v) => v === optValue);
  if (checked && i < 0) arr.push(optValue);
  if (!checked && i >= 0) arr.splice(i, 1);
  void saveSetting(field.key, arr);
}

/* ---- 生命周期 ---- */

async function onToggleEnabled(ev: Event) {
  const h = requireHost();
  if (!h || !plugin.value) return;
  const el = ev.target as HTMLInputElement;
  const enabled = el.checked;
  busy.value = true;
  try {
    const r = await h.setEnabled(plugin.value.id, enabled);
    if (!r.ok) {
      el.checked = !enabled;
      showToast(h.formatError(r.error), { type: "error" });
      return;
    }
    showToast(enabled ? "已启用" : "已停用", { type: "success" });
    if (enabled) await loadSettings();
  } finally {
    busy.value = false;
  }
}

async function onInvoke(cmd: PluginHostCommandContribute) {
  const h = requireHost();
  if (!h) return;
  const method = cmd.method || cmd.id;
  busy.value = true;
  try {
    const r = await h.invoke(props.pluginId, method, {});
    if (r.ok) {
      const v = r.value;
      const text =
        v === null || v === undefined
          ? "完成"
          : typeof v === "object"
            ? JSON.stringify(v).slice(0, 100)
            : String(v);
      showToast(text, { type: "success" });
    } else {
      showToast(h.formatError(r.error), { type: "error" });
    }
  } finally {
    busy.value = false;
  }
}

async function onShowLogs() {
  const h = requireHost();
  if (!h) return;
  logsOpen.value = true;
  logsLoading.value = true;
  try {
    const r = await h.getLog(props.pluginId);
    logs.value = r.ok ? r.value : [];
  } finally {
    logsLoading.value = false;
  }
}

async function onUninstall() {
  const h = requireHost();
  if (!h || !plugin.value) return;
  const ok = await confirm({
    title: "删除插件",
    message: `确定删除「${plugin.value.name}」？插件目录会被移除。`,
    confirmText: "删除",
    cancelText: "取消",
  });
  if (!ok) return;
  const r = await h.uninstall(props.pluginId);
  if (r.ok) {
    showToast("已删除", { type: "success" });
    router.replace({ name: "plugins" });
  } else {
    showToast(h.formatError(r.error), { type: "error" });
  }
}

function goBack() {
  router.back();
}
</script>

<template>
  <div class="detail-page">
    <!-- 顶栏 -->
    <header class="detail-header" data-tauri-drag-region>
      <button class="back-btn" type="button" @click="goBack" @mousedown.stop>返回</button>
      <span class="header-title" data-tauri-drag-region>{{ plugin?.name || "插件详情" }}</span>
    </header>

    <div class="detail-body">
      <div v-if="!plugin" class="notice">
        <div class="notice-title">找不到插件</div>
        <div class="notice-sub">{{ pluginId }}</div>
      </div>

      <template v-else>
        <!-- 概览 -->
        <section class="block">
          <div class="overview">
            <div class="overview-avatar">{{ (plugin.name || plugin.id).charAt(0) }}</div>
            <div class="overview-info">
              <div class="overview-name">{{ plugin.name }}</div>
              <div class="overview-meta">{{ plugin.id }} · v{{ plugin.version }}</div>
              <div v-if="plugin.description" class="overview-desc">{{ plugin.description }}</div>
            </div>
            <label class="switch" :title="plugin.enabled ? '停用' : '启用'">
              <input
                type="checkbox"
                :checked="plugin.enabled"
                :disabled="busy || loading"
                @change="onToggleEnabled"
              />
              <span class="slider"></span>
            </label>
          </div>

          <div v-if="plugin.last_error" class="inline-error">{{ plugin.last_error }}</div>
        </section>

        <!-- 操作 -->
        <section v-if="commands.length" class="block">
          <div class="block-title">操作</div>
          <div class="btn-grid">
            <button
              v-for="cmd in commands"
              :key="cmd.id"
              class="btn"
              type="button"
              :title="cmd.method || cmd.id"
              :disabled="busy || !plugin.loaded"
              @click="onInvoke(cmd)"
            >
              {{ cmd.title || cmd.id }}
            </button>
          </div>
          <div v-if="!plugin.loaded" class="block-hint">启用插件后可用</div>
        </section>

        <!-- 设置 -->
        <section v-if="settingFields.length" class="block">
          <div class="block-title">设置</div>

          <div v-if="!plugin.loaded" class="block-hint">启用插件后可配置</div>
          <div v-else-if="!settingsLoaded" class="block-hint">正在读取配置…</div>

          <div v-else class="setting-list">
            <div v-for="field in settingFields" :key="field.key" class="setting-item">
              <div class="setting-info">
                <div class="setting-name">{{ field.title || field.key }}</div>
                <div v-if="field.description" class="setting-tip">{{ field.description }}</div>
              </div>

              <div class="setting-control">
                <!-- 热键：点击后录制 -->
                <button
                  v-if="field.type === 'hotkey'"
                  class="hotkey-btn"
                  :class="{ recording: recordingKey === field.key }"
                  type="button"
                  :disabled="busy"
                  @click="
                    recordingKey === field.key ? cancelRecording() : startRecording(field)
                  "
                >
                  <template v-if="recordingKey === field.key">
                    <span class="rec-dot"></span>
                    <span class="rec-text">{{ recordingHint }}</span>
                  </template>
                  <template v-else>
                    <span class="hotkey-value">{{ asText(valueOf(field)) || "未设置" }}</span>
                  </template>
                </button>

                <input
                  v-else-if="!field.type || field.type === 'text'"
                  class="field"
                  type="text"
                  :value="asText(valueOf(field))"
                  :disabled="busy"
                  @change="onText(field, $event)"
                />

                <input
                  v-else-if="field.type === 'number'"
                  class="field field-num"
                  type="number"
                  step="0.1"
                  :value="asText(valueOf(field))"
                  :disabled="busy"
                  @change="onText(field, $event)"
                />

                <label v-else-if="field.type === 'bool'" class="switch">
                  <input
                    type="checkbox"
                    :checked="valueOf(field) === true"
                    :disabled="busy"
                    @change="onBool(field, $event)"
                  />
                  <span class="slider"></span>
                </label>

                <select
                  v-else-if="field.type === 'select'"
                  class="field field-select"
                  :disabled="busy"
                  @change="onSelect(field, $event)"
                >
                  <option
                    v-for="opt in field.options ?? []"
                    :key="String(opt.value)"
                    :value="String(opt.value)"
                    :selected="String(opt.value) === asText(valueOf(field))"
                  >
                    {{ opt.label || String(opt.value) }}
                  </option>
                </select>

                <div v-else-if="field.type === 'multiselect'" class="chips">
                  <label
                    v-for="opt in field.options ?? []"
                    :key="String(opt.value)"
                    class="chip"
                    :class="{ on: isChecked(field, opt.value) }"
                  >
                    <input
                      type="checkbox"
                      :checked="isChecked(field, opt.value)"
                      :disabled="busy"
                      @change="onMulti(field, opt.value, ($event.target as HTMLInputElement).checked)"
                    />
                    <span>{{ opt.label || String(opt.value) }}</span>
                  </label>
                </div>

                <span v-else class="block-hint">不支持：{{ field.type }}</span>
              </div>
            </div>
          </div>
        </section>

        <!-- 日志 -->
        <section class="block">
          <div class="block-head">
            <div class="block-title">日志</div>
            <button class="btn btn-sm" type="button" @click="onShowLogs">
              {{ logsOpen ? "刷新" : "查看" }}
            </button>
          </div>
          <div v-if="logsLoading" class="block-hint">读取中…</div>
          <pre v-else-if="logsOpen && logs.length" class="logs">{{ logs.join("\n") }}</pre>
          <div v-else-if="logsOpen" class="block-hint">暂无日志</div>
        </section>

        <!-- 危险操作 -->
        <section class="block">
          <div class="block-title">管理</div>
          <button class="btn btn-danger" type="button" :disabled="busy" @click="onUninstall">
            删除插件
          </button>
        </section>
      </template>
    </div>
  </div>
</template>

<style scoped>
.detail-page {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-color);
  color: var(--text-color);
}

.detail-header {
  height: 52px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  background: var(--card-bg);
  border-bottom: 1px solid var(--border-color);
}

.back-btn {
  border: 0;
  padding: 7px 11px;
  border-radius: 9px;
  background: var(--hover-bg);
  color: var(--text-color);
  font-size: 12.5px;
  cursor: pointer;
  -webkit-app-region: no-drag;
}

.back-btn:hover {
  background: var(--hover-bg-strong);
}

.header-title {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.detail-body::-webkit-scrollbar {
  display: none;
}

/* 块：只留一层，内部不再嵌套 padding */
.block {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 12px;
}

.block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.block-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.block-head .block-title {
  margin-bottom: 0;
}

.block-hint {
  font-size: 11.5px;
  color: var(--text-hint);
  line-height: 1.6;
}

/* 概览 */
.overview {
  display: flex;
  align-items: flex-start;
  gap: 11px;
}

.overview-avatar {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--primary-bg);
  color: var(--primary-color);
  font-weight: 700;
  font-size: 17px;
  flex-shrink: 0;
}

.overview-info {
  flex: 1;
  min-width: 0;
}

.overview-name {
  font-size: 14px;
  font-weight: 600;
}

.overview-meta {
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-hint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.overview-desc {
  margin-top: 6px;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--text-secondary);
}

.inline-error {
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(255, 107, 107, 0.08);
  border: 1px solid rgba(255, 107, 107, 0.22);
  color: #ff8787;
  font-size: 11px;
  line-height: 1.5;
}

/* 按钮 */
.btn {
  height: 30px;
  padding: 0 13px;
  border-radius: 8px;
  border: 1px solid var(--border-color-strong);
  background: var(--input-bg);
  color: var(--text-color);
  font-size: 12.5px;
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

.btn-sm {
  height: 24px;
  padding: 0 10px;
  font-size: 11.5px;
  border-radius: 7px;
}

.btn-danger {
  color: #ff6b6b;
  border-color: rgba(255, 107, 107, 0.35);
}

.btn-danger:hover:not(:disabled) {
  background: rgba(255, 107, 107, 0.1);
}

.btn-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

/* 设置 */
.setting-list {
  display: flex;
  flex-direction: column;
}

.setting-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 9px 0;
  border-bottom: 1px solid var(--border-color);
}

.setting-item:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.setting-info {
  flex: 1;
  min-width: 0;
}

.setting-name {
  font-size: 12.5px;
  font-weight: 500;
}

.setting-tip {
  margin-top: 2px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-hint);
}

.setting-control {
  flex-shrink: 0;
  display: flex;
  justify-content: flex-end;
}

.field {
  width: 165px;
  height: 30px;
  padding: 0 9px;
  border-radius: 8px;
  border: 1px solid var(--border-color-strong);
  background: var(--input-bg);
  color: var(--text-color);
  font-size: 12px;
  outline: none;
  transition: border-color 0.15s ease;
}

.field:focus {
  border-color: var(--primary-color);
}

.field:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.field-num {
  width: 80px;
  text-align: center;
}

.field-select {
  width: 185px;
  cursor: pointer;
}

/* 热键录制按钮 */
.hotkey-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-width: 165px;
  height: 30px;
  padding: 0 11px;
  border-radius: 8px;
  border: 1px solid var(--border-color-strong);
  background: var(--input-bg);
  color: var(--text-color);
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  cursor: pointer;
  -webkit-app-region: no-drag;
  transition: border-color 0.15s ease, background 0.15s ease;
  justify-content: center;
}

.hotkey-btn:hover:not(:disabled) {
  border-color: var(--primary-color);
}

.hotkey-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.hotkey-btn.recording {
  border-color: var(--primary-color);
  background: var(--primary-bg);
  color: var(--primary-color);
}

.hotkey-value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 录制中的红点 */
.rec-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #ff6b6b;
  flex-shrink: 0;
  animation: rec-pulse 1.1s ease-in-out infinite;
}

@keyframes rec-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.25; }
}

.rec-text {
  font-family: inherit;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 多选芯片 */
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
}

.chip {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--border-color-strong);
  background: var(--input-bg);
  color: var(--text-secondary);
  font-size: 11.5px;
  cursor: pointer;
  user-select: none;
  transition: all 0.14s ease;
}

.chip:hover {
  border-color: var(--primary-color);
}

.chip.on {
  border-color: var(--primary-color);
  background: var(--primary-bg);
  color: var(--primary-color);
}

.chip input {
  display: none;
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

/* 日志 */
.logs {
  margin: 0;
  max-height: 220px;
  overflow: auto;
  padding: 9px 10px;
  border-radius: 8px;
  background: var(--input-bg);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px;
  line-height: 1.65;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-all;
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

.notice-title {
  font-weight: 600;
  color: var(--text-color);
  margin-bottom: 3px;
}

.notice-sub {
  font-size: 11px;
  opacity: 0.85;
}
</style>
