import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getVersion } from '@tauri-apps/api/app'
import {
  downloadAndInstallUpdate,
  restartApplication,
  getUpdatePrefs,
  setUpdatePrefs,
  getUpdateLog,
  clearUpdateLog,
  clearUpdateCache,
  getUpdateCacheInfo
} from '../utils/updater'
import type { UpdatePrefs, SourceProbe, UpdateCacheInfo } from '../utils/updater'

export const AUTO_RESTART_DELAY_MS = 1000

export type UpdatePhase = 'idle' | 'downloading' | 'restarting' | 'error'

const LOG_LIMIT = 400

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms))
}

export interface UpdateInfo {
  version: string
  notes: string
  pub_date: string
  source?: string
  latestJsonUrl: string
  resumableBytes?: number
  probes?: SourceProbe[]
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
  resumed_from?: number
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

  // 日志
  const logs = ref<string[]>([])
  const logsOpen = ref(false)

  // 更新源偏好
  const prefs = ref<UpdatePrefs>({
    preferred_source: 'github',
    custom_url: '',
    allow_fallback: true,
    resume_download: true
  })
  const prefsLoaded = ref(false)
  const prefsSaving = ref(false)

  // 缓存信息
  const cacheInfo = ref<UpdateCacheInfo | null>(null)
  const cacheClearing = ref(false)

  const hasUpdate = computed(() => updateInfo.value !== null)
  const currentVersion = ref('...')

  function appendLog(line: string) {
    const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false })
    logs.value.push(`[${ts}] ${line}`)
    if (logs.value.length > LOG_LIMIT) {
      logs.value.splice(0, logs.value.length - LOG_LIMIT)
    }
  }

  async function loadLogs() {
    try {
      const lines = await getUpdateLog()
      logs.value = lines
    } catch (e) {
      console.error('读取更新日志失败:', e)
    }
  }

  async function doClearLogs() {
    try {
      await clearUpdateLog()
      logs.value = []
    } catch (e) {
      console.error('清空日志失败:', e)
    }
  }

  async function loadPrefs() {
    try {
      prefs.value = await getUpdatePrefs()
      prefsLoaded.value = true
    } catch (e) {
      console.error('读取更新偏好失败:', e)
      prefsLoaded.value = true
    }
  }

  async function savePrefs(patch: Partial<UpdatePrefs>) {
    prefsSaving.value = true
    error.value = null
    const prev = { ...prefs.value }
    prefs.value = { ...prefs.value, ...patch }
    try {
      prefs.value = await setUpdatePrefs(patch)
      appendLog(`更新源设置已保存: ${prefs.value.preferred_source}`)
    } catch (e) {
      prefs.value = prev
      error.value = e instanceof Error ? e.message : '保存设置失败'
      throw e
    } finally {
      prefsSaving.value = false
    }
  }

  async function loadCacheInfo() {
    try {
      cacheInfo.value = await getUpdateCacheInfo()
    } catch (e) {
      console.error('读取缓存信息失败:', e)
    }
  }

  async function doClearCache() {
    cacheClearing.value = true
    try {
      const freed = await clearUpdateCache()
      appendLog(`已清理缓存，释放 ${(freed / 1024 / 1024).toFixed(2)} MB`)
      await loadCacheInfo()
      return freed
    } catch (e) {
      error.value = e instanceof Error ? e.message : '清理缓存失败'
      throw e
    } finally {
      cacheClearing.value = false
    }
  }

  async function initVersion() {
    try {
      currentVersion.value = await getVersion()
    } catch (e) {
      console.error('获取版本号失败:', e)
      currentVersion.value = 'unknown'
    }
  }

  initVersion()

  async function checkForUpdate() {
    isChecking.value = true
    error.value = null
    appendLog('手动检查更新...')
    try {
      // 实际检查由 utils/updater 的 setupUpdateCheck 驱动
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

    const resumed = updateInfo.value.resumableBytes || 0
    if (resumed > 0) {
      appendLog(`从 ${(resumed / 1024 / 1024).toFixed(2)} MB 处续传`)
    } else {
      appendLog('开始下载更新包')
    }

    try {
      await downloadAndInstallUpdate(updateInfo.value.latestJsonUrl)
      downloadComplete.value = true
      updatePhase.value = 'restarting'
      appendLog('更新已安装，准备重启')
      await wait(AUTO_RESTART_DELAY_MS)
      await restartApplication()
    } catch (e) {
      error.value = e instanceof Error ? e.message : '更新失败'
      appendLog(`更新失败: ${error.value}`)
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
  }

  function toggleLogs() {
    logsOpen.value = !logsOpen.value
    if (logsOpen.value && logs.value.length === 0) {
      void loadLogs()
    }
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
    logs,
    logsOpen,
    prefs,
    prefsLoaded,
    prefsSaving,
    cacheInfo,
    cacheClearing,
    appendLog,
    loadLogs,
    doClearLogs,
    loadPrefs,
    savePrefs,
    loadCacheInfo,
    doClearCache,
    checkForUpdate,
    startUpdate,
    confirmRestart,
    skipUpdate,
    toggleLogs,
    reset
  }
})
