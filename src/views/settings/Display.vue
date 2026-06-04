<template>
  <div class="display-settings">
    <div class="section">
      <div class="section-title">显示器 ICC 配置管理</div>
      <div class="hint">管理每个显示器的颜色配置文件</div>

      <div class="monitor-list">
        <div
          v-for="profile in profiles"
          :key="profile.id"
          class="monitor-card"
        >
          <div class="monitor-header">
            <div class="monitor-info">
              <span class="monitor-name">{{ profile.monitorName }}</span>
              <span class="icc-path" :title="profile.iccPath">
                ICC: {{ getFileName(profile.iccPath) || "未配置" }}
              </span>
            </div>
            <label class="toggle-switch">
              <input
                type="checkbox"
                :checked="profile.enabled"
                @change="onToggle(profile.id, $event)"
              />
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div class="monitor-actions">
            <button class="action-btn" @click="onModify(profile.id)">修改</button>
            <button class="action-btn danger" @click="onRemove(profile.id)">删除</button>
          </div>
        </div>

        <div v-if="profiles.length === 0" class="empty-state">
          暂无 ICC 配置，点击下方按钮添加
        </div>
      </div>

      <button class="add-btn" @click="onAdd">
        + 添加显示器 ICC 配置
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from "vue";
import { storeToRefs } from "pinia";
import { useIccStore } from "../../stores/iccStore";
import { showToast } from "../../composables/useGlobalToast";

const iccStore = useIccStore();
const { profiles } = storeToRefs(iccStore);

onMounted(async () => {
  await iccStore.fetchMonitors();
  await iccStore.fetchProfiles();
});

function getFileName(path: string): string {
  if (!path) return "";
  const parts = path.split("\\");
  return parts[parts.length - 1] || "";
}

async function onToggle(profileId: string, event: Event) {
  const target = event.target as HTMLInputElement;
  const enabled = target.checked;
  try {
    await iccStore.toggleProfile(profileId, enabled);
    if (enabled) {
      await iccStore.applyProfile(profileId);
      showToast("ICC 配置已应用", { type: "success" });
    } else {
      await iccStore.restoreDefault(profileId);
      showToast("已恢复默认 ICC 配置", { type: "success" });
    }
  } catch (e) {
    target.checked = !enabled;
    showToast("切换 ICC 配置失败", { type: "error" });
  }
}

async function onAdd() {
  const filePath = await iccStore.selectIccFile();
  if (!filePath) return;

  const monitors = iccStore.monitors;
  if (monitors.length === 0) {
    showToast("未检测到显示器", { type: "error" });
    return;
  }

  const monitor = monitors[0];
  const profile = {
    id: crypto.randomUUID(),
    monitorName: monitor.name,
    monitorDeviceId: monitor.deviceId,
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

async function onModify(profileId: string) {
  const filePath = await iccStore.selectIccFile();
  if (!filePath) return;

  const profile = profiles.value.find((p) => p.id === profileId);
  if (!profile) return;

  try {
    await iccStore.removeProfile(profileId);
    await iccStore.addProfile({
      ...profile,
      iccPath: filePath,
    });
    showToast("ICC 配置已更新", { type: "success" });
  } catch (e) {
    showToast("更新 ICC 配置失败", { type: "error" });
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
  gap: 8px;
}

.section-title {
  @include settings.section-title();
}

.hint {
  @include settings.hint();
}

.monitor-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.monitor-card {
  background: var(--hover-bg);
  border-radius: 10px;
  padding: 12px;
}

.monitor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.monitor-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.monitor-name {
  font-weight: 600;
  color: var(--text-color);
}

.icc-path {
  font-size: 12px;
  color: var(--text-secondary);
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.monitor-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.action-btn {
  border: 0;
  padding: 6px 12px;
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

.empty-state {
  text-align: center;
  color: var(--text-secondary);
  padding: 20px;
}

.add-btn {
  border: 0;
  padding: 10px;
  border-radius: 10px;
  background: var(--primary-bg);
  cursor: pointer;
  color: var(--primary-color);
  font-weight: 600;
}

.add-btn:hover {
  opacity: 0.9;
}

.toggle-switch {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--border-color-strong);
  transition: 0.2s;
  border-radius: 24px;
}

.toggle-slider:before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: 0.2s;
  border-radius: 50%;
}

.toggle-switch input:checked + .toggle-slider {
  background-color: var(--primary-color);
}

.toggle-switch input:checked + .toggle-slider:before {
  transform: translateX(20px);
}
</style>
