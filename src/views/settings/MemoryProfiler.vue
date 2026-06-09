<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { invoke } from '../../utils/invoke-wrapper'

interface ProcessMemoryInfo {
  workingSetSizeMb: number
  privateUsageMb: number
  peakWorkingSetSizeMb: number
  pageFileUsageMb: number
}

interface ModuleMemoryInfo {
  estimatedBytes: number
  itemCount: number
  capacity: number
  description: string
}

interface ClipboardMemoryStats {
  cacheRecords: number
  cacheCapacity: number
  hashIndexSize: number
  contentIndexSize: number
  bufferHashesSize: number
  estimatedTotalBytes: number
  databaseConnected: boolean
  imagesDirExists: boolean
}

interface SearchMemoryStats {
  indexedItems: number
  indexCapacity: number
  estimatedTotalBytes: number
}

interface ConfigMemoryStats {
  configLoaded: boolean
  launcherDataLoaded: boolean
  estimatedTotalBytes: number
}

interface MemoryRecommendation {
  severity: string
  module: string
  issue: string
  suggestion: string
  estimatedSavingsMb: number
}

interface MemoryBreakdown {
  estimatedRustHeapMb: number
  estimatedRuntimeMb: number
  estimatedSharedLibrariesMb: number
  estimatedGpuMemoryMb: number
  unaccountedMb: number
}

interface MemoryStats {
  processMemory: ProcessMemoryInfo
  memoryBreakdown: MemoryBreakdown
  moduleStats: Record<string, ModuleMemoryInfo>
  clipboardStats: ClipboardMemoryStats
  searchStats: SearchMemoryStats
  configStats: ConfigMemoryStats
  recommendations: MemoryRecommendation[]
}

const stats = ref<MemoryStats | null>(null)
const loading = ref(false)
const cleanupReport = ref('')
const error = ref('')

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

const formatMb = (mb: number): string => {
  return mb.toFixed(2) + ' MB'
}

const getBreakdownPercent = (type: string): number => {
  if (!stats.value) return 0
  const total = stats.value.processMemory.privateUsageMb
  if (total === 0) return 0
  
  const breakdown = stats.value.memoryBreakdown
  let value = 0
  
  switch (type) {
    case 'rustHeap':
      value = breakdown.estimatedRustHeapMb
      break
    case 'runtime':
      value = breakdown.estimatedRuntimeMb
      break
    case 'sharedLibs':
      value = breakdown.estimatedSharedLibrariesMb
      break
    case 'gpu':
      value = breakdown.estimatedGpuMemoryMb
      break
    case 'unaccounted':
      value = breakdown.unaccountedMb
      break
  }
  
  return (value / total) * 100
}

const getSeverityColor = (severity: string): string => {
  switch (severity) {
    case 'critical': return '#ef4444'
    case 'warning': return '#f59e0b'
    case 'info': return '#3b82f6'
    default: return '#6b7280'
  }
}

const getSeverityIcon = (severity: string): string => {
  switch (severity) {
    case 'critical': return '❌'
    case 'warning': return '⚠️'
    case 'info': return 'ℹ️'
    default: return '💡'
  }
}

const fetchStats = async () => {
  loading.value = true
  error.value = ''
  try {
    const result = await invoke<MemoryStats>('get_memory_stats')
    if (result && typeof result === 'object' && 'ok' in result) {
      if (result.ok) {
        stats.value = result.value
      } else {
        error.value = `获取内存统计失败: ${result.error}`
      }
    } else {
      stats.value = result as MemoryStats
    }
  } catch (e) {
    error.value = `获取内存统计失败: ${e}`
    console.error('Failed to fetch memory stats:', e)
  } finally {
    loading.value = false
  }
}

const forceCleanup = async () => {
  loading.value = true
  error.value = ''
  try {
    const result = await invoke<string>('force_memory_cleanup')
    if (result && typeof result === 'object' && 'ok' in result) {
      if (result.ok) {
        cleanupReport.value = result.value
      } else {
        error.value = `强制清理失败: ${result.error}`
      }
    } else {
      cleanupReport.value = result as string
    }
    // 重新获取统计
    await fetchStats()
  } catch (e) {
    error.value = `强制清理失败: ${e}`
    console.error('Failed to force cleanup:', e)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchStats()
})
</script>

<template>
  <div class="memory-profiler">
    <div class="header">
      <h2>内存分析</h2>
      <div class="actions">
        <button @click="fetchStats" :disabled="loading" class="btn btn-primary">
          {{ loading ? '加载中...' : '刷新统计' }}
        </button>
        <button @click="forceCleanup" :disabled="loading" class="btn btn-warning">
          强制清理内存
        </button>
      </div>
    </div>

    <div v-if="error" class="error-message">
      {{ error }}
    </div>

    <div v-if="cleanupReport" class="cleanup-report">
      <h3>清理报告</h3>
      <pre>{{ cleanupReport }}</pre>
    </div>

    <div v-if="stats" class="stats-container">
      <!-- 进程内存信息 -->
      <div class="section">
        <h3>进程内存</h3>
        <div class="stats-grid">
          <div class="stat-card highlight">
            <div class="stat-label">私有使用 (任务管理器显示)</div>
            <div class="stat-value">{{ formatMb(stats.processMemory.privateUsageMb) }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">工作集大小 (含共享内存)</div>
            <div class="stat-value">{{ formatMb(stats.processMemory.workingSetSizeMb) }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">峰值工作集</div>
            <div class="stat-value">{{ formatMb(stats.processMemory.peakWorkingSetSizeMb) }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">页面文件使用</div>
            <div class="stat-value">{{ formatMb(stats.processMemory.pageFileUsageMb) }}</div>
          </div>
        </div>
      </div>

      <!-- 内存分布估算 -->
      <div class="section">
        <h3>内存分布估算</h3>
        <div class="breakdown-chart">
          <div class="breakdown-bar">
            <div 
              class="breakdown-segment rust-heap" 
              :style="{ width: getBreakdownPercent('rustHeap') + '%' }"
              :title="'Rust 堆内存: ' + formatMb(stats.memoryBreakdown.estimatedRustHeapMb)"
            ></div>
            <div 
              class="breakdown-segment runtime" 
              :style="{ width: getBreakdownPercent('runtime') + '%' }"
              :title="'Tauri/WebView2 运行时: ' + formatMb(stats.memoryBreakdown.estimatedRuntimeMb)"
            ></div>
            <div 
              class="breakdown-segment shared-libs" 
              :style="{ width: getBreakdownPercent('sharedLibs') + '%' }"
              :title="'共享库 (DLL): ' + formatMb(stats.memoryBreakdown.estimatedSharedLibrariesMb)"
            ></div>
            <div 
              class="breakdown-segment gpu" 
              :style="{ width: getBreakdownPercent('gpu') + '%' }"
              :title="'GPU 内存: ' + formatMb(stats.memoryBreakdown.estimatedGpuMemoryMb)"
            ></div>
            <div 
              class="breakdown-segment unaccounted" 
              :style="{ width: getBreakdownPercent('unaccounted') + '%' }"
              :title="'其他/未分类: ' + formatMb(stats.memoryBreakdown.unaccountedMb)"
            ></div>
          </div>
          <div class="breakdown-legend">
            <div class="legend-item">
              <div class="legend-color rust-heap"></div>
              <span>Rust 堆: {{ formatMb(stats.memoryBreakdown.estimatedRustHeapMb) }}</span>
            </div>
            <div class="legend-item">
              <div class="legend-color runtime"></div>
              <span>运行时: {{ formatMb(stats.memoryBreakdown.estimatedRuntimeMb) }}</span>
            </div>
            <div class="legend-item">
              <div class="legend-color shared-libs"></div>
              <span>共享库: {{ formatMb(stats.memoryBreakdown.estimatedSharedLibrariesMb) }}</span>
            </div>
            <div class="legend-item">
              <div class="legend-color gpu"></div>
              <span>GPU: {{ formatMb(stats.memoryBreakdown.estimatedGpuMemoryMb) }}</span>
            </div>
            <div class="legend-item">
              <div class="legend-color unaccounted"></div>
              <span>其他: {{ formatMb(stats.memoryBreakdown.unaccountedMb) }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 模块内存统计 -->
      <div class="section">
        <h3>模块内存统计</h3>
        <div class="stats-grid">
          <div v-for="(module, name) in stats.moduleStats" :key="name" class="stat-card">
            <div class="stat-label">{{ module.description }}</div>
            <div class="stat-value">{{ formatBytes(module.estimatedBytes) }}</div>
            <div class="stat-detail">
              项目数: {{ module.itemCount }} / 容量: {{ module.capacity }}
            </div>
          </div>
        </div>
      </div>

      <!-- 剪贴板详细统计 -->
      <div class="section">
        <h3>剪贴板缓存详情</h3>
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">缓存记录数</div>
            <div class="stat-value">{{ stats.clipboardStats.cacheRecords }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">缓存容量</div>
            <div class="stat-value">{{ stats.clipboardStats.cacheCapacity }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">哈希索引大小</div>
            <div class="stat-value">{{ stats.clipboardStats.hashIndexSize }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">内容索引大小</div>
            <div class="stat-value">{{ stats.clipboardStats.contentIndexSize }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">缓冲区哈希大小</div>
            <div class="stat-value">{{ stats.clipboardStats.bufferHashesSize }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">数据库连接</div>
            <div class="stat-value">{{ stats.clipboardStats.databaseConnected ? '是' : '否' }}</div>
          </div>
        </div>
      </div>

      <!-- 搜索索引统计 -->
      <div class="section">
        <h3>搜索索引</h3>
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">索引项目数</div>
            <div class="stat-value">{{ stats.searchStats.indexedItems }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">索引容量</div>
            <div class="stat-value">{{ stats.searchStats.indexCapacity }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">估算内存</div>
            <div class="stat-value">{{ formatBytes(stats.searchStats.estimatedTotalBytes) }}</div>
          </div>
        </div>
      </div>

      <!-- 内存建议 -->
      <div class="section">
        <h3>内存优化建议</h3>
        <div v-if="stats.recommendations.length === 0" class="no-recommendations">
          暂无内存优化建议
        </div>
        <div v-else class="recommendations-list">
          <div
            v-for="(rec, index) in stats.recommendations"
            :key="index"
            class="recommendation-card"
            :style="{ borderLeftColor: getSeverityColor(rec.severity) }"
          >
            <div class="recommendation-header">
              <span class="severity-icon">{{ getSeverityIcon(rec.severity) }}</span>
              <span class="module-name">{{ rec.module }}</span>
              <span v-if="rec.estimatedSavingsMb > 0" class="savings">
                预计可节省: {{ formatMb(rec.estimatedSavingsMb) }}
              </span>
            </div>
            <div class="recommendation-issue">{{ rec.issue }}</div>
            <div class="recommendation-suggestion">{{ rec.suggestion }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.memory-profiler {
  padding: 20px;
  max-width: 1200px;
  margin: 0 auto;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;

  h2 {
    margin: 0;
    font-size: 24px;
    font-weight: 600;
  }

  .actions {
    display: flex;
    gap: 12px;
  }
}

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &.btn-primary {
    background: #3b82f6;
    color: white;

    &:hover:not(:disabled) {
      background: #2563eb;
    }
  }

  &.btn-warning {
    background: #f59e0b;
    color: white;

    &:hover:not(:disabled) {
      background: #d97706;
    }
  }
}

.error-message {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #dc2626;
  padding: 12px;
  border-radius: 6px;
  margin-bottom: 16px;
}

.cleanup-report {
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  padding: 16px;
  border-radius: 6px;
  margin-bottom: 16px;

  h3 {
    margin: 0 0 8px 0;
    font-size: 16px;
    color: #166534;
  }

  pre {
    margin: 0;
    font-family: monospace;
    font-size: 13px;
    white-space: pre-wrap;
    color: #15803d;
  }
}

.section {
  margin-bottom: 24px;

  h3 {
    margin: 0 0 16px 0;
    font-size: 18px;
    font-weight: 600;
    color: #374151;
  }
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}

.stat-card {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 16px;

  &.highlight {
    border-color: #3b82f6;
    background: #eff6ff;
    
    .stat-value {
      color: #1d4ed8;
      font-size: 24px;
    }
  }

  .stat-label {
    font-size: 13px;
    color: #6b7280;
    margin-bottom: 4px;
  }

  .stat-value {
    font-size: 20px;
    font-weight: 600;
    color: #111827;
  }

  .stat-detail {
    font-size: 12px;
    color: #9ca3af;
    margin-top: 4px;
  }
}

.no-recommendations {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 24px;
  text-align: center;
  color: #6b7280;
}

.recommendations-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.recommendation-card {
  background: white;
  border: 1px solid #e5e7eb;
  border-left: 4px solid;
  border-radius: 8px;
  padding: 16px;

  .recommendation-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;

    .severity-icon {
      font-size: 16px;
    }

    .module-name {
      font-weight: 600;
      color: #374151;
    }

    .savings {
      margin-left: auto;
      font-size: 13px;
      color: #059669;
      background: #ecfdf5;
      padding: 2px 8px;
      border-radius: 4px;
    }
  }

  .recommendation-issue {
    font-size: 14px;
    color: #374151;
    margin-bottom: 4px;
  }

  .recommendation-suggestion {
    font-size: 13px;
    color: #6b7280;
  }
}

.breakdown-chart {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 16px;
}

.breakdown-bar {
  height: 24px;
  display: flex;
  border-radius: 4px;
  overflow: hidden;
  background: #f3f4f6;
  margin-bottom: 12px;
}

.breakdown-segment {
  height: 100%;
  transition: width 0.3s ease;
  
  &.rust-heap {
    background: #3b82f6;
  }
  
  &.runtime {
    background: #8b5cf6;
  }
  
  &.shared-libs {
    background: #06b6d4;
  }
  
  &.gpu {
    background: #10b981;
  }
  
  &.unaccounted {
    background: #6b7280;
  }
}

.breakdown-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #374151;
}

.legend-color {
  width: 12px;
  height: 12px;
  border-radius: 2px;
  
  &.rust-heap {
    background: #3b82f6;
  }
  
  &.runtime {
    background: #8b5cf6;
  }
  
  &.shared-libs {
    background: #06b6d4;
  }
  
  &.gpu {
    background: #10b981;
  }
  
  &.unaccounted {
    background: #6b7280;
  }
}
</style>
