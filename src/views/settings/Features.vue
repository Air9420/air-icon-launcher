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

        <div class="section">
            <div class="section-title">外部项屏蔽列表</div>
            <div v-if="blockedExternalLaunches.length === 0" class="hint-text">
                暂无已屏蔽的外部启动项
            </div>
            <div v-else class="blocked-list">
                <div
                    v-for="entry in blockedExternalLaunches"
                    :key="entry.path"
                    class="blocked-item"
                >
                    <div class="blocked-main">
                        <div class="blocked-name" :title="entry.name">{{ entry.name }}</div>
                        <div class="blocked-path" :title="entry.path">{{ entry.path }}</div>
                    </div>
                    <button
                        class="action-btn"
                        type="button"
                        @click="onUnblockExternal(entry.path)"
                    >
                        取消屏蔽
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { useRouter } from "vue-router";
import { Store } from "../../stores";
import { storeToRefs } from "pinia";
import { useConfirmDialog } from "../../composables/useConfirmDialog";
import { useStatsStore } from "../../stores/statsStore";

const router = useRouter();
const store = Store();
const statsStore = useStatsStore();
const { blockedExternalLaunches } = storeToRefs(statsStore);
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

function onUnblockExternal(path: string) {
    statsStore.unblockExternalLaunchPath(path);
}
</script>

<style lang="scss" scoped>
@use "../../styles/settings/section" as settings;

.features-settings {
    @include settings.page-stack();
}

.section {
    @include settings.section-card();
}

.section-title {
    @include settings.section-title();
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

.hint-text {
    @include settings.hint(0);
}

.blocked-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.blocked-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px;
    border: 1px solid var(--border-color);
    border-radius: 10px;
    background: var(--bg-secondary);

    & .action-btn {
        width: 80px;
    }
}

.blocked-main {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.blocked-name {
    font-size: 13px;
    color: var(--text-color);
    font-weight: 600;
}

.blocked-path {
    font-size: 12px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    width: 250px;
}
</style>
