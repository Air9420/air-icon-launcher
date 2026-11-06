import { invokeOrThrow } from './invoke-wrapper'
import { useUpdateStore } from '../stores/update'

/**
 * 更新模块的 IPC 封装。
 *
 * 注意：自动检查与事件监听的**实际入口**是 `src/kernel/plugins/updater.ts`，
 * 这里只放命令封装和类型定义，不要在此重复注册监听器
 * （否则会和内核插件重复触发）。
 */

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
  preferred_source: 'github' | 'gitee'
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

/**
 * 把 check_update 的结果写入 store。
 *
 * 只有发现新版本时返回 true；调用方自己决定是弹小提示还是直接进更新页。
 */
export function applyCheckResult(result: UpdateCheckResult): boolean {
  const store = useUpdateStore()
  if (!result.available) {
    store.updateInfo = null
    return false
  }
  store.updateInfo = {
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
  return true
}

/**
 * 解析后端 check_update 的错误串。
 *
 * 后端在失败时把源探测结果拼在 `|PROBES=[...]` 后面，这里拆出来，
 * 让界面能显示「哪个源挂了、为什么」，用户自己换源重试。
 */
export function parseCheckError(error: unknown): { message: string; probes: SourceProbe[] } {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error && 'message' in error
        ? String((error as { message: unknown }).message)
        : String(error)

  const marker = '|PROBES='
  const idx = raw.indexOf(marker)
  if (idx < 0) return { message: raw, probes: [] }

  const message = raw.slice(0, idx).trim()
  let probes: SourceProbe[] = []
  try {
    const parsed = JSON.parse(raw.slice(idx + marker.length))
    if (Array.isArray(parsed)) probes = parsed as SourceProbe[]
  } catch {
    /* 探测信息解析失败就丢掉，不影响主错误 */
  }
  return { message, probes }
}

/**
 * 手动触发一次更新检查（供界面按钮使用）。
 *
 * 与自动检查走同一后端命令，成功后写入 store 并弹出小提示。
 */
export async function triggerUpdateCheck(): Promise<UpdateCheckResult> {
  const store = useUpdateStore()
  store.appendLog('手动检查更新...')
  const result = await checkForUpdate()

  if (!applyCheckResult(result)) {
    store.appendLog(`已是最新版本 v${result.current_version || store.currentVersion}`)
    return result
  }

  store.showUpdatePrompt()
  return result
}
