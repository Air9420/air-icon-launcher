import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getVersion } from '@tauri-apps/api/app'
import { downloadAndInstallUpdate, restartApplication } from '../utils/updater'

export const AUTO_RESTART_DELAY_MS = 1000

export type UpdatePhase = 'idle' | 'downloading' | 'restarting' | 'error'

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms))
}

export interface UpdateInfo {
  version: string
  notes: string
  pub_date: string
  platforms: {
    [key: string]: {
      signature: string
      url: string
    }
  }
}

export interface UpdateProgress {
  downloaded: number
  total: number
  percentage: number
}

export const useUpdateStore = defineStore('update', () => {
  const isChecking = ref(false)
  const isUpdating = ref(false)
  const updateInfo = ref<UpdateInfo | null>(null)
  const updateProgress = ref<UpdateProgress | null>(null)
  const error = ref<string | null>(null)
  const showUpdateDialog = ref(false)
  const downloadComplete = ref(false)
  const updateFilePath = ref<string | null>(null)
  const updatePhase = ref<UpdatePhase>('idle')

  const hasUpdate = computed(() => updateInfo.value !== null)
  const currentVersion = ref('...')

  // 获取实际版本号
  async function initVersion() {
    try {
      currentVersion.value = await getVersion()
    } catch (e) {
      console.error('获取版本号失败:', e)
      currentVersion.value = 'unknown'
    }
  }

  // 初始化版本号
  initVersion()

  async function checkForUpdate() {
    isChecking.value = true
    error.value = null
    
    try {
      // 这里将调用Tauri的更新检查
      // 实际实现需要调用invoke命令
      console.log('检查更新...')
    } catch (e) {
      error.value = e instanceof Error ? e.message : '检查更新失败'
    } finally {
      isChecking.value = false
    }
  }

  async function startUpdate() {
    if (!updateInfo.value) return
    
    isUpdating.value = true
    error.value = null
    downloadComplete.value = false
    updateProgress.value = { downloaded: 0, total: 0, percentage: 0 }
    updatePhase.value = 'downloading'
    
    try {
      await downloadAndInstallUpdate()
      downloadComplete.value = true
      updatePhase.value = 'restarting'
      await wait(AUTO_RESTART_DELAY_MS)
      await restartApplication()
    } catch (e) {
      error.value = e instanceof Error ? e.message : '更新失败'
      updatePhase.value = 'error'
      isUpdating.value = false
    }
  }

  async function confirmRestart() {
    error.value = null
    updatePhase.value = 'restarting'

    try {
      await restartApplication()
    } catch (e) {
      error.value = e instanceof Error ? e.message : '重启失败'
      updatePhase.value = 'error'
      isUpdating.value = false
    }
  }

  function skipUpdate() {
    showUpdateDialog.value = false
    downloadComplete.value = false
    updateFilePath.value = null
    updatePhase.value = 'idle'
    // 可以记录跳过的版本
  }

  function reset() {
    updateInfo.value = null
    updateProgress.value = null
    error.value = null
    showUpdateDialog.value = false
    downloadComplete.value = false
    updateFilePath.value = null
    updatePhase.value = 'idle'
  }

  return {
    isChecking,
    isUpdating,
    updateInfo,
    updateProgress,
    error,
    showUpdateDialog,
    downloadComplete,
    updateFilePath,
    updatePhase,
    hasUpdate,
    currentVersion,
    checkForUpdate,
    startUpdate,
    confirmRestart,
    skipUpdate,
    reset
  }
})
