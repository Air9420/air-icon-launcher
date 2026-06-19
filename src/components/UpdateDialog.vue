<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useUpdateStore } from '../stores/update'

const updateStore = useUpdateStore()

// 懒加载 marked
const markedModule = ref<typeof import('marked') | null>(null)

// 当更新对话框显示时才加载 marked
watch(() => updateStore.showUpdateDialog, async (visible) => {
  if (visible && !markedModule.value) {
    markedModule.value = await import('marked')
    markedModule.value.marked.setOptions({
      breaks: true,
      gfm: true
    })
  }
}, { immediate: true })

const isVisible = computed(() => updateStore.showUpdateDialog)
const updateInfo = computed(() => updateStore.updateInfo)
const isUpdating = computed(() => updateStore.isUpdating)
const progress = computed(() => updateStore.updateProgress?.percentage || 0)
const error = computed(() => updateStore.error)
const downloadComplete = computed(() => updateStore.downloadComplete)

// 渲染 Markdown 内容
const renderedNotes = computed(() => {
  if (!updateInfo.value?.notes || !markedModule.value) return ''
  return markedModule.value.marked.parse(updateInfo.value.notes)
})

function handleSkip() {
  updateStore.skipUpdate()
}

function handleUpdate() {
  updateStore.startUpdate()
}

function handleRestart() {
  updateStore.confirmRestart()
}
</script>

<template>
  <div v-if="isVisible" class="update-overlay">
    <div class="update-dialog">
      <div class="update-header">
        <h3>{{ downloadComplete ? '更新已下载' : '发现新版本' }} v{{ updateInfo?.version }}</h3>
        <button class="close-btn" @click="handleSkip" :disabled="isUpdating">×</button>
      </div>
      
      <div class="update-content">
        <div v-if="!downloadComplete" class="current-version">
          当前版本: v{{ updateStore.currentVersion }}
        </div>
        
        <div v-if="!downloadComplete && updateInfo?.notes" class="release-notes">
          <h4>更新内容：</h4>
          <div class="notes-content markdown-body" v-html="renderedNotes"></div>
        </div>
        
        <div v-if="downloadComplete" class="download-complete">
          <div class="complete-icon">✓</div>
          <p>更新包已下载完成，点击"立即重启"应用更新。</p>
        </div>
      </div>
      
      <div v-if="error" class="update-error">
        {{ error }}
      </div>
      
      <div v-if="isUpdating" class="update-progress">
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: `${progress}%` }"></div>
        </div>
        <div class="progress-info">
          <span class="progress-text">{{ progress }}%</span>
          <span v-if="updateStore.updateProgress?.total" class="progress-size">
            {{ Math.round((updateStore.updateProgress?.downloaded || 0) / 1024 / 1024 * 100) / 100 }}MB / 
            {{ Math.round((updateStore.updateProgress?.total || 0) / 1024 / 1024 * 100) / 100 }}MB
          </span>
        </div>
      </div>
      
      <div class="update-actions">
        <template v-if="!downloadComplete">
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
            {{ isUpdating ? '下载中...' : '立即更新' }}
          </button>
        </template>
        <template v-else>
          <button 
            class="btn btn-secondary" 
            @click="handleSkip"
          >
            稍后重启
          </button>
          <button 
            class="btn btn-primary" 
            @click="handleRestart"
          >
            立即重启
          </button>
        </template>
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
  background: rgba(var(--floating-panel-rgb), 0.86);
  border-radius: 12px;
  width: 400px;
  max-width: 90vw;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  overflow: hidden;
}

.update-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  background: var(--hover-bg);
  color: var(--text-color);
  
  h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }
  
  .close-btn {
    background: none;
    border: none;
    color: var(--text-color-secondary);
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
      background: var(--hover-bg-strong);
    }
  }
}

.update-content {
  padding: 24px;
}

.current-version {
  color: var(--text-color-secondary);
  font-size: 14px;
  margin-bottom: 16px;
}

.release-notes {
  h4 {
    margin: 0 0 8px 0;
    font-size: 14px;
    color: var(--text-color);
  }
  
  .notes-content {
    background: var(--hover-bg);
    padding: 12px;
    border-radius: 8px;
    font-size: 14px;
    line-height: 1.5;
    max-height: 200px;
    overflow-y: auto;
  }
}

// Markdown 样式
.markdown-body {
  :deep(h1),
  :deep(h2),
  :deep(h3),
  :deep(h4) {
    margin-top: 12px;
    margin-bottom: 8px;
    font-weight: 600;
    color: var(--text-color);
  }

  :deep(h1) { font-size: 18px; }
  :deep(h2) { font-size: 16px; }
  :deep(h3) { font-size: 15px; }
  :deep(h4) { font-size: 14px; }

  :deep(p) {
    margin: 8px 0;
    line-height: 1.6;
  }

  :deep(ul),
  :deep(ol) {
    margin: 8px 0;
    padding-left: 20px;
  }

  :deep(li) {
    margin: 4px 0;
    line-height: 1.5;
  }

  :deep(strong) {
    font-weight: 600;
    color: var(--text-color);
  }

  :deep(em) {
    font-style: italic;
  }

  :deep(code) {
    background: var(--hover-bg);
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 13px;
    font-family: 'Consolas', 'Monaco', monospace;
  }

  :deep(pre) {
    background: var(--hover-bg-strong);
    color: var(--text-color);
    padding: 12px;
    border-radius: 8px;
    overflow-x: auto;
    margin: 8px 0;

    code {
      background: none;
      padding: 0;
      color: inherit;
    }
  }

  :deep(a) {
    color: var(--primary-color, #667eea);
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }

  :deep(hr) {
    border: none;
    border-top: 1px solid var(--border-color, #e0e0e0);
    margin: 12px 0;
  }

  :deep(blockquote) {
    border-left: 3px solid var(--primary-color, #667eea);
    margin: 8px 0;
    padding: 4px 12px;
    color: var(--text-color-secondary);
    background: var(--hover-bg);
  }
}

.update-error {
  margin: 0 24px 16px;
  padding: 12px;
  background: rgba(var(--error-color-rgb, 229, 57, 53), 0.1);
  border: 1px solid rgba(var(--error-color-rgb, 229, 57, 53), 0.3);
  border-radius: 8px;
  color: var(--error-color, #e53935);
  font-size: 14px;
}

.update-progress {
  padding: 0 24px 16px;
  
  .progress-bar {
    height: 8px;
    background: var(--hover-bg);
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 8px;
    
    .progress-fill {
      height: 100%;
      background: var(--primary-color, #667eea);
      transition: width 0.3s ease;
    }
  }
  
  .progress-info {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    color: var(--text-color-secondary);
  }
}

.download-complete {
  text-align: center;
  padding: 20px 0;
  
  .complete-icon {
    width: 60px;
    height: 60px;
    margin: 0 auto 16px;
    background: var(--primary-color, #667eea);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-size: 30px;
  }
  
  p {
    color: var(--text-color);
    font-size: 14px;
    line-height: 1.5;
  }
}

.update-actions {
  display: flex;
  gap: 10px;
  padding: 16px 24px 24px;
  justify-content: flex-end;
}

.btn {
  padding: 8px 16px;
  border-radius: 8px;
  border: none;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  
  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
}

.btn-secondary {
  background: var(--hover-bg);
  color: var(--text-color);
  
  &:hover:not(:disabled) {
    background: var(--hover-bg-strong);
  }
}

.btn-primary {
  background: var(--error-color, #e53935);
  color: white;
  
  &:hover:not(:disabled) {
    opacity: 0.9;
  }
}
</style>
