<template>
    <div class="update-page" data-menu-type="Update-View" data-tauri-drag-region>
        <header class="update-header" data-tauri-drag-region>
            <button class="back-btn" type="button" @click="onBack" @mousedown.stop>
                返回
            </button>
            <div class="title" data-tauri-drag-region>软件更新</div>
        </header>

        <div class="update-content custom-scrollbar">
            <!-- 版本概览 -->
            <section class="version-card">
                <div class="version-main">
                    <span class="version-label">{{ updateInfo ? '新版本' : '当前版本' }}</span>
                    <span class="version-number">
                        v{{ updateInfo?.version || updateStore.currentVersion }}
                    </span>
                </div>
                <div class="version-meta">
                    <span v-if="updateInfo" class="meta-item">
                        当前 v{{ updateStore.currentVersion }}
                    </span>
                    <span v-if="updateInfo?.source" class="meta-tag">
                        {{ updateInfo.source === 'gitee' ? 'Gitee' : 'GitHub' }}
                    </span>
                    <span v-if="updateInfo?.pub_date" class="meta-item">
                        {{ formatDate(updateInfo.pub_date) }}
                    </span>
                </div>
                <div v-if="!updateInfo" class="version-empty">
                    尚未检查到可用更新
                </div>
            </section>

            <!-- 更新源（置顶，横排） -->
            <section class="block source-block">
                <div class="source-row">
                    <span class="source-label">更新源</span>
                    <div class="source-seg">
                        <button
                            v-for="opt in sourceOptions"
                            :key="opt.value"
                            type="button"
                            class="seg-item"
                            :class="{ on: updateStore.prefs.preferred_source === opt.value }"
                            :title="opt.hint"
                            :disabled="updateStore.prefsSaving || isBusy"
                            @click="pickSource(opt.value)"
                        >
                            <span class="seg-name">{{ opt.label }}</span>
                            <span
                                v-if="probeFor(opt.value)"
                                class="seg-probe"
                                :class="{ ok: probeFor(opt.value)!.ok, bad: !probeFor(opt.value)!.ok }"
                            >
                                {{ probeFor(opt.value)!.ok ? `${probeFor(opt.value)!.latency_ms}ms` : '失败' }}
                            </span>
                        </button>
                    </div>
                </div>
                <p class="block-tip">
                    {{ currentSourceHint }}
                </p>
                <p v-if="resumableText && !downloadComplete" class="block-tip resume-tip">
                    检测到未完成的下载，将继续从 {{ resumableText }} 处下载（断点续传自动生效）。
                </p>
            </section>

            <!-- 更新内容 -->
            <section v-if="updateInfo?.notes && !downloadComplete" class="block">
                <div class="block-title">更新内容</div>
                <div class="notes-content markdown-body" v-html="renderedNotes"></div>
            </section>

            <!-- 进度 -->
            <section v-if="isUpdating || downloadComplete" class="block">
                <div class="block-title">{{ downloadComplete ? '下载完成' : '正在下载' }}</div>
                <div class="progress-bar">
                    <div class="progress-fill" :style="{ width: `${progress}%` }"></div>
                </div>
                <div class="progress-info">
                    <span>{{ progress }}%</span>
                    <span v-if="updateStore.updateProgress?.total">
                        {{ formatSize(updateStore.updateProgress?.downloaded || 0) }} /
                        {{ formatSize(updateStore.updateProgress?.total || 0) }}
                    </span>
                </div>
                <p v-if="downloadComplete" class="block-tip">
                    {{ updateStore.updatePhase === 'restarting' ? '更新已安装，应用即将自动重启。' : '更新已安装完成。' }}
                </p>
            </section>

            <div v-if="error" class="update-error">{{ error }}</div>

            <p v-if="!updateInfo && !isBusy" class="block-tip">
                点下方「重新检查」重试；若当前源一直失败，换个更新源再试。
            </p>

            <!-- 日志 -->
            <section class="block">
                <button class="block-title toggle" type="button" @click="updateStore.toggleLogs()">
                    <span class="chev" :class="{ open: updateStore.logsOpen }">›</span>
                    更新日志
                    <span class="block-hint">{{ updateStore.logs.length }} 条</span>
                </button>
                <div v-if="updateStore.logsOpen" class="log-wrap">
                    <div ref="logBox" class="log-box">
                        <div v-if="updateStore.logs.length === 0" class="log-empty">暂无日志</div>
                        <div v-for="(line, i) in updateStore.logs" :key="i" class="log-line">{{ line }}</div>
                    </div>
                    <div class="log-actions">
                        <button class="mini-btn" type="button" @click="copyLogs">复制</button>
                        <button class="mini-btn" type="button" @click="updateStore.doClearLogs()">清空</button>
                    </div>
                </div>
            </section>

            <!-- 缓存 -->
            <section class="block">
                <div class="cache-row">
                    <span>下载缓存 {{ cacheText || '0 MB' }}</span>
                    <button
                        class="mini-btn"
                        type="button"
                        :disabled="updateStore.cacheClearing || isBusy"
                        @click="updateStore.doClearCache()"
                    >
                        清理
                    </button>
                </div>
            </section>
        </div>

        <footer class="update-actions">
            <button class="btn btn-secondary" type="button" @click="onBack" :disabled="updateStore.updatePhase === 'restarting'">
                稍后
            </button>
            <button
                v-if="!updateInfo"
                class="btn btn-primary"
                type="button"
                :disabled="rechecking"
                @click="onRecheck"
            >
                {{ rechecking ? '检查中...' : '重新检查' }}
            </button>
            <button
                v-else-if="!downloadComplete"
                class="btn btn-primary"
                type="button"
                :disabled="isBusy"
                @click="updateStore.startUpdate()"
            >
                {{ primaryButtonText }}
            </button>
            <button
                v-else-if="error"
                class="btn btn-primary"
                type="button"
                @click="updateStore.confirmRestart()"
            >
                手动重启
            </button>
            <button
                v-else
                class="btn btn-primary"
                type="button"
                @click="updateStore.confirmRestart()"
            >
                立即重启
            </button>
        </footer>
    </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useUpdateStore } from '../stores/update'
import { getSmoothedProgressFrame } from '../utils/progress-animation'
import { applyCheckResult, checkForUpdate, parseCheckError } from '../utils/updater'
import type { SourceProbe, UpdatePrefs } from '../utils/updater'

const router = useRouter()
const updateStore = useUpdateStore()

const markedModule = ref<typeof import('marked') | null>(null)

const updateInfo = computed(() => updateStore.updateInfo)
const isUpdating = computed(() => updateStore.isUpdating)
const error = computed(() => updateStore.error)
const downloadComplete = computed(() => updateStore.downloadComplete)
const isBusy = computed(() => isUpdating.value || updateStore.updatePhase === 'restarting')

/* ---- 进度动画 ---- */

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

const progress = computed(() => displayProgress.value)

const primaryButtonText = computed(() => {
    if (isUpdating.value) return '更新中...'
    return '立即更新'
})

/* ---- 更新源 ---- */

const sourceOptions: { value: UpdatePrefs['preferred_source']; label: string; hint: string }[] = [
    { value: 'github', label: 'GitHub', hint: '官方源，国内可能较慢' },
    { value: 'gitee', label: 'Gitee', hint: '国内镜像，速度通常更快' }
]

async function pickSource(v: UpdatePrefs['preferred_source']) {
    if (updateStore.prefsSaving || isBusy.value) return
    if (updateStore.prefs.preferred_source === v) return
    try {
        await updateStore.savePrefs({ preferred_source: v })
    } catch {
        return
    }
    // 换了源就顺手重查一次，省得用户再点一遍
    if (!updateInfo.value) void onRecheck()
}

function probeFor(v: UpdatePrefs['preferred_source']) {
    const probes = updateInfo.value?.probes || errorProbes.value
    return probes.find((p) => p.kind === v)
}

const currentSourceHint = computed(() => {
    const opt = sourceOptions.find((o) => o.value === updateStore.prefs.preferred_source)
    return opt ? opt.hint : ''
})

/* ---- 重新检查 ---- */

const rechecking = ref(false)
const errorProbes = ref<SourceProbe[]>([])

async function onRecheck() {
    if (rechecking.value) return
    rechecking.value = true
    updateStore.error = null
    errorProbes.value = []
    try {
        updateStore.appendLog('手动检查更新...')
        const result = await checkForUpdate()
        if (!applyCheckResult(result)) {
            updateStore.appendLog(`已是最新版本 v${result.current_version || updateStore.currentVersion}`)
        }
    } catch (e) {
        const { message, probes } = parseCheckError(e)
        updateStore.error = message
        errorProbes.value = probes
        updateStore.appendLog(`检查更新失败: ${message}`)
    } finally {
        rechecking.value = false
    }
}

/* ---- 更新内容 ---- */

const renderedNotes = computed(() => {
    if (!updateInfo.value?.notes || !markedModule.value) return ''
    return markedModule.value.marked.parse(updateInfo.value.notes)
})

/* ---- 文本工具 ---- */

function formatSize(bytes: number) {
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function formatDate(iso: string) {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleDateString('zh-CN')
}

const resumableText = computed(() => {
    const b = updateInfo.value?.resumableBytes || 0
    return b > 0 ? formatSize(b) : ''
})

const cacheText = computed(() => {
    const t = updateStore.cacheInfo?.total || 0
    return t > 0 ? formatSize(t) : ''
})

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

/* ---- 生命周期 ---- */

onMounted(async () => {
    if (!markedModule.value) {
        markedModule.value = await import('marked')
        markedModule.value.marked.setOptions({ breaks: true, gfm: true })
    }
    if (!updateStore.prefsLoaded) await updateStore.loadPrefs()
    await updateStore.loadCacheInfo()
    if (updateStore.logs.length === 0) await updateStore.loadLogs()
})

onBeforeUnmount(stopProgressAnimation)

function onBack() {
    if (router.options.history.state.back) {
        router.back()
        return
    }
    router.push('/settings/about')
}
</script>

<style scoped lang="scss">
@use "../styles/scrollbar" as *;

.update-page {
    width: 100vw;
    height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg-color);
}

.update-header {
    height: 52px;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 12px;
    background: var(--card-bg);
    border-bottom: 1px solid var(--border-color);
    backdrop-filter: var(--backdrop-blur);
    flex-shrink: 0;
}

.back-btn {
    border: 0;
    padding: 8px 10px;
    border-radius: 10px;
    background: var(--hover-bg);
    cursor: pointer;
    color: var(--text-color);

    &:hover {
        background: var(--hover-bg-strong);
    }
}

.title {
    font-size: 16px;
    font-weight: 700;
    color: var(--text-color);
}

.update-content {
    flex: 1;
    overflow-y: auto;
    padding: 14px 16px 8px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    @include custom-scrollbar;
}

/* ---- 版本卡 ---- */

.version-card {
    background: var(--card-bg);
    border: 1px solid var(--border-color);
    border-radius: 14px;
    padding: 16px 18px;
}

.version-main {
    display: flex;
    align-items: baseline;
    gap: 8px;
}

.version-label {
    font-size: 12px;
    color: var(--text-tertiary);
}

.version-number {
    font-size: 22px;
    font-weight: 700;
    color: var(--text-color);
}

.version-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
    font-size: 12px;
    color: var(--text-tertiary);
}

.meta-tag {
    padding: 1px 7px;
    border-radius: 6px;
    background: var(--primary-bg);
    color: var(--primary-color);
}

.version-empty {
    margin-top: 8px;
    font-size: 12px;
    color: var(--text-tertiary);
}

/* ---- 通用块 ---- */

.block {
    background: var(--card-bg);
    border: 1px solid var(--border-color);
    border-radius: 14px;
    padding: 14px 16px;
}

.block-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-color);
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    gap: 6px;

    &.toggle {
        width: 100%;
        border: 0;
        background: none;
        padding: 0;
        margin-bottom: 0;
        cursor: pointer;
        text-align: left;

        &:hover {
            color: var(--primary-color);
        }
    }
}

.block-hint {
    margin-left: auto;
    font-size: 11px;
    font-weight: 400;
    color: var(--text-tertiary);
}

.chev {
    display: inline-block;
    transition: transform 0.15s ease;
    color: var(--text-tertiary);
    font-size: 15px;

    &.open {
        transform: rotate(90deg);
    }
}

.block-tip {
    margin: 8px 0 0;
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-tertiary);
}

.resume-tip {
    color: var(--primary-color);
}

/* ---- 更新源（横排分段） ---- */

.source-block {
    padding: 12px 14px;
}

.source-row {
    display: flex;
    align-items: center;
    gap: 10px;
}

.source-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-color);
    flex-shrink: 0;
}

.source-seg {
    display: flex;
    gap: 4px;
    padding: 3px;
    border-radius: 9px;
    background: var(--hover-bg);
    flex: 1;
}

.seg-item {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 5px 8px;
    border: 1px solid transparent;
    border-radius: 7px;
    background: transparent;
    cursor: pointer;
    color: var(--text-tertiary);
    transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;

    &:hover:not(:disabled):not(.on) {
        background: var(--hover-bg-strong);
        color: var(--text-secondary);
    }

    &.on {
        background: var(--primary-bg);
        border-color: var(--primary-color);
        color: var(--primary-color);
    }

    &:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }
}

.seg-name {
    font-size: 12px;
    font-weight: 600;
}

.seg-probe {
    font-size: 10px;
    padding: 0 4px;
    border-radius: 4px;
    line-height: 1.4;

    &.ok {
        background: var(--hover-bg-strong);
        color: var(--text-tertiary);
    }

    &.bad {
        background: var(--error-bg);
        color: var(--error-color);
    }
}

/* ---- 更新内容 ---- */

.notes-content {
    max-height: 240px;
    overflow-y: auto;
    font-size: 13px;
    line-height: 1.55;
    @include custom-scrollbar;
}

.markdown-body {
    :deep(h1), :deep(h2), :deep(h3), :deep(h4) {
        margin: 10px 0 6px;
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
    :deep(a) { color: var(--primary-color); text-decoration: none; }
    :deep(hr) { border: none; border-top: 1px solid var(--border-color); margin: 10px 0; }
    :deep(blockquote) {
        border-left: 3px solid var(--primary-color);
        margin: 6px 0;
        padding: 4px 10px;
        color: var(--text-secondary);
        background: var(--hover-bg);
    }
}

/* ---- 进度 ---- */

.progress-bar {
    height: 8px;
    background: var(--hover-bg);
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 6px;
}

.progress-fill {
    height: 100%;
    background: var(--primary-color);
}

.progress-info {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    color: var(--text-tertiary);
}

/* ---- 错误 ---- */

.update-error {
    padding: 10px 12px;
    background: var(--error-bg);
    border: 1px solid rgba(var(--error-color-rgb, 229, 57, 53), 0.3);
    border-radius: 10px;
    color: var(--error-color);
    font-size: 13px;
    line-height: 1.5;
    max-height: 120px;
    overflow-y: auto;
    @include custom-scrollbar;
}

/* ---- 日志 ---- */

.log-wrap {
    margin-top: 10px;
}

.log-box {
    background: var(--hover-bg);
    border-radius: 8px;
    padding: 8px 10px;
    max-height: 160px;
    overflow-y: auto;
    font-family: 'Consolas', 'Monaco', monospace;
    font-size: 11px;
    line-height: 1.5;
    color: var(--text-tertiary);
    @include custom-scrollbar;
}

.log-empty {
    opacity: 0.7;
}

.log-line {
    white-space: pre-wrap;
    word-break: break-all;
}

.log-actions {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
    margin-top: 6px;
}

.cache-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12px;
    color: var(--text-tertiary);
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
        background: var(--primary-color);
        color: #fff;
    }

    &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
}

/* ---- 底部 ---- */

.update-actions {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
    padding: 12px 16px 16px;
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
    background: var(--primary-color);
    color: white;

    &:hover:not(:disabled) {
        opacity: 0.9;
    }
}
</style>
