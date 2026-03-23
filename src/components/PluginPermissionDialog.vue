<script setup lang="ts">
import { computed } from "vue";
import type { Permission, RiskLevel } from "../plugins/permissions";
import { PERMISSION_DEFINITIONS } from "../plugins/permissions";

interface Props {
  visible: boolean;
  pluginName: string;
  permissions: Permission[];
}

const props = defineProps<Props>();

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();

interface PermissionItem {
  id: Permission;
  description: string;
  risk: RiskLevel;
}

const permissionItems = computed<PermissionItem[]>(() => {
  return props.permissions
    .filter((p) => PERMISSION_DEFINITIONS[p])
    .map((p) => ({
      id: p,
      description: PERMISSION_DEFINITIONS[p].description,
      risk: PERMISSION_DEFINITIONS[p].risk,
    }));
});

const hasHighRisk = computed(() => {
  return permissionItems.value.some((p) => p.risk === "high");
});

const groupedPermissions = computed(() => {
  const groups: Record<RiskLevel, PermissionItem[]> = {
    low: [],
    medium: [],
    high: [],
  };
  
  for (const item of permissionItems.value) {
    groups[item.risk].push(item);
  }
  
  return groups;
});

function getRiskLabel(risk: RiskLevel): string {
  switch (risk) {
    case "low":
      return "低风险";
    case "medium":
      return "中风险";
    case "high":
      return "高风险";
  }
}

function getRiskClass(risk: RiskLevel): string {
  return `risk-${risk}`;
}

function handleConfirm() {
  emit("confirm");
}

function handleCancel() {
  emit("cancel");
}
</script>

<template>
  <div v-if="visible" class="permission-dialog-overlay" @click.self="handleCancel">
    <div class="permission-dialog">
      <div class="dialog-header">
        <h2>插件权限请求</h2>
        <button class="close-btn" @click="handleCancel">×</button>
      </div>
      
      <div class="dialog-body">
        <p class="plugin-name">
          <strong>{{ pluginName }}</strong> 请求以下权限：
        </p>
        
        <div v-if="hasHighRisk" class="warning-box">
          <span class="warning-icon">⚠️</span>
          <span>此插件请求高风险权限，请确认您信任此插件来源</span>
        </div>
        
        <div class="permissions-container">
          <div v-if="groupedPermissions.high.length > 0" class="permission-group">
            <div class="group-header high">
              <span class="risk-badge high">高风险</span>
              <span>请谨慎授权</span>
            </div>
            <div class="permission-list">
              <div
                v-for="item in groupedPermissions.high"
                :key="item.id"
                class="permission-item high"
              >
                <span class="permission-desc">{{ item.description }}</span>
              </div>
            </div>
          </div>
          
          <div v-if="groupedPermissions.medium.length > 0" class="permission-group">
            <div class="group-header medium">
              <span class="risk-badge medium">中风险</span>
            </div>
            <div class="permission-list">
              <div
                v-for="item in groupedPermissions.medium"
                :key="item.id"
                class="permission-item medium"
              >
                <span class="permission-desc">{{ item.description }}</span>
              </div>
            </div>
          </div>
          
          <div v-if="groupedPermissions.low.length > 0" class="permission-group">
            <div class="group-header low">
              <span class="risk-badge low">低风险</span>
            </div>
            <div class="permission-list">
              <div
                v-for="item in groupedPermissions.low"
                :key="item.id"
                class="permission-item low"
              >
                <span class="permission-desc">{{ item.description }}</span>
              </div>
            </div>
          </div>
        </div>
        
        <div class="security-notice">
          <span class="notice-icon">ℹ️</span>
          <span>本插件系统不提供强安全隔离，请勿安装不信任的插件</span>
        </div>
      </div>
      
      <div class="dialog-footer">
        <button class="btn cancel" @click="handleCancel">取消</button>
        <button
          :class="['btn', 'confirm', { danger: hasHighRisk }]"
          @click="handleConfirm"
        >
          {{ hasHighRisk ? '我已了解风险，确认安装' : '确认安装' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.permission-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.permission-dialog {
  background: var(--bg-color, #1e1e1e);
  border-radius: 12px;
  width: 90%;
  max-width: 420px;
  max-height: 80vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color, #333);
  
  h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: var(--text-color, #fff);
  }
  
  .close-btn {
    background: none;
    border: none;
    font-size: 24px;
    color: var(--text-secondary, #888);
    cursor: pointer;
    padding: 0;
    line-height: 1;
    
    &:hover {
      color: var(--text-color, #fff);
    }
  }
}

.dialog-body {
  padding: 16px 20px;
  overflow-y: auto;
  flex: 1;
  
  .plugin-name {
    margin: 0 0 12px 0;
    color: var(--text-color, #fff);
    
    strong {
      color: var(--primary-color, #4a9eff);
    }
  }
}

.warning-box {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: rgba(255, 152, 0, 0.15);
  border: 1px solid rgba(255, 152, 0, 0.3);
  border-radius: 8px;
  margin-bottom: 16px;
  color: #ffb74d;
  font-size: 13px;
  
  .warning-icon {
    font-size: 16px;
  }
}

.permissions-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}

.permission-group {
  .group-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    font-size: 13px;
    color: var(--text-secondary, #888);
    
    &.high {
      color: #ff6b6b;
    }
    
    &.medium {
      color: #ffb74d;
    }
    
    &.low {
      color: #69db7c;
    }
  }
}

.risk-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  
  &.high {
    background: rgba(255, 107, 107, 0.2);
    color: #ff6b6b;
  }
  
  &.medium {
    background: rgba(255, 183, 77, 0.2);
    color: #ffb74d;
  }
  
  &.low {
    background: rgba(105, 219, 124, 0.2);
    color: #69db7c;
  }
}

.permission-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.permission-item {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  background: var(--card-bg, #252525);
  border-radius: 6px;
  border-left: 3px solid transparent;
  
  &.high {
    border-left-color: #ff6b6b;
    background: rgba(255, 107, 107, 0.16);
  }
  
  &.medium {
    border-left-color: #ffb74d;
    background: rgba(255, 183, 77, 0.16);
  }
  
  &.low {
    border-left-color: #69db7c;
    background: rgba(105, 219, 124, 0.16);
  }
  
  .permission-desc {
    font-size: 13px;
    color: var(--text-color, #fff);
  }
}

.security-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: rgba(179, 179, 179, 0.16);
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-secondary, #888);
  
  .notice-icon {
    font-size: 14px;
  }
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--border-color, #333);
}

.btn {
  padding: 10px 20px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: all 0.2s;
  
  &.cancel {
    background: var(--card-bg, #333);
    color: var(--text-secondary, #888);
    
    &:hover {
      background: var(--hover-bg, #444);
      color: var(--text-color, #fff);
    }
  }
  
  &.confirm {
    background: var(--primary-color, #4a9eff);
    color: #fff;
    
    &:hover {
      background: var(--primary-hover, #3a8eef);
    }
    
    &.danger {
      background: #ff6b6b;
      
      &:hover {
        background: #ff5252;
      }
    }
  }
}
</style>
