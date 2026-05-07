<template>
    <div class="settings-view" data-menu-type="Settings-View" data-tauri-drag-region>
        <header class="settings-header" data-tauri-drag-region>
            <button class="back-btn" type="button" @click="onBack" @mousedown.stop>
                返回
            </button>
            <div class="title" data-tauri-drag-region>设置</div>
        </header>

        <div class="tabs-container">
            <!-- <button class="scroll-btn scroll-left" type="button" @click="scrollTabs(-1)" @mousedown.stop>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="15 18 9 12 15 6"></polyline>
                </svg>
            </button> -->
            <div class="tabs-wrapper" ref="tabsWrapper" @wheel="onWheel">
                <div class="tabs" ref="tabsContainer">
                    <button v-for="tab in tabs" :key="tab.path" class="tab" :class="{ active: isActiveTab(tab.path) }"
                        type="button" @click="onTabClick(tab.path)" @mousedown.stop>
                        {{ tab.name }}
                    </button>
                </div>
            </div>
            <!-- <button class="scroll-btn scroll-right" type="button" @click="scrollTabs(1)" @mousedown.stop>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
            </button> -->
        </div>

        <div class="content">
            <router-view />
        </div>
    </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { useRouter, useRoute } from "vue-router";
import { computeActiveTabScrollLeft } from "./tabScroll";

const router = useRouter();
const route = useRoute();

const tabsWrapper = ref<HTMLElement | null>(null);
const tabsContainer = ref<HTMLElement | null>(null);

const tabs = [
    { name: "外观", path: "/settings/appearance" },
    { name: "快捷键", path: "/settings/shortcuts" },
    { name: "窗口", path: "/settings/window" },
    { name: "剪贴板", path: "/settings/clipboard" },
    { name: "功能", path: "/settings/features" },
    { name: "数据", path: "/settings/data" },
    { name: "指南", path: "/settings/guide" },
    { name: "关于", path: "/settings/about" },
    { name: "统计", path: "/settings/stats" },
];

function onBack() {
    router.push("/categories");
}

function isActiveTab(path: string) {
    return route.path === path;
}

function onTabClick(path: string) {
    router.push(path);
}

function scrollActiveTabIntoView() {
    const wrapper = tabsWrapper.value;
    const container = tabsContainer.value;
    if (!wrapper || !container) return;

    const activeTab = container.querySelector<HTMLElement>(".tab.active");
    if (!activeTab) return;

    const nextScrollLeft = computeActiveTabScrollLeft({
        currentScrollLeft: wrapper.scrollLeft,
        viewportWidth: wrapper.clientWidth,
        tabOffsetLeft: activeTab.offsetLeft,
        tabWidth: activeTab.offsetWidth,
        edgePadding: 4,
        tailWidth: 16,
    });

    wrapper.scrollTo({
        left: nextScrollLeft,
        behavior: "smooth",
    });
}

function onWheel(e: WheelEvent) {
    if (!tabsWrapper.value) return;
    e.preventDefault();
    tabsWrapper.value.scrollLeft += e.deltaY;
}

watch(
    () => route.path,
    async () => {
        await nextTick();
        scrollActiveTabIntoView();
    },
    { immediate: true }
);
</script>

<style scoped>
.settings-view {
    width: 100vw;
    height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg-color);
}

.settings-header {
    height: 52px;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 12px;
    background: var(--card-bg);
    border-bottom: 1px solid var(--border-color);
    backdrop-filter: var(--backdrop-blur);
}

.back-btn {
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
    font-size: 16px;
    font-weight: 700;
    color: var(--text-color);
}

.tabs-container {
    display: flex;
    align-items: flex-end;
    background: var(--card-bg);
    border-bottom: 1px solid var(--border-color);
    box-sizing: border-box;
    height: 40px;
}

.scroll-btn {
    flex: 0 0 auto;
    width: 24px;
    height: 24px;
    border: 0;
    padding: 0;
    border-radius: 6px;
    background: transparent;
    cursor: pointer;
    -webkit-app-region: no-drag;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    justify-content: center;
    align-self: center;
}

.scroll-btn:hover {
    background: var(--hover-bg);
    color: var(--text-color);
}

.tabs-wrapper {
    flex: 1;
    overflow-x: auto;
    /* overflow-y: hidden; */
    scrollbar-width: none;
    -ms-overflow-style: none;
}

.tabs-wrapper::-webkit-scrollbar {
    display: none;
}

.tabs {
    display: flex;
    gap: 0;
    padding: 0;
    /* 不需要按shift键滚轮可横滚动 */
    user-select: none;
}

.tabs::before,
.tabs::after {
    content: "";
    flex: 0 0 4px;
    width: 4px;
}



.tab:first-child.active::before {
    content: none;
}

.tab:last-child.active::after {
    content: none;
}

.tab {
    flex: 0 0 auto;
    border: 0;
    padding: 8px 10px;
    border-top-left-radius: 10px;
    border-top-right-radius: 10px;
    background: var(--hover-bg);
    cursor: pointer;
    color: var(--text-color);
    -webkit-app-region: no-drag;
    white-space: nowrap;
    font-size: 13px;
    margin: 0 1px;

}

.tab:hover {
    background: var(--hover-bg-strong);
}

.tab.active {
    background: var(--hover-bg-strong);
    font-weight: 600;
    position: relative;
}

.tab.active::after,
.tab.active::before {
    content: '';
    position: absolute;
    bottom: 0px;
    width: 16px;
    height: 16px;
    /* 鼠标穿透 */
    pointer-events: none;
}

.tab.active::before {
    left: -16px;
    background: radial-gradient(circle at 0 0, transparent 18px, var(--hover-bg-strong) 20px);
}

.tab.active::after {
    right: -16px;
    background: radial-gradient(circle at 100% 0, transparent 18px, var(--hover-bg-strong) 20px);
}

.tab:has(+ .tab.active) {
    border-bottom-right-radius: 8px;
}

.tab.active+.tab {
    border-bottom-left-radius: 8px;
}

.content {
    padding: 16px;
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow-y: auto;
    -ms-overflow-style: none;
}

.content::-webkit-scrollbar {
    display: none;
}
</style>
