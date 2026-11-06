import { invokeOrThrow } from './invoke-wrapper'
import { listen } from '@tauri-apps/api/event'
import { useUpdateStore } from '../stores/update'
import type { UpdateProgress } from '../stores/update'

export interface UpdateCheckResult {
  available: boolean
  version?: string
  notes?: string
  pub_date?: string
  url?: string
  signature?: string
  source?: string
  latest_json_url?: string
  resumable_bytes?: number
  current_version?: string
  probes?: SourceProbe[]
}

export interface SourceProbe {
  url: string
  kind: string
  ok: boolean
  latency_ms: number
  error?: string | null
}

export interface UpdatePrefs {
  preferred_source: 'github' | 'gitee' | 'custom'
  custom_url: string
  allow_fallback: boolean
  resume_download: boolean
}

export interface UpdateCacheInfo {
  total: number
  files: { name: string; size: number }[]
}

export interface UpdateDownloadCompletePayload {
  version: string
}

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  try {
    return await invokeOrThrow<UpdateCheckResult>('check_update')
  } catch (error) {
    console.error('检查更新失败:', error)
    throw error
  }
}

export async function downloadAndInstallUpdate(latestJsonUrl: string): Promise<void> {
  try {
    await invokeOrThrow('apply_and_restart', { latestJsonUrl })
  } catch (error) {
    console.error('下载更新失败:', error)
    throw error
  }
}

export async function restartApplication(): Promise<void> {
  try {
    await invokeOrThrow('restart_application')
  } catch (error) {
    console.error('重启失败:', error)
    throw error
  }
}

export async function getUpdatePrefs(): Promise<UpdatePrefs> {
  return await invokeOrThrow<UpdatePrefs>('get_update_prefs')
}

export async function setUpdatePrefs(prefs: Partial<UpdatePrefs>): Promise<UpdatePrefs> {
  return await invokeOrThrow<UpdatePrefs>('set_update_prefs', { prefs })
}

export async function getUpdateLog(): Promise<string[]> {
  return await invokeOrThrow<string[]>('get_update_log')
}

export async function clearUpdateLog(): Promise<void> {
  await invokeOrThrow('clear_update_log')
}

export async function clearUpdateCache(): Promise<number> {
  return await invokeOrThrow<number>('clear_update_cache')
}

export async function getUpdateCacheInfo(): Promise<UpdateCacheInfo> {
  return await invokeOrThrow<UpdateCacheInfo>('get_update_cache_info')
}

export function setupUpdateCheck() {
  const updateStore = useUpdateStore()

  listenUpdateLog()
  listenUpdateProgress()
  listenDownloadComplete()

  const doCheck = async () => {
    try {
      const result = await checkForUpdate()

      if (result.available) {
        updateStore.updateInfo = {
          version: result.version!,
          notes: result.notes || '',
          pub_date: result.pub_date || new Date().toISOString(),
          platforms: {
            'windows-x86_64': {
              signature: result.signature || '',
              url: result.url || ''
            }
          },
          source: result.source,
          latestJsonUrl: result.latest_json_url || '',
          resumableBytes: result.resumable_bytes || 0,
          probes: result.probes || []
        }
        updateStore.showUpdateDialog = true
      }
    } catch (error) {
      console.error('自动检查更新失败:', error)
    }
  }

  if (document.readyState === 'complete') {
    doCheck()
  } else {
    window.addEventListener('load', doCheck)
  }
}

export function listenUpdateProgress() {
  listen<UpdateProgress>('update-progress', (event) => {
    const updateStore = useUpdateStore()
    updateStore.updateProgress = event.payload
  })
}

export function listenUpdateLog() {
  listen<string>('update-log', (event) => {
    // 同时进入 store，供对话框展示
    const updateStore = useUpdateStore()
    updateStore.appendLog(event.payload)
  })
}

export function listenDownloadComplete() {
  listen<UpdateDownloadCompletePayload>('update-download-complete', (event) => {
    const updateStore = useUpdateStore()
    updateStore.appendLog(`安装完成: v${event.payload.version}`)
    updateStore.downloadComplete = true
    updateStore.updateFilePath = null
  })
}
