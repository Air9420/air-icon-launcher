<template>
  <div class="display-settings">
    <div class="section">
      <div class="section-title">显示器 ICC 配置管理</div>
      <div class="hint">选择显示器后，管理其颜色配置文件</div>

      <!-- 显示器选择列表 -->
      <div class="monitor-selector">
        <div class="selector-label">选择显示器：</div>
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
            <span v-if="monitor.isPrimary" class="chip-badge">主</span>
          </button>
        </div>
      </div>

      <!-- 选中显示器的 ICC 配置 -->
      <div v-if="selectedMonitor" class="monitor-detail">
        <div class="detail-header">
          <div class="detail-info">
            <span class="detail-name">{{ selectedMonitor.friendlyName }}</span>
            <span class="detail-device">{{ selectedMonitor.name }}</span>
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
import { computed, onMounted, ref } from "vue";
import { storeToRefs } from "pinia";
import { useIccStore } from "../../stores/iccStore";
import { showToast } from "../../composables/useGlobalToast";
import type { MonitorInfo, IccProfile } from "../../types/icc";

const iccStore = useIccStore();
const { profiles, monitors } = storeToRefs(iccStore);

const selectedMonitor = ref<MonitorInfo | null>(null);

onMounted(async () => {
  await iccStore.fetchMonitors();
  await iccStore.fetchProfiles();
  
  // 默认选中主显示器
  if (monitors.value.length > 0) {
    const primary = monitors.value.find((m) => m.isPrimary) || monitors.value[0];
    selectedMonitor.value = primary;
  }
});

// 当前选中显示器的 ICC 配置
const monitorProfiles = computed(() => {
  if (!selectedMonitor.value) return [];
  return profiles.value.filter((p) => p.monitorName === selectedMonitor.value!.name);
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

  // 如果已经启用，则禁用（取消选中）
  if (profile.enabled) {
    try {
      await iccStore.toggleProfile(profileId, false);
      await iccStore.restoreDefault(profileId);
      showToast("已恢复默认颜色", { type: "success" });
    } catch (e) {
      showToast("禁用 ICC 配置失败", { type: "error" });
    }
    return;
  }

  // 启用选中的配置（后端会自动禁用同一显示器的其他配置）
  try {
    await iccStore.toggleProfile(profileId, true);
    await iccStore.applyProfile(profileId);
    showToast("ICC 配置已应用", { type: "success" });
  } catch (e) {
    showToast("应用 ICC 配置失败", { type: "error" });
  }
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
    monitorName: selectedMonitor.value.name,
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
  try {
    await iccStore.removeProfile(profileId);
    showToast("ICC 配置已删除", { type: "success" });
  } catch (e) {
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

.selector-label {
  font-weight: 600;
  color: var(--text-color);
  font-size: 14px;
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

.detail-device {
  font-size: 12px;
  color: var(--text-secondary);
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
