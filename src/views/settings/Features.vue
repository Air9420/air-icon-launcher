<template>
    <div class="features-settings">
        <div class="section">
            <div class="section-title">功能</div>
            <div class="action-buttons">
                <button class="action-btn" type="button" @click="onOpenAiOrganizer">
                    AI 整理向导
                </button>
                <button class="action-btn" type="button" @click="onOpenPlugins">
                    插件管理
                </button>
                <button class="action-btn danger" type="button" @click="onClearRecentUsed">
                    清除最近使用记录
                </button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { useRouter } from "vue-router";
import { Store } from "../../stores";
import { useConfirmDialog } from "../../composables/useConfirmDialog";

const router = useRouter();
const store = Store();
const { confirm } = useConfirmDialog();

function onOpenPlugins() {
    router.push("/plugins");
}

function onOpenAiOrganizer() {
    router.push("/ai-organizer");
}

async function onClearRecentUsed() {
    const confirmed = await confirm({
        title: "清除最近使用记录",
        message: "确定要清空最近使用记录吗？此操作不会删除启动项本身。",
        confirmText: "清空",
        cancelText: "取消",
    });

    if (!confirmed) {
        return;
    }

    store.clearRecentUsed();
}
</script>

<style scoped>
.features-settings {
    display: flex;
    flex-direction: column;
    gap: 14px;
}

.section {
    background: var(--card-bg);
    border: 1px solid var(--border-color);
    border-radius: 16px;
    padding: 14px;
}

.section-title {
    font-size: 13px;
    font-weight: 700;
    color: var(--text-secondary);
    margin-bottom: 10px;
}

.action-buttons {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.action-btn {
    width: 100%;
    height: 34px;
    border-radius: 12px;
    border: 1px solid var(--border-color-strong);
    background: var(--input-bg);
    cursor: pointer;
    -webkit-app-region: no-drag;
    color: var(--text-color);
    font-size: 13px;
}

.action-btn:hover {
    background: var(--hover-bg);
}

.action-btn.danger {
    color: var(--error-color);
    border-color: var(--error-color);
}

.action-btn.danger:hover {
    background: var(--error-bg);
}
</style>
