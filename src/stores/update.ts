import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { downloadAndInstallUpdate } from '../utils/updater'

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
  chunk_length: number
  total: number | null
  percentage: number
}

export const useUpdateStore = defineStore('update', () => {
  const isChecking = ref(false)
  const isUpdating = ref(false)
  const updateInfo = ref<UpdateInfo | null>(null)
  const updateProgress = ref<UpdateProgress | null>(null)
  const error = ref<string | null>(null)
  const showUpdateDialog = ref(false)

  const hasUpdate = computed(() => updateInfo.value !== null)
  const currentVersion = ref('0.4.0')

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
    
    try {
      await downloadAndInstallUpdate()
    } catch (e) {
      error.value = e instanceof Error ? e.message : '更新失败'
    } finally {
      isUpdating.value = false
    }
  }

  function skipUpdate() {
    showUpdateDialog.value = false
    // 可以记录跳过的版本
  }

  function reset() {
    updateInfo.value = null
    updateProgress.value = null
    error.value = null
    showUpdateDialog.value = false
  }

  return {
    isChecking,
    isUpdating,
    updateInfo,
    updateProgress,
    error,
    showUpdateDialog,
    hasUpdate,
    currentVersion,
    checkForUpdate,
    startUpdate,
    skipUpdate,
    reset
  }
})