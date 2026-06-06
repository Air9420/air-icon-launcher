<template>
  <div class="display-settings">
    <div class="section">
      <div class="section-title">显示器 ICC 配置管理</div>

      <!-- 显示器选择列表 -->
      <div class="monitor-selector">
        <div class="selector-header">
          <div class="selector-label">选择显示器：</div>
          <button class="refresh-btn" @click="refreshMonitors()" title="刷新显示器列表">
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
            :class="{ active: profile.enabled }"
            @click="onSelect(profile.id)"
          >
            <div class="icc-radio">
              <div class="radio-dot" :class="{ checked: profile.enabled }"></div>
            </div>
            <div class="icc-info">
              <span class="icc-name">{{ getFileName(profile.iccPath) }}</span>
              <span class="icc-path" :title="profile.iccPath">{{ profile.iccPath }}</span>
            </div>
            <button class="action-btn danger" @click.stop="onRemove(profile.id)">删除</button>
          </div>
        </div>

        <!-- 添加 ICC 配置按钮 -->
        <button class="add-btn" @click="onAdd">
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
import { computed, onMounted, onUnmounted, ref } from "vue";
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

// 监听显示器变化事件（Windows系统事件）
let unlistenDisplayChanged: (() => void) | null = null;

// 刷新显示器列表
// forceReselect: 当收到 display-changed 事件时强制重新选择主显示器
// 因为 Windows 编号会在切换投影模式时重新分配
async function refreshMonitors(forceReselect = false) {
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
    // 强制重新选择主显示器，因为 Windows 编号会被重新分配
    await refreshMonitors(true);
    showToast("检测到显示器变化，已自动刷新", { type: "info" });
  });
});

onUnmounted(() => {
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
  selectedMonitor.value = monitor;
}

function getFileName(path: string): string {
  if (!path) return "";
  const parts = path.split("\\");
  return parts[parts.length - 1] || "";
}

async function onSelect(profileId: string) {
  const profile = profiles.value.find((p) => p.id === profileId);
  if (!profile) return;

  const startTime = performance.now();
  console.log(`[ICC] 开始切换配置: ${getFileName(profile.iccPath)}`);

  // 如果已经启用，则禁用（取消选中）
  if (profile.enabled) {
    // 乐观更新 UI
    profile.enabled = false;
    showToast("已恢复默认颜色", { type: "info" });

    // 并行执行，不阻塞
    Promise.all([
      iccStore.toggleProfile(profileId, false),
      iccStore.restoreDefault(profileId),
    ]).then(() => {
      console.log(`[ICC] 禁用完成: ${(performance.now() - startTime).toFixed(0)}ms`);
    }).catch((e) => {
      // 回滚
      profile.enabled = true;
      console.error(`[ICC] 禁用失败: ${(performance.now() - startTime).toFixed(0)}ms`, e);
      showToast("禁用 ICC 配置失败", { type: "error" });
    });
    return;
  }

  // 乐观更新 UI：立即禁用其他配置，启用当前配置
  const prevEnabled = profiles.value.map((p) => ({ id: p.id, enabled: p.enabled }));
  profiles.value.forEach((p) => {
    if (p.monitorName === profile.monitorName) {
      p.enabled = p.id === profileId;
    }
  });
  showToast("ICC 配置已应用", { type: "success" });

  // 双阶段策略：
  // 阶段1：立即应用 LUT（1ms），用户立即看到效果
  // 阶段2：后台执行 Associate + SetDefault（系统级配置）
  
  // 阶段1：快速 LUT 更新
  iccStore.toggleProfile(profileId, true).then(() => {
    console.log(`[ICC] toggleProfile 完成: ${(performance.now() - startTime).toFixed(0)}ms`);
    return iccStore.applyLutOnly(profileId);
  }).then(() => {
    console.log(`[ICC] LUT 应用完成（颜色已变化）: ${(performance.now() - startTime).toFixed(0)}ms`);
    // 阶段2：后台执行完整的 Associate（完全不阻塞，不等待）
    iccStore.applyProfile(profileId).then(() => {
      console.log(`[ICC] 系统配置同步完成: ${(performance.now() - startTime).toFixed(0)}ms`);
    }).catch((e) => {
      console.error(`[ICC] 系统配置同步失败: ${(performance.now() - startTime).toFixed(0)}ms`, e);
    });
  }).catch((e) => {
    // 回滚
    prevEnabled.forEach(({ id, enabled }) => {
      const p = profiles.value.find((pp) => pp.id === id);
      if (p) p.enabled = enabled;
    });
    console.error(`[ICC] 启用失败: ${(performance.now() - startTime).toFixed(0)}ms`, e);
    showToast("应用 ICC 配置失败", { type: "error" });
  });
}

async function onAdd() {
  if (!selectedMonitor.value) {
    showToast("请先选择显示器", { type: "error" });
    return;
  }

  const filePath = await iccStore.selectIccFile();
  if (!filePath) return;

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

  // 如果删除的是启用的配置，先恢复默认
  if (profile.enabled) {
    try {
      await iccStore.restoreDefault(profileId);
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

.refresh-btn:hover {
  border-color: var(--primary-color);
  color: var(--primary-color);
  background: var(--primary-bg);
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

.monitor-chip:hover {
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

.icc-item:hover {
  background: var(--hover-bg-strong);
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

.action-btn:hover {
  background: var(--border-color-strong);
}

.action-btn.danger {
  color: var(--error-color);
}

.action-btn.danger:hover {
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

.add-btn:hover {
  opacity: 0.9;
}

.no-monitor {
  text-align: center;
  color: var(--text-secondary);
  padding: 20px;
}
</style>
