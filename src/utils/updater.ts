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
    await invokeOrThrow('install_update')
  } catch (error) {
    console.error('下载更新失败:', error)
    throw error
  }
}

export function setupUpdateCheck() {
  const updateStore = useUpdateStore()

  window.addEventListener('load', async () => {
    try {
      const result = await checkForUpdate()

      if (result.available) {
        updateStore.updateInfo = {
          version: result.version!,
          notes: result.notes || '',
          pub_date: result.pub_date || new Date().toISOString(),
          platforms: {
            'windows-x86_64': {
              signature: '',
              url: result.url || ''
            }
          }
        }
        updateStore.showUpdateDialog = true
      }
    } catch (error) {
      console.error('自动检查更新失败:', error)
    }
  })
}

export function listenUpdateProgress() {
  listen<UpdateProgress>('update-progress', (event) => {
    const updateStore = useUpdateStore()
    updateStore.updateProgress = event.payload
  })
}
