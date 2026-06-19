import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getVersion } from '@tauri-apps/api/app'
import { downloadAndInstallUpdate, restartApplication } from '../utils/updater'

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
    
    try {
      await downloadAndInstallUpdate()
    } catch (e) {
      error.value = e instanceof Error ? e.message : '更新失败'
    } finally {
      isUpdating.value = false
    }
  }

  async function confirmRestart() {
    try {
      await restartApplication()
    } catch (e) {
      error.value = e instanceof Error ? e.message : '重启失败'
    }
  }

  function skipUpdate() {
    showUpdateDialog.value = false
    downloadComplete.value = false
    updateFilePath.value = null
    // 可以记录跳过的版本
  }

  function reset() {
    updateInfo.value = null
    updateProgress.value = null
    error.value = null
    showUpdateDialog.value = false
    downloadComplete.value = false
    updateFilePath.value = null
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
    hasUpdate,
    currentVersion,
    checkForUpdate,
    startUpdate,
    confirmRestart,
    skipUpdate,
    reset
  }
})