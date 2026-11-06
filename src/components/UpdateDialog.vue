<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch, nextTick } from 'vue'
import { useUpdateStore } from '../stores/update'
import { getSmoothedProgressFrame } from '../utils/progress-animation'
import type { UpdatePrefs } from '../utils/updater'

const updateStore = useUpdateStore()

const markedModule = ref<typeof import('marked') | null>(null)

watch(() => updateStore.showUpdateDialog, async (visible) => {
  if (visible) {
    if (!markedModule.value) {
      markedModule.value = await import('marked')
      markedModule.value.marked.setOptions({ breaks: true, gfm: true })
    }
    if (!updateStore.prefsLoaded) await updateStore.loadPrefs()
    await updateStore.loadCacheInfo()
    if (updateStore.logs.length === 0) await updateStore.loadLogs()
  }
}, { immediate: true })

const isVisible = computed(() => updateStore.showUpdateDialog)
const updateInfo = computed(() => updateStore.updateInfo)
const isUpdating = computed(() => updateStore.isUpdating)
const error = computed(() => updateStore.error)
const downloadComplete = computed(() => updateStore.downloadComplete)

const realProgress = computed(() => updateStore.updateProgress?.percentage || 0)
const displayProgress = ref(0)
let progressRafId: number | null = null

function stopProgressAnimation() {
  if (progressRafId !== null) {
    window.cancelAnimationFrame(progressRafId)
    progressRafId = null
  }
}

watch(realProgress, (target) => {
  stopProgressAnimation()
  const startValue = displayProgress.value
  const startTime = performance.now()
  if (target <= startValue) {
    displayProgress.value = target
    return
  }
  const tick = (now: number) => {
    displayProgress.value = getSmoothedProgressFrame(startValue, target, now - startTime)
    if (displayProgress.value < target) {
      progressRafId = window.requestAnimationFrame(tick)
    } else {
      progressRafId = null
    }
  }
  progressRafId = window.requestAnimationFrame(tick)
}, { immediate: true })

watch(() => updateStore.showUpdateDialog, (visible) => {
  if (!visible) {
    stopProgressAnimation()
    displayProgress.value = 0
  }
})

onBeforeUnmount(stopProgressAnimation)

const progress = computed(() => displayProgress.value)

const updateTitle = computed(() => {
  if (updateStore.updatePhase === 'restarting') return `正在重启到 v${updateInfo.value?.version}`
  if (downloadComplete.value) return `更新已安装 v${updateInfo.value?.version}`
  return `发现新版本 v${updateInfo.value?.version}`
})

const primaryButtonText = computed(() => {
  if (updateStore.updatePhase === 'restarting') return '正在重启...'
  if (isUpdating.value) return '更新中...'
  return '立即更新'
})

const renderedNotes = computed(() => {
  if (!updateInfo.value?.notes || !markedModule.value) return ''
  return markedModule.value.marked.parse(updateInfo.value.notes)
})

/* ---- 更新源 ---- */

const sourceOptions: { value: UpdatePrefs['preferred_source']; label: string; hint: string }[] = [
  { value: 'github', label: 'GitHub', hint: '官方源，国内可能较慢' },
  { value: 'gitee', label: 'Gitee', hint: '国内镜像，速度通常更快' },
  { value: 'custom', label: '自定义', hint: '自建或第三方 latest.json 地址' }
]

const showSourcePanel = ref(false)

function pickSource(v: UpdatePrefs['preferred_source']) {
  if (updateStore.prefsSaving) return
  if (v === 'custom' && !updateStore.prefs.custom_url) {
    updateStore.prefs.preferred_source = 'custom'
    return
  }
  void updateStore.savePrefs({ preferred_source: v })
}

function onCustomUrlBlur(ev: Event) {
  const el = ev.target as HTMLInputElement
  const v = el.value.trim()
  if (v === updateStore.prefs.custom_url) return
  void updateStore.savePrefs({ custom_url: v }).catch(() => {
    el.value = updateStore.prefs.custom_url
  })
}

function toggleFallback() {
  void updateStore.savePrefs({ allow_fallback: !updateStore.prefs.allow_fallback })
}

function toggleResume() {
  void updateStore.savePrefs({ resume_download: !updateStore.prefs.resume_download })
}

/* ---- 日志 ---- */

const logBox = ref<HTMLElement | null>(null)

watch(() => updateStore.logs.length, async () => {
  if (!updateStore.logsOpen) return
  await nextTick()
  if (logBox.value) logBox.value.scrollTop = logBox.value.scrollHeight
})

async function copyLogs() {
  try {
    await navigator.clipboard.writeText(updateStore.logs.join('\n'))
  } catch {
    /* 忽略 */
  }
}

/* ---- 缓存 ---- */

const cacheText = computed(() => {
  const t = updateStore.cacheInfo?.total || 0
  if (t <= 0) return ''
  return `${(t / 1024 / 1024).toFixed(2)} MB`
})

const resumableText = computed(() => {
  const b = updateInfo.value?.resumableBytes || 0
  if (b <= 0) return ''
  return `${(b / 1024 / 1024).toFixed(2)} MB`
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
        <h3>{{ updateTitle }}</h3>
        <button class="close-btn" @click="handleSkip" :disabled="isUpdating">×</button>
      </div>

      <div class="update-content">
        <div v-if="!downloadComplete" class="current-version">
          当前版本: v{{ updateStore.currentVersion }}
          <span v-if="updateInfo?.source" class="source-tag">
            来源 {{ updateInfo.source }}
          </span>
        </div>

        <!-- 断点续传提示 -->
        <div v-if="resumableText && !downloadComplete" class="resume-hint">
          检测到未完成的下载，将从 {{ resumableText }} 处继续
        </div>

        <div v-if="!downloadComplete && updateInfo?.notes" class="release-notes">
          <h4>更新内容：</h4>
          <div class="notes-content markdown-body" v-html="renderedNotes"></div>
        </div>

        <div v-if="downloadComplete" class="download-complete">
          <div class="complete-icon">✓</div>
          <p>{{ updateStore.updatePhase === 'restarting' ? '更新已安装完成，应用即将自动重启。' : '更新已安装完成。' }}</p>
        </div>
      </div>

      <div v-if="error" class="update-error">{{ error }}</div>

      <div v-if="isUpdating || downloadComplete" class="update-progress">
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

      <!-- 更新源设置 -->
      <div class="update-section">
        <button class="section-toggle" type="button" @click="showSourcePanel = !showSourcePanel">
          <span class="chev" :class="{ open: showSourcePanel }">›</span>
          更新源设置
          <span class="section-hint">{{ sourceOptions.find(o => o.value === updateStore.prefs.preferred_source)?.label }}</span>
        </button>

        <div v-if="showSourcePanel" class="section-body">
          <div class="source-list">
            <button
              v-for="opt in sourceOptions"
              :key="opt.value"
              type="button"
              class="source-item"
              :class="{ on: updateStore.prefs.preferred_source === opt.value }"
              :disabled="updateStore.prefsSaving"
              @click="pickSource(opt.value)"
            >
              <span class="radio" :class="{ on: updateStore.prefs.preferred_source === opt.value }"></span>
              <span class="source-info">
                <span class="source-name">{{ opt.label }}</span>
                <span class="source-hint">{{ opt.hint }}</span>
              </span>
            </button>
          </div>

          <input
            v-if="updateStore.prefs.preferred_source === 'custom'"
            class="custom-input"
            type="text"
            placeholder="https://example.com/latest.json"
            :value="updateStore.prefs.custom_url"
            :disabled="updateStore.prefsSaving"
            @blur="onCustomUrlBlur"
          />

          <label class="opt-row">
            <input
              type="checkbox"
              :checked="updateStore.prefs.allow_fallback"
              :disabled="updateStore.prefsSaving"
              @change="toggleFallback"
            />
            <span>首选源失败时自动尝试其他源</span>
          </label>

          <label class="opt-row">
            <input
              type="checkbox"
              :checked="updateStore.prefs.resume_download"
              :disabled="updateStore.prefsSaving"
              @change="toggleResume"
            />
            <span>启用断点续传</span>
          </label>

          <div v-if="cacheText" class="cache-row">
            <span>下载缓存 {{ cacheText }}</span>
            <button
              class="mini-btn"
              type="button"
              :disabled="updateStore.cacheClearing || isUpdating"
              @click="updateStore.doClearCache()"
            >
              清理
            </button>
          </div>
        </div>
      </div>

      <!-- 日志 -->
      <div class="update-section">
        <button class="section-toggle" type="button" @click="updateStore.toggleLogs()">
          <span class="chev" :class="{ open: updateStore.logsOpen }">›</span>
          更新日志
          <span class="section-hint">{{ updateStore.logs.length }} 条</span>
        </button>

        <div v-if="updateStore.logsOpen" class="section-body">
          <div ref="logBox" class="log-box">
            <div v-if="updateStore.logs.length === 0" class="log-empty">暂无日志</div>
            <div v-for="(line, i) in updateStore.logs" :key="i" class="log-line">{{ line }}</div>
          </div>
          <div class="log-actions">
            <button class="mini-btn" type="button" @click="copyLogs">复制</button>
            <button class="mini-btn" type="button" @click="updateStore.doClearLogs()">清空</button>
          </div>
        </div>
      </div>

      <div class="update-actions">
        <template v-if="!downloadComplete">
          <button class="btn btn-secondary" @click="handleSkip" :disabled="isUpdating">
            稍后提醒
          </button>
          <button class="btn btn-primary" @click="handleUpdate" :disabled="isUpdating">
            {{ primaryButtonText }}
          </button>
        </template>
        <template v-else-if="error">
          <button class="btn btn-secondary" @click="handleSkip">稍后重启</button>
          <button class="btn btn-primary" @click="handleRestart">手动重启</button>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use "../styles/scrollbar" as *;

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
  background: rgba(var(--floating-panel-rgb), 0.95);
  border-radius: 12px;
  width: 440px;
  max-width: 90vw;
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  overflow: hidden;
}

.update-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 18px 22px;
  background: var(--hover-bg);
  color: var(--text-color);
  flex-shrink: 0;

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

    &:hover:not(:disabled) {
      background: var(--hover-bg-strong);
    }
  }
}

.update-content {
  padding: 20px 22px 0;
  overflow-y: auto;
  flex-shrink: 0;
}

.current-version {
  color: var(--text-color-secondary);
  font-size: 13px;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;

  .source-tag {
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 4px;
    background: var(--hover-bg-strong);
    color: var(--text-color-secondary);
  }
}

.resume-hint {
  font-size: 12px;
  color: var(--primary-color, #667eea);
  background: rgba(102, 126, 234, 0.1);
  border-radius: 6px;
  padding: 8px 10px;
  margin-bottom: 12px;
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
    font-size: 13px;
    line-height: 1.5;
    max-height: 180px;
    overflow-y: auto;
    @include custom-scrollbar;
  }
}

.markdown-body {
  :deep(h1), :deep(h2), :deep(h3), :deep(h4) {
    margin-top: 10px;
    margin-bottom: 6px;
    font-weight: 600;
    color: var(--text-color);
  }
  :deep(h1) { font-size: 17px; }
  :deep(h2) { font-size: 15px; }
  :deep(h3) { font-size: 14px; }
  :deep(h4) { font-size: 13px; }
  :deep(p) { margin: 6px 0; line-height: 1.55; color: var(--text-color); }
  :deep(ul), :deep(ol) { margin: 6px 0; padding-left: 18px; }
  :deep(li) { margin: 3px 0; line-height: 1.5; color: var(--text-color); }
  :deep(strong) { font-weight: 600; color: var(--text-color); }
  :deep(em) { font-style: italic; }
  :deep(code) {
    background: var(--hover-bg);
    padding: 2px 5px;
    border-radius: 4px;
    font-size: 12px;
    font-family: 'Consolas', 'Monaco', monospace;
  }
  :deep(pre) {
    background: var(--hover-bg-strong);
    color: var(--text-color);
    padding: 10px;
    border-radius: 6px;
    overflow-x: auto;
    margin: 6px 0;
    code { background: none; padding: 0; color: inherit; }
  }
  :deep(a) { color: var(--primary-color, #667eea); text-decoration: none; }
  :deep(hr) { border: none; border-top: 1px solid var(--border-color, #e0e0e0); margin: 10px 0; }
  :deep(blockquote) {
    border-left: 3px solid var(--primary-color, #667eea);
    margin: 6px 0;
    padding: 4px 10px;
    color: var(--text-color-secondary);
    background: var(--hover-bg);
  }
}

.update-error {
  margin: 0 22px 12px;
  padding: 10px;
  background: rgba(var(--error-color-rgb, 229, 57, 53), 0.1);
  border: 1px solid rgba(var(--error-color-rgb, 229, 57, 53), 0.3);
  border-radius: 8px;
  color: var(--error-color, #e53935);
  font-size: 13px;
  max-height: 100px;
  overflow-y: auto;
  @include custom-scrollbar;
}

.update-progress {
  padding: 0 22px 12px;

  .progress-bar {
    height: 8px;
    background: var(--hover-bg);
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 6px;

    .progress-fill {
      height: 100%;
      background: var(--primary-color, #667eea);
      transition: none;
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
  padding: 16px 0;

  .complete-icon {
    width: 56px;
    height: 56px;
    margin: 0 auto 14px;
    background: var(--primary-color, #667eea);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-size: 28px;
  }

  p {
    color: var(--text-color);
    font-size: 14px;
    line-height: 1.5;
  }
}

/* ---- 折叠区 ---- */

.update-section {
  border-top: 1px solid var(--border-color, rgba(128, 128, 128, 0.18));
  margin: 0 22px;
  flex-shrink: 0;

  &:last-of-type {
    margin-bottom: 0;
  }
}

.section-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  padding: 10px 0;
  font-size: 13px;
  color: var(--text-color);
  cursor: pointer;
  text-align: left;

  .chev {
    display: inline-block;
    transition: transform 0.15s ease;
    color: var(--text-color-secondary);
    font-size: 15px;

    &.open {
      transform: rotate(90deg);
    }
  }

  .section-hint {
    margin-left: auto;
    font-size: 11px;
    color: var(--text-color-secondary);
  }

  &:hover {
    color: var(--primary-color, #667eea);
  }
}

.section-body {
  padding-bottom: 12px;
}

/* ---- 更新源 ---- */

.source-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 10px;
}

.source-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: var(--hover-bg);
  cursor: pointer;
  text-align: left;

  &.on {
    border-color: var(--primary-color, #667eea);
    background: rgba(102, 126, 234, 0.1);
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .radio {
    width: 13px;
    height: 13px;
    border-radius: 50%;
    border: 2px solid var(--text-color-secondary);
    flex-shrink: 0;
    margin-top: 2px;

    &.on {
      border-color: var(--primary-color, #667eea);
      background: var(--primary-color, #667eea);
      box-shadow: inset 0 0 0 2px var(--floating-panel-rgb, #fff);
    }
  }

  .source-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .source-name {
    font-size: 13px;
    color: var(--text-color);
  }

  .source-hint {
    font-size: 11px;
    color: var(--text-color-secondary);
  }
}

.custom-input {
  width: 100%;
  box-sizing: border-box;
  padding: 7px 10px;
  margin-bottom: 10px;
  border-radius: 7px;
  border: 1px solid var(--border-color, rgba(128, 128, 128, 0.25));
  background: var(--hover-bg);
  color: var(--text-color);
  font-size: 12px;

  &:focus {
    outline: none;
    border-color: var(--primary-color, #667eea);
  }
}

.opt-row {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--text-color-secondary);
  padding: 4px 0;
  cursor: pointer;

  input {
    cursor: pointer;
  }
}

.cache-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-color-secondary);
  margin-top: 6px;
}

.mini-btn {
  background: var(--hover-bg-strong);
  border: none;
  border-radius: 6px;
  padding: 3px 9px;
  font-size: 11px;
  color: var(--text-color);
  cursor: pointer;

  &:hover:not(:disabled) {
    background: var(--primary-color, #667eea);
    color: #fff;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

/* ---- 日志 ---- */

.log-box {
  background: var(--hover-bg);
  border-radius: 8px;
  padding: 8px 10px;
  max-height: 140px;
  overflow-y: auto;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-color-secondary);
  @include custom-scrollbar;

  .log-empty {
    color: var(--text-color-secondary);
    opacity: 0.7;
  }

  .log-line {
    white-space: pre-wrap;
    word-break: break-all;
  }
}

.log-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
  margin-top: 6px;
}

/* ---- 底部按钮 ---- */

.update-actions {
  display: flex;
  gap: 10px;
  padding: 14px 22px 18px;
  justify-content: flex-end;
  flex-shrink: 0;
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
  background: var(--primary-color, #667eea);
  color: white;

  &:hover:not(:disabled) {
    opacity: 0.9;
  }
}
</style>
