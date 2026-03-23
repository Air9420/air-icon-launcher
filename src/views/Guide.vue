<template>
    <div class="guide-page" data-tauri-drag-region>
        <header v-if="!isInSettings" class="guide-header" data-tauri-drag-region>
            <div class="title" data-tauri-drag-region>使用指南</div>
        </header>
        
        <div class="guide-content">
            <section class="guide-section">
                <h3>🚀 快速启动</h3>
                <p>在主界面点击任意启动项即可快速打开应用程序、文件或网址。</p>
            </section>
            
            <section class="guide-section">
                <h3>⌨️ 快捷键</h3>
                <ul>
                    <li><kbd>Alt + Space</kbd> - 显示/隐藏主窗口</li>
                    <li><kbd>Alt + V</kbd> - 打开剪贴板历史</li>
                    <li><kbd>Ctrl + 左键</kbd> - 拖拽窗口（可在设置中关闭）</li>
                </ul>
            </section>
            
            <section class="guide-section">
                <h3>🖱️ 热角唤起</h3>
                <p>将鼠标移动到屏幕角落并停留片刻，即可唤起主窗口。可在设置中开启并配置角落位置和灵敏度。</p>
            </section>
            
            <section class="guide-section">
                <h3>📁 分类管理</h3>
                <p>点击分类，进入该分类管理界面。右键点击可编辑或删除分类。</p>
            </section>
            
            <section class="guide-section">
                <h3>📋 剪贴板历史</h3>
                <p>按 <kbd>Alt + V</kbd> 打开剪贴板历史，点击任意条目即可复制。系统复制的文本会自动记录。</p>
            </section>
            
            <section class="guide-section">
                <h3>⚙️ 设置</h3>
                <p>点击左下角齿轮图标进入设置，可配置窗口行为、快捷键、主题、数据管理等。</p>
            </section>
        </div>
        
        <footer v-if="!isInSettings" class="guide-footer">
            <label class="check">
                <input v-model="dontShowAgain" type="checkbox" />
                <span>不再显示</span>
            </label>
            <button class="close-btn" type="button" @click="onClose">
                开始使用
            </button>
        </footer>
    </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useRouter, useRoute } from "vue-router";
import { Store, useSettingsStore } from "../stores";

const router = useRouter();
const route = useRoute();
const store = Store();
const settingsStore = useSettingsStore();
// const { showGuideOnStartup } = storeToRefs(store);

const dontShowAgain = ref<boolean>(false);

const isInSettings = computed(() => route.path.startsWith("/settings"));

function onClose() {
    if (dontShowAgain.value) {
        settingsStore.setShowGuideOnStartup(false);
    }
    router.push("/categories");
}
</script>

<style scoped>
.guide-page {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-color);
    /* 隐藏滚动条 */
    ::-webkit-scrollbar {
        display: none;
    }
}

.guide-header {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 48px;
    padding: 0 16px;
    border-bottom: 1px solid var(--border-color);
}

.title {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-color);
}

.guide-content {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
}

.guide-section {
    margin-bottom: 20px;
}

.guide-section h3 {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-color);
    margin-bottom: 8px;
}

.guide-section p {
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.6;
}

.guide-section ul {
    list-style: none;
    padding: 0;
    margin: 0;
}

.guide-section li {
    font-size: 13px;
    color: var(--text-secondary);
    margin-bottom: 6px;
    display: flex;
    align-items: center;
    gap: 8px;
}

kbd {
    display: inline-block;
    padding: 2px 6px;
    font-size: 12px;
    font-family: inherit;
    background: var(--card-bg);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: var(--text-color);
}

.guide-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px;
    border-top: 1px solid var(--border-color);
}

.check {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--text-secondary);
    cursor: pointer;
    -webkit-app-region: no-drag;
}

.check input {
    width: 16px;
    height: 16px;
}

.close-btn {
    padding: 10px 20px;
    font-size: 14px;
    font-weight: 500;
    border: none;
    border-radius: 10px;
    background: var(--primary-color);
    color: #fff;
    cursor: pointer;
    -webkit-app-region: no-drag;
    transition: opacity 0.15s ease;
}

.close-btn:hover {
    opacity: 0.9;
}
</style>
