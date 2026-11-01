<script setup lang="ts">
import { useRouter } from "vue-router";
import RustPluginPanel from "./plugins/RustPluginPanel.vue";

const router = useRouter();

function onBack() {
    router.back();
}
</script>

<template>
    <div
        class="plugins-view"
        data-menu-type="Settings-View"
        data-tauri-drag-region
    >
        <header class="plugins-header" data-tauri-drag-region>
            <button
                class="back-btn"
                type="button"
                @click="onBack"
                @mousedown.stop
            >
                返回
            </button>
            <div class="title" data-tauri-drag-region>扩展插件</div>
        </header>

        <div class="content">
            <RustPluginPanel />
        </div>
    </div>
</template>

<style scoped>
.plugins-view {
    width: 100vw;
    height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg-color);
}

.plugins-header {
    height: 52px;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 12px;
    background: var(--card-bg);
    border-bottom: 1px solid var(--border-color);
    backdrop-filter: var(--backdrop-blur);
}

.back-btn,
.refresh-btn {
    border: 0;
    padding: 8px 10px;
    border-radius: 10px;
    background: var(--hover-bg);
    cursor: pointer;
    -webkit-app-region: no-drag;
    color: var(--text-color);
}

.back-btn:hover {
    background: var(--hover-bg-strong);
}

.title {
    flex: 1;
    font-size: 16px;
    font-weight: 700;
    color: var(--text-color);
}

/* 去掉外层卡片与多余 padding，交给列表组件自己排 */
.content {
    padding: 12px;
    height: calc(100vh - 52px - 24px);
    overflow-y: auto;
    -ms-overflow-style: none;
}

.content::-webkit-scrollbar {
    display: none;
}
</style>
