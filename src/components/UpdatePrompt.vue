<template>
    <div v-if="visible" class="update-prompt-overlay" @click.self="onNo">
        <div class="update-prompt">
            <div class="prompt-head">
                <div class="prompt-title">发现新版本</div>
                <div class="prompt-version">v{{ updateStore.updateInfo?.version }}</div>
            </div>

            <div class="prompt-body">
                <div class="prompt-row">
                    <span class="prompt-label">当前版本</span>
                    <span class="prompt-value">v{{ updateStore.currentVersion }}</span>
                </div>
                <div class="prompt-row">
                    <span class="prompt-label">更新源</span>
                    <span class="prompt-value">{{ sourceLabel }}</span>
                </div>
                <p v-if="resumableText" class="prompt-tip">
                    可继续上次未完成的下载（已下载 {{ resumableText }}）
                </p>
                <p class="prompt-question">是否前往更新页面？</p>
            </div>

            <div class="prompt-actions">
                <button class="btn btn-secondary" type="button" @click="onNo">否</button>
                <button class="btn btn-primary" type="button" @click="onYes">是</button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useUpdateStore } from '../stores/update'

const router = useRouter()
const updateStore = useUpdateStore()

const visible = computed(() => updateStore.updatePromptVisible)

const sourceLabel = computed(() => {
    const s = updateStore.updateInfo?.source
    if (s === 'gitee') return 'Gitee'
    if (s === 'github') return 'GitHub'
    return '未知'
})

const resumableText = computed(() => {
    const b = updateStore.updateInfo?.resumableBytes || 0
    return b > 0 ? `${(b / 1024 / 1024).toFixed(2)} MB` : ''
})

function onYes() {
    updateStore.dismissUpdatePrompt()
    router.push('/update')
}

function onNo() {
    updateStore.dismissUpdatePrompt()
}
</script>

<style scoped lang="scss">
.update-prompt-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
}

.update-prompt {
    width: 320px;
    max-width: 86vw;
    border-radius: 14px;
    background: rgba(var(--floating-panel-rgb), 0.96);
    border: 1px solid var(--floating-panel-border);
    box-shadow: var(--floating-panel-shadow);
    overflow: hidden;
}

.prompt-head {
    padding: 16px 18px 12px;
    background: var(--hover-bg);
}

.prompt-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-color);
}

.prompt-version {
    margin-top: 4px;
    font-size: 20px;
    font-weight: 700;
    color: var(--primary-color);
}

.prompt-body {
    padding: 12px 18px 4px;
}

.prompt-row {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    padding: 3px 0;
}

.prompt-label {
    color: var(--text-tertiary);
}

.prompt-value {
    color: var(--text-color);
}

.prompt-tip {
    margin: 8px 0 0;
    font-size: 12px;
    line-height: 1.5;
    color: var(--primary-color);
}

.prompt-question {
    margin: 12px 0 4px;
    font-size: 13px;
    color: var(--text-color);
}

.prompt-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    padding: 10px 18px 16px;
}

.btn {
    padding: 7px 18px;
    border-radius: 8px;
    border: none;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;

    &:hover {
        opacity: 0.9;
    }
}

.btn-secondary {
    background: var(--hover-bg-strong);
    color: var(--text-color);
}

.btn-primary {
    background: var(--primary-color);
    color: #fff;
}
</style>
