<template>
  <div class="display-settings">
    <div class="section">
      <div class="section-title">显示器 ICC 配置管理</div>

      <!-- 显示器选择列表 -->
      <div class="monitor-selector">
        <div class="selector-header">
          <div class="selector-label">选择显示器：</div>
          <button class="refresh-btn" :disabled="isBusy" @click="refreshMonitors()" title="刷新显示器列表">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
              <path d="M3 3v5h5"></path>
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"></path>
              <path d="M16 16h5v5"></path>
            </svg>
            <span>刷新</span>
          </button>
        </div>
        <div class="monitor-chips">
          <button
            v-for="(monitor, index) in monitors"
            :key="monitor.name"
            class="monitor-chip"
            :class="{ active: selectedMonitor?.name === monitor.name }"
            :disabled="isBusy"
            @click="selectMonitor(monitor)"
          >
            <span class="chip-index">{{ index + 1 }}</span>
            <span class="chip-name">{{ monitor.friendlyName }}</span>
            <span v-if="monitor.isPrimary" class="chip-badge">主屏</span>
          </button>
        </div>
      </div>

      <!-- 选中显示器的 ICC 配置 -->
      <div v-if="selectedMonitor" class="monitor-detail">
        <div class="detail-header">
          <div class="detail-info">
            <span class="detail-name">{{ selectedMonitor.friendlyName }}</span>
          </div>
        </div>

        <!-- 当前显示器的 ICC 配置列表 -->
        <div class="icc-list">
          <div v-if="monitorProfiles.length === 0" class="empty-icc">
            该显示器暂无 ICC 配置
          </div>
          <div
            v-for="profile in monitorProfiles"
            :key="profile.id"
            class="icc-item"
            :class="{ active: profile.enabled, busy: isBusy }"
            :aria-busy="isBusy"
            @click="onSelect(profile.id)"
          >
            <div class="icc-radio">
              <div class="radio-dot" :class="{ checked: profile.enabled }"></div>
            </div>
            <div class="icc-info">
              <span class="icc-name">{{ getFileName(profile.iccPath) }}</span>
              <span class="icc-path" :title="profile.iccPath">{{ profile.iccPath }}</span>
            </div>
            <button class="action-btn danger" :disabled="isBusy" @click.stop="onRemove(profile.id)">删除</button>
          </div>
        </div>

        <!-- 添加 ICC 配置按钮 -->
        <button class="add-btn" :disabled="isBusy" @click="onAdd">
          + 添加 ICC 配置文件
        </button>
      </div>

      <div v-else class="no-monitor">
        请选择一个显示器
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { listen } from "@tauri-apps/api/event";
import { useIccStore } from "../../stores/iccStore";
import { showToast } from "../../composables/useGlobalToast";
import { useConfirmDialog } from "../../composables/useConfirmDialog";
import type { MonitorInfo, IccProfile } from "../../types/icc";

const iccStore = useIccStore();
const { profiles, monitors } = storeToRefs(iccStore);
const { confirm } = useConfirmDialog();

const selectedMonitor = ref<MonitorInfo | null>(null);
const isBusy = ref(false);
const activeOperationTicket = ref(0);
let switchRequestSeq = 0;
// 仅在组件卸载时置真，作为“结果不再写回”的终态标记；
// 切换/刷新造成的失效一律走 switchRequestSeq 递增，不能永久关停整页操作。
let unmounted = false;
let pendingSelectTimer: number | undefined;

// 监听显示器变化事件（Windows系统事件）
let unlistenDisplayChanged: (() => void) | null = null;

function isStale(requestSeq: number, signal?: AbortSignal): boolean {
  return unmounted
    || requestSeq !== switchRequestSeq
    || signal?.aborted === true;
}

function isSupersededError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: string }).code === "OPERATION_SUPERSEDED";
}

function snapshotEnabledState(): { id: string; enabled: boolean }[] {
  return profiles.value.map((p) => ({ id: p.id, enabled: p.enabled }));
}

function restoreEnabledState(snapshot: { id: string; enabled: boolean }[]) {
  const byId = new Map(snapshot.map((item) => [item.id, item.enabled]));
  profiles.value = profiles.value.map((p) =>
    byId.has(p.id) ? { ...p, enabled: byId.get(p.id)! } : p,
  );
}

function applyEnabledState(profileId: string, enabled: boolean) {
  const profile = profiles.value.find((p) => p.id === profileId);
  if (!profile) return;
  profiles.value = profiles.value.map((p) => ({
    ...p,
    enabled: p.monitorName === profile.monitorName ? p.id === profileId && enabled : p.enabled,
  }));
}

/** 让正在跑或排队中的切换失效，但不影响之后的点击。 */
function invalidatePendingSwitch() {
  switchRequestSeq += 1;
  iccStore.cancelPendingOperations();
}

watch(
  () => selectedMonitor.value?.name,
  () => {
    // 换了显示器，旧配置的操作结果不再写回当前页。
    if (isBusy.value) invalidatePendingSwitch();
  },
);

// 刷新显示器列表
// forceReselect: 当收到 display-changed 事件时强制重新选择主显示器
// 因为 Windows 编号会在切换投影模式时重新分配
async function refreshMonitors(forceReselect = false) {
  if (isBusy.value) return;
  await iccStore.fetchMonitors();

  if (forceReselect) {
    // 强制重新选择主显示器
    const primary = monitors.value.find((m) => m.isPrimary) || monitors.value[0];
    selectedMonitor.value = primary || null;
    return;
  }

  // 如果当前选中的显示器不再存在，选择主显示器
  if (selectedMonitor.value) {
    const stillExists = monitors.value.some(
      (m) => m.friendlyName === selectedMonitor.value!.friendlyName
    );
    if (!stillExists) {
      const primary = monitors.value.find((m) => m.isPrimary) || monitors.value[0];
      selectedMonitor.value = primary || null;
    }
  } else if (monitors.value.length > 0) {
    const primary = monitors.value.find((m) => m.isPrimary) || monitors.value[0];
    selectedMonitor.value = primary;
  }
}

onMounted(async () => {
  // 并行加载数据
  await Promise.all([
    iccStore.fetchMonitors(),
    iccStore.fetchProfiles(),
  ]);

  // 默认选中主显示器
  if (monitors.value.length > 0) {
    const primary = monitors.value.find((m) => m.isPrimary) || monitors.value[0];
    selectedMonitor.value = primary;
  }
  // 后台预热 WCS 服务（不阻塞页面）
  iccStore.warmupWcs();

  // 监听Windows显示器变化事件
  unlistenDisplayChanged = await listen("display-changed", async () => {
    if (isBusy.value) {
      invalidatePendingSwitch();
      return;
    }
    // 强制重新选择主显示器，因为 Windows 编号会被重新分配
    await refreshMonitors(true);
    showToast("检测到显示器变化，已自动刷新", { type: "info" });
  });
});

onUnmounted(() => {
  unmounted = true;
  switchRequestSeq += 1;
  window.clearTimeout(pendingSelectTimer);
  iccStore.cancelPendingOperations();
  // 清理事件监听器
  if (unlistenDisplayChanged) {
    unlistenDisplayChanged();
    unlistenDisplayChanged = null;
  }
});

// 当前选中显示器的 ICC 配置
// 使用 friendlyName 关联，因为 Windows 编号会在切换投影模式时重新分配
const monitorProfiles = computed(() => {
  if (!selectedMonitor.value) return [];
  return profiles.value.filter((p) => p.monitorName === selectedMonitor.value!.friendlyName);
});

function selectMonitor(monitor: MonitorInfo) {
  if (isBusy.value) return;
  selectedMonitor.value = monitor;
}

function getFileName(path: string): string {
  if (!path) return "";
  const parts = path.split("\\");
  return parts[parts.length - 1] || "";
}

function onSelect(profileId: string) {
  // 真防抖：连点时只保留最后一次，单点不额外等待。
  window.clearTimeout(pendingSelectTimer);
  pendingSelectTimer = window.setTimeout(() => {
    void runSelect(profileId);
  }, 90);
}

async function runSelect(profileId: string) {
  const profile = profiles.value.find((p) => p.id === profileId);
  if (!profile || unmounted) return;

  const requestSeq = ++switchRequestSeq;
  const shouldEnable = !profile.enabled;
  const prevEnabled = snapshotEnabledState();
  const startTime = performance.now();
  const label = getFileName(profile.iccPath);

  console.log(`[ICC] 收到切换: ${label}, enable=${shouldEnable}`);

  let operationTicket = 0;
  try {
    operationTicket = await iccStore.beginOperation();
    if (isStale(requestSeq)) return;
  } catch (e) {
    console.error(`[ICC] 领取操作序列失败: ${label}`, e);
    showToast("应用 ICC 配置失败", { type: "error" });
    return;
  }

  activeOperationTicket.value = operationTicket;
  isBusy.value = true;
  applyEnabledState(profileId, shouldEnable);

  const result = await iccStore.runSwitchOperation(operationTicket, async (signal) => {
    if (shouldEnable) {
      await iccStore.activateProfile(profileId, operationTicket);
    } else {
      await iccStore.deactivateProfile(profileId, operationTicket);
    }
    if (isStale(requestSeq, signal)) return;
  }).catch((e) => {
    if (isSupersededError(e) || isStale(requestSeq)) return "superseded";
    console.error(`[ICC] 切换失败: ${(performance.now() - startTime).toFixed(0)}ms`, e);
    // 回滚到操作前的完整快照：只翻当前项会把同显示器其他配置一起清掉。
    restoreEnabledState(prevEnabled);
    showToast(shouldEnable ? "应用 ICC 配置失败" : "禁用 ICC 配置失败", { type: "error" });
    return "failed";
  });

  if (result === "done") {
    console.log(`[ICC] 切换完成: ${(performance.now() - startTime).toFixed(0)}ms`);
    showToast(shouldEnable ? "ICC 配置已应用" : "已恢复默认颜色", {
      type: shouldEnable ? "success" : "info",
    });
  }

  if (activeOperationTicket.value === operationTicket) {
    isBusy.value = false;
    activeOperationTicket.value = 0;
  }
}

async function onAdd() {
  if (isBusy.value) return;
  if (!selectedMonitor.value) {
    showToast("请先选择显示器", { type: "error" });
    return;
  }

  const filePath = await iccStore.selectIccFile();
  if (!filePath || isBusy.value) return;

  const profile: IccProfile = {
    id: crypto.randomUUID(),
    monitorName: selectedMonitor.value.friendlyName,
    monitorDeviceId: selectedMonitor.value.deviceId,
    iccPath: filePath,
    enabled: false,
  };

  try {
    await iccStore.addProfile(profile);
    showToast("ICC 配置已添加", { type: "success" });
  } catch (e) {
    showToast("添加 ICC 配置失败", { type: "error" });
  }
}

async function onRemove(profileId: string) {
  if (isBusy.value) return;
  const profile = profiles.value.find((p) => p.id === profileId);
  if (!profile) return;

  const fileName = getFileName(profile.iccPath);
  const confirmed = await confirm({
    title: "删除 ICC 配置",
    message: `确定要删除 "${fileName}" 吗？${profile.enabled ? "\n该配置当前已启用，删除后将恢复默认颜色。" : ""}`,
    confirmText: "删除",
    cancelText: "取消",
  });

  if (!confirmed) return;
  // 确认框期间用户可能已发起切换，此时再抢操作票会把对方踢成 SUPERSEDED。
  if (isBusy.value) return;

  // 如果删除的是启用的配置，先恢复默认
  if (profile.enabled) {
    try {
      const operationSeq = await iccStore.beginOperation();
      await iccStore.restoreDefault(profileId, operationSeq);
    } catch (e) {
      console.error("Failed to restore default before remove:", e);
    }
  }

  // 乐观更新
  const removedProfile = { ...profile };
  profiles.value = profiles.value.filter((p) => p.id !== profileId);
  showToast("ICC 配置已删除", { type: "success" });

  try {
    await iccStore.removeProfile(profileId);
  } catch (e) {
    // 回滚
    profiles.value.push(removedProfile);
    showToast("删除 ICC 配置失败", { type: "error" });
  }
}
</script>

<style lang="scss" scoped>
@use "../../styles/settings/section" as settings;

.display-settings {
  @include settings.page-stack();
}

.section {
  @include settings.section-card();
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-title {
  @include settings.section-title();
}

.hint {
  @include settings.hint();
}

.monitor-selector {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.selector-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.selector-label {
  font-weight: 600;
  color: var(--text-color);
  font-size: 14px;
}

.refresh-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--card-bg);
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 12px;
  transition: all 0.2s;
}

.refresh-btn:hover:not(:disabled) {
  border-color: var(--primary-color);
  color: var(--primary-color);
  background: var(--primary-bg);
}

.refresh-btn:disabled,
.monitor-chip:disabled,
.action-btn:disabled,
.add-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.monitor-chips {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.monitor-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border: 2px solid var(--border-color);
  border-radius: 8px;
  background: var(--card-bg);
  cursor: pointer;
  transition: all 0.2s;
  color: var(--text-color);
  width: 100%;
}

.monitor-chip:hover:not(:disabled) {
  border-color: var(--primary-color);
  background: var(--hover-bg);
}

.monitor-chip.active {
  border-color: var(--primary-color);
  background: var(--primary-bg);
}

.chip-index {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--hover-bg-strong);
  font-weight: 700;
  font-size: 12px;
}

.monitor-chip.active .chip-index {
  background: var(--primary-color);
  color: white;
}

.chip-name {
  font-size: 13px;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chip-badge {
  font-size: 10px;
  padding: 2px 4px;
  border-radius: 4px;
  background: var(--primary-color);
  color: white;
}

.monitor-detail {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  background: var(--hover-bg);
  border-radius: 10px;
}

.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.detail-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.detail-name {
  font-weight: 600;
  font-size: 16px;
  color: var(--text-color);
}

.icc-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.empty-icc {
  text-align: center;
  color: var(--text-secondary);
  padding: 16px;
  font-size: 13px;
}

.icc-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--card-bg);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  border: 2px solid transparent;
}

.icc-item:hover:not(.busy) {
  background: var(--hover-bg-strong);
}

.icc-item.busy {
  cursor: progress;
  opacity: 0.72;
}

.icc-item.active {
  border-color: var(--primary-color);
  background: var(--primary-bg);
}

.icc-radio {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.radio-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid var(--border-color-strong);
  transition: all 0.2s;
}

.radio-dot.checked {
  border-color: var(--primary-color);
  background: var(--primary-color);
  box-shadow: inset 0 0 0 3px var(--card-bg);
}

.icc-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.icc-name {
  font-weight: 600;
  color: var(--text-color);
  font-size: 13px;
}

.icc-path {
  font-size: 11px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.action-btn {
  border: 0;
  padding: 6px 10px;
  border-radius: 6px;
  background: var(--hover-bg-strong);
  cursor: pointer;
  color: var(--text-color);
  font-size: 12px;
}

.action-btn:hover:not(:disabled) {
  background: var(--border-color-strong);
}

.action-btn.danger {
  color: var(--error-color);
}

.action-btn.danger:hover:not(:disabled) {
  background: rgba(255, 0, 0, 0.1);
}

.add-btn {
  border: 0;
  padding: 10px;
  border-radius: 8px;
  background: var(--primary-bg);
  cursor: pointer;
  color: var(--primary-color);
  font-weight: 600;
  font-size: 14px;
}

.add-btn:hover:not(:disabled) {
  opacity: 0.9;
}

.no-monitor {
  text-align: center;
  color: var(--text-secondary);
  padding: 20px;
}
</style>
