<script setup lang="ts">
import { computed } from 'vue'
import { useUpdateStore } from '../stores/update'

const updateStore = useUpdateStore()

const isVisible = computed(() => updateStore.showUpdateDialog)
const updateInfo = computed(() => updateStore.updateInfo)
const isUpdating = computed(() => updateStore.isUpdating)
const progress = computed(() => updateStore.updateProgress?.percentage || 0)
const error = computed(() => updateStore.error)

function handleSkip() {
  updateStore.skipUpdate()
}

function handleUpdate() {
  updateStore.startUpdate()
}
</script>

<template>
  <div v-if="isVisible" class="update-overlay">
    <div class="update-dialog">
      <div class="update-header">
        <h3>发现新版本 v{{ updateInfo?.version }}</h3>
        <button class="close-btn" @click="handleSkip">×</button>
      </div>
      
      <div class="update-content">
        <div class="current-version">
          当前版本: v{{ updateStore.currentVersion }}
        </div>
        
        <div v-if="updateInfo?.notes" class="release-notes">
          <h4>更新内容：</h4>
          <div class="notes-content">{{ updateInfo.notes }}</div>
        </div>
      </div>
      
      <div v-if="error" class="update-error">
        {{ error }}
      </div>
      
      <div v-if="isUpdating" class="update-progress">
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: `${progress}%` }"></div>
        </div>
        <span class="progress-text">{{ progress }}%</span>
      </div>
      
      <div class="update-actions">
        <button 
          class="btn btn-secondary" 
          @click="handleSkip"
          :disabled="isUpdating"
        >
          稍后提醒
        </button>
        <button 
          class="btn btn-primary" 
          @click="handleUpdate"
          :disabled="isUpdating"
        >
          {{ isUpdating ? '更新中...' : '立即更新' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.update-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.update-dialog {
  background: white;
  border-radius: 12px;
  width: 400px;
  max-width: 90vw;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  overflow: hidden;
}

.update-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  
  h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }
  
  .close-btn {
    background: none;
    border: none;
    color: white;
    font-size: 24px;
    cursor: pointer;
    padding: 0;
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    
    &:hover {
      background: rgba(255, 255, 255, 0.2);
    }
  }
}

.update-content {
  padding: 24px;
}

.current-version {
  color: #666;
  font-size: 14px;
  margin-bottom: 16px;
}

.release-notes {
  h4 {
    margin: 0 0 8px 0;
    font-size: 14px;
    color: #333;
  }
  
  .notes-content {
    background: #f5f5f5;
    padding: 12px;
    border-radius: 8px;
    font-size: 14px;
    line-height: 1.5;
    max-height: 200px;
    overflow-y: auto;
  }
}

.update-error {
  margin: 0 24px 16px;
  padding: 12px;
  background: #fee;
  border: 1px solid #fcc;
  border-radius: 8px;
  color: #c33;
  font-size: 14px;
}

.update-progress {
  padding: 0 24px 16px;
  
  .progress-bar {
    height: 8px;
    background: #eee;
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 8px;
    
    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
      transition: width 0.3s ease;
    }
  }
  
  .progress-text {
    font-size: 14px;
    color: #666;
  }
}

.update-actions {
  display: flex;
  gap: 12px;
  padding: 16px 24px 24px;
  justify-content: flex-end;
}

.btn {
  padding: 10px 20px;
  border-radius: 8px;
  border: none;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  
  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
}

.btn-secondary {
  background: #f0f0f0;
  color: #666;
  
  &:hover:not(:disabled) {
    background: #e0e0e0;
  }
}

.btn-primary {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  
  &:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
  }
}
</style>
