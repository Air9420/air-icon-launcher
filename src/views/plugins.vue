<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import RustPluginPanel from "./plugins/RustPluginPanel.vue";
import { showToast } from "../composables/useGlobalToast";
import { useCordis } from "../kernel";

const router = useRouter();
const ctx = useCordis();
const pluginHost = ctx.pluginHost;

const loading = ref(false);

onMounted(async () => {
    if (!pluginHost) return;
    loading.value = true;
    try {
        const result = await pluginHost.refresh();
        if (!result.ok) {
            showToast(pluginHost.formatError(result.error), { type: "error" });
        }
    } finally {
        loading.value = false;
    }
});

function onBack() {
    router.back();
}

async function onRefresh() {
    if (!pluginHost) {
        showToast("PluginHostService 未注册（ctx.pluginHost 缺失）", { type: "error" });
        return;
    }
    loading.value = true;
    try {
        const result = await pluginHost.refresh();
        if (result.ok) {
            showToast("插件列表已刷新", { type: "success" });
        } else {
            showToast(pluginHost.formatError(result.error), { type: "error" });
        }
    } catch (e) {
        showToast("刷新插件失败：" + (e instanceof Error ? e.message : String(e)), { type: "error" });
    } finally {
        loading.value = false;
    }
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
            <div class="title" data-tauri-drag-region>扩展插件（Rust）</div>
            <button
                class="refresh-btn"
                type="button"
                @click="onRefresh"
                @mousedown.stop
            >
                刷新
            </button>
        </header>

        <div class="content">
            <div v-if="loading" class="loading">加载中...</div>

            <div class="section">
                <div class="section-title">Rust 能力插件</div>
                <div class="hint">
                    manifest v2 + runtime=rust；目录 plugins/，配置在 app_data/plugin-host/。
                    能力由 capability 门控制。
                </div>
                <RustPluginPanel />
            </div>

            <div class="section">
                <div class="section-title">说明</div>
                <div class="hint">
                    旧 iframe JS 插件系统已下线。菜单扩展请使用 <code>ctx.menus</code> 贡献点；
                    宿主能力调用走 <code>ctx.pluginHost</code>。
                </div>
            </div>
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

.back-btn:hover,
.refresh-btn:hover {
    background: var(--hover-bg-strong);
}

.title {
    flex: 1;
    font-size: 16px;
    font-weight: 700;
    color: var(--text-color);
}

.content {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    height: calc(100vh - 52px - 32px);
    overflow-y: scroll;
    -ms-overflow-style: none;
    &::-webkit-scrollbar {
        display: none;
    }
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
    margin-bottom: 8px;
}

.loading {
    text-align: center;
    padding: 24px;
    color: var(--text-hint);
    font-size: 13px;
}

.hint {
    margin-top: 4px;
    margin-bottom: 10px;
    font-size: 12px;
    color: var(--text-hint);
    -webkit-app-region: no-drag;
}

.hint code {
    font-family: monospace;
    font-size: 11px;
    background: var(--hover-bg);
    padding: 1px 4px;
    border-radius: 4px;
}
</style>
