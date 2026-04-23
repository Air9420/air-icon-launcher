<template>
    <div class="about-settings">
        <div class="app-info">
            <div class="app-icon">
                <img :src="appIcon" alt="Air Icon Launcher" />
            </div>
            <div class="app-name">Air Launch</div>
            <div class="app-version">v{{ version }}</div>
        </div>

        <div class="section">
            <div class="section-title">应用描述</div>
            <div class="description">
                一款简洁高效的桌面应用程序启动器，帮助您收纳、分类和管理桌面应用程序图标。
            </div>
        </div>

        <div class="section">
            <div class="section-title">作者</div>
            <div class="author-info">
                <span class="author-name">Air</span>
            </div>
        </div>

        <div class="section">
            <div class="section-title">技术栈</div>
            <div class="tech-stack">
                <div class="tech-item">
                    <span class="tech-name">Tauri</span>
                    <span class="tech-desc">跨平台桌面应用框架</span>
                </div>
                <div class="tech-item">
                    <span class="tech-name">Rust</span>
                    <span class="tech-desc">高性能系统编程语言</span>
                </div>
                <div class="tech-item">
                    <span class="tech-name">Vue 3</span>
                    <span class="tech-desc">渐进式 JavaScript 框架</span>
                </div>
                <div class="tech-item">
                    <span class="tech-name">TypeScript</span>
                    <span class="tech-desc">类型安全的 JavaScript</span>
                </div>
                <div class="tech-item">
                    <span class="tech-name">Pinia</span>
                    <span class="tech-desc">状态管理</span>
                </div>
            </div>
        </div>

        <div class="section">
            <div class="section-title">链接</div>
            <div class="links">
                <button
                    class="link-btn"
                    type="button"
                    @click="onOpenGitHub"
                    @mousedown.stop
                >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                    </svg>
                    <span>GitHub</span>
                </button>
            </div>
            <div class="hint">开源不易，如果项目对你有帮助，欢迎点个 Star</div>
        </div>

        <div class="section">
            <div class="section-title">版权信息</div>
            <div class="copyright">
                © {{ currentYear }} Air. All rights reserved.
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";

const version = ref("...");
const currentYear = computed(() => new Date().getFullYear());
const appIcon = ref("/icon.png");

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
    }
}
</script>

<style scoped>
.about-settings {
    display: flex;
    flex-direction: column;
    gap: 14px;
}

.app-info {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 24px 0;
    background: var(--card-bg);
    border: 1px solid var(--border-color);
    border-radius: 16px;
}

.app-icon {
    width: 80px;
    height: 80px;
    border-radius: 20px;
    overflow: hidden;
    background: var(--primary-bg);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 16px;
}

.app-icon img {
    width: 60px;
    height: 60px;
    object-fit: contain;
}

.app-name {
    font-size: 18px;
    font-weight: 700;
    color: var(--text-color);
    margin-bottom: 4px;
}

.app-version {
    font-size: 13px;
    color: var(--text-secondary);
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

.description {
    font-size: 13px;
    color: var(--text-color);
    line-height: 1.6;
}

.author-info {
    display: flex;
    align-items: center;
    gap: 10px;
}

.author-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-color);
}

.contact-info {
    margin-top: 10px;
}

.contact-item {
    display: flex;
    align-items: center;
    gap: 8px;
}

.contact-label {
    font-size: 13px;
    color: var(--text-secondary);
}

.contact-value {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-color);
}

.tech-stack {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.tech-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: var(--input-bg);
    border-radius: 8px;
}

.tech-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-color);
}

.tech-desc {
    font-size: 12px;
    color: var(--text-secondary);
}

.links {
    display: flex;
    gap: 10px;
}

.link-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 40px;
    border-radius: 10px;
    border: 1px solid var(--border-color-strong);
    background: var(--input-bg);
    cursor: pointer;
    -webkit-app-region: no-drag;
    color: var(--text-color);
    font-size: 14px;
    transition: all 0.15s ease;
}

.link-btn:hover {
    background: var(--hover-bg);
}

.link-btn svg {
    opacity: 0.8;
}

.hint {
    margin-top: 8px;
    font-size: 12px;
    color: var(--text-hint);
    -webkit-app-region: no-drag;
}

.copyright {
    font-size: 12px;
    color: var(--text-tertiary);
}
</style>
