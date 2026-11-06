<template>
    <div class="about-settings">
        <!-- 应用信息 -->
        <div class="app-info">
            <div class="app-icon">
                <img :src="appIcon" alt="Air Icon Launcher" />
            </div>
            <div class="app-meta">
                <div class="app-name">
                    Air Launch
                    <span class="app-version">v{{ version }}</span>
                </div>
                <div class="app-desc">简洁高效的桌面启动器，收纳、分类、管理你的应用图标。</div>
                <div class="app-actions">
                    <button
                        class="check-update-btn"
                        type="button"
                        :disabled="isChecking"
                        @click="onCheckUpdate"
                    >
                        {{ isChecking ? '检查中...' : '检查更新' }}
                    </button>
                    <button
                        v-if="isDev"
                        class="test-update-btn"
                        type="button"
                        @click="onTestUpdate"
                    >
                        测试更新弹窗
                    </button>
                </div>
            </div>
        </div>

        <!-- 技术栈 -->
        <div class="section">
            <div class="section-title">技术栈</div>
            <div class="tech-grid">
                <div class="tech-item" v-for="t in techStack" :key="t.name">
                    <span class="tech-name">{{ t.name }}</span>
                    <span class="tech-desc">{{ t.desc }}</span>
                </div>
            </div>
        </div>

        <!-- 链接 + 版权 -->
        <div class="section">
            <div class="section-title">项目主页</div>
            <button class="link-row" type="button" @click="onOpenGitHub" @mousedown.stop>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
                <span class="link-text">GitHub · Air9420/air-icon-launcher</span>
                <span class="link-arrow">↗</span>
            </button>
            <div class="footer-line">
                <span>© {{ currentYear }} Air</span>
                <span class="dot">·</span>
                <span>开源不易，欢迎点个 Star</span>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { showToast } from "../../composables/useGlobalToast";
import { applyCheckResult, checkForUpdate, parseCheckError } from "../../utils/updater";
import { useUpdateStore } from "../../stores/update";

const router = useRouter();
const version = ref("...");
const currentYear = computed(() => new Date().getFullYear());
const appIcon = ref("/icon.png");
const isChecking = ref(false);
const updateStore = useUpdateStore();

const techStack = [
    { name: "Tauri 2", desc: "桌面应用框架" },
    { name: "Rust", desc: "后端与系统能力" },
    { name: "Vue 3", desc: "界面层" },
    { name: "TypeScript", desc: "类型安全" },
    { name: "Pinia", desc: "状态管理" },
    { name: "SQLite", desc: "本地数据存储" },
];

// 开发模式判断
const isDev = import.meta.env.DEV;

onMounted(async () => {
    try {
        version.value = await getVersion();
    } catch (e) {
        console.error("Failed to get version:", e);
        version.value = "unknown";
    }
});

async function onOpenGitHub() {
    try {
        await openUrl("https://github.com/Air9420/air-icon-launcher");
    } catch (e) {
        console.error("Failed to open GitHub:", e);
        showToast("无法打开链接", { type: "error" });
    }
}

async function onCheckUpdate() {
    isChecking.value = true;
    try {
        const result = await checkForUpdate();
        if (applyCheckResult(result)) {
            // 手动检查：直接进更新页，不再多问一次
            updateStore.dismissUpdatePrompt();
            router.push('/update');
        } else {
            showToast("当前已是最新版本", { type: "success" });
        }
    } catch (error) {
        const { message } = parseCheckError(error);
        console.error("检查更新失败:", message);
        showToast(`检查更新失败: ${message}`, { type: "error" });
    } finally {
        isChecking.value = false;
    }
}

function onTestUpdate() {
    // 演示用：伪造一个比当前高的版本号，走真实的「发现更新」提示流程
    updateStore.downloadComplete = false
    updateStore.updateProgress = null
    updateStore.updatePhase = 'idle'
    updateStore.error = null
    updateStore.updateInfo = {
        version: nextPatchVersion(version.value),
        notes: `## 测试更新\n\n### 新增\n- 更新页支持 Markdown 渲染\n- 更新源在页面顶部直接切换\n\n### 修复\n- 修复了更新检查的并发问题\n- 优化错误日志输出\n\n**感谢使用 Air Launch！**`,
        pub_date: new Date().toISOString(),
        source: 'github',
        latestJsonUrl: '',
        resumableBytes: 12 * 1024 * 1024,
        platforms: {
            'windows-x86_64': {
                signature: '',
                url: ''
            }
        }
    };
    updateStore.showUpdatePrompt();
}

/** 取当前版本的下一个补丁号，仅用于测试提示 UI */
function nextPatchVersion(current: string): string {
    const m = /^(\d+)\.(\d+)\.(\d+)/.exec(current.trim());
    if (!m) return current;
    return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}
</script>

<style lang="scss" scoped>
@use "../../styles/settings/section" as settings;

.about-settings {
    @include settings.page-stack();
}

/* ---- 应用信息 ---- */

.app-info {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 16px;
    background: var(--card-bg);
    border: 1px solid var(--border-color);
    border-radius: 16px;
}

.app-icon {
    width: 56px;
    height: 56px;
    border-radius: 14px;
    overflow: hidden;
    background: var(--primary-bg);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;

    img {
        width: 42px;
        height: 42px;
        object-fit: contain;
    }
}

.app-meta {
    min-width: 0;
    flex: 1;
}

.app-name {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 16px;
    font-weight: 700;
    color: var(--text-color);
}

.app-version {
    font-size: 12px;
    font-weight: 400;
    color: var(--text-tertiary);
}

.app-desc {
    margin-top: 4px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-secondary);
}

.app-actions {
    display: flex;
    gap: 8px;
    margin-top: 10px;
    flex-wrap: wrap;
}

.check-update-btn,
.test-update-btn {
    padding: 5px 14px;
    border-radius: 7px;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s ease;
    -webkit-app-region: no-drag;

    &:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }
}

.check-update-btn {
    border: 1px solid var(--primary-color);
    background: var(--primary-bg);
    color: var(--primary-color);

    &:hover:not(:disabled) {
        background: var(--primary-color);
        color: #fff;
    }
}

.test-update-btn {
    border: 1px dashed var(--border-color-strong);
    background: transparent;
    color: var(--text-tertiary);

    &:hover {
        border-color: var(--primary-color);
        color: var(--primary-color);
    }
}

/* ---- 技术栈 ---- */

.section {
    @include settings.section-card();
}

.section-title {
    @include settings.section-title();
}

.tech-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
}

.tech-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 10px;
    border-radius: 9px;
    background: var(--input-bg);
    border: 1px solid var(--border-color);
    min-width: 0;
}

.tech-name {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-color);
}

.tech-desc {
    font-size: 11px;
    line-height: 1.4;
    color: var(--text-tertiary);
}

/* ---- 链接 ---- */

.link-row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 12px;
    border-radius: 10px;
    border: 1px solid var(--border-color);
    background: var(--input-bg);
    color: var(--text-color);
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s ease;
    -webkit-app-region: no-drag;

    &:hover {
        background: var(--hover-bg);
        border-color: var(--border-color-strong);
    }

    svg {
        opacity: 0.8;
        flex-shrink: 0;
    }
}

.link-text {
    font-weight: 500;
}

.link-arrow {
    margin-left: auto;
    font-size: 12px;
    color: var(--text-tertiary);
}

.footer-line {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 10px;
    font-size: 11px;
    color: var(--text-tertiary);
}

.dot {
    opacity: 0.6;
}
</style>
