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
}

export interface UpdateDownloadCompletePayload {
  version: string
}

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  try {
    const result = await invokeOrThrow<UpdateCheckResult>('check_update')
    return result
  } catch (error) {
    console.error('检查更新失败:', error)
    throw error
  }
}

export async function downloadAndInstallUpdate(): Promise<void> {
  try {
    await invokeOrThrow('apply_and_restart')
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

export function setupUpdateCheck() {
  const updateStore = useUpdateStore()
  
  // 监听更新日志
  listenUpdateLog()
  // 监听更新进度
  listenUpdateProgress()
  // 监听下载完成
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
          }
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
    console.log('[更新]', event.payload)
  })
}

export function listenDownloadComplete() {
  listen<UpdateDownloadCompletePayload>('update-download-complete', (event) => {
    console.log('[更新] 安装完成:', event.payload)
    const updateStore = useUpdateStore()
    updateStore.downloadComplete = true
    updateStore.updateFilePath = null
  })
}
