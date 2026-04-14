<template>
    <Teleport to="body">
        <div v-if="guideStore.isOnboardingActive" class="onboarding-overlay">
            <div class="onboarding-spotlight" :style="spotlightStyle"></div>
            <div class="onboarding-content" :style="contentStyle">
                <div class="step-indicator">
                    <span
                        v-for="i in 3"
                        :key="i"
                        class="step-dot"
                        :class="{ active: guideStore.currentStep === i - 1, completed: guideStore.currentStep > i - 1 }"
                    ></span>
                </div>

                <div class="guide-card">
                    <div class="guide-title">{{ currentStepConfig.title }}</div>
                    <div class="guide-description">{{ currentStepConfig.description }}</div>

                    <div class="guide-actions">
                        <button
                            v-if="guideStore.currentStep > 0"
                            class="btn-secondary"
                            type="button"
                            @click="onPrevious"
                        >
                            上一步
                        </button>
                        <button
                            class="btn-skip"
                            type="button"
                            @click="onSkip"
                        >
                            跳过
                        </button>
                        <button
                            v-if="guideStore.currentStep < 2"
                            class="btn-primary"
                            type="button"
                            @click="onNext"
                        >
                            下一步
                        </button>
                        <button
                            v-else
                            class="btn-primary"
                            type="button"
                            @click="onComplete"
                        >
                            完成
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useGuideStore } from "../stores";

const guideStore = useGuideStore();

const stepConfigs = [
    {
        title: "拖放文件添加启动项",
        description: "将任意文件、文件夹或快捷方式直接拖放到窗口中，即可添加到启动项",
        targetSelector: ".categorie-view",
        contentPosition: "center",
    },
    {
        title: "双击启动项打开应用",
        description: "双击启动项图标即可快速打开应用程序、文件或网址",
        targetSelector: ".categorie-view",
        contentPosition: "center",
    },
    {
        title: "使用搜索快速定位",
        description: "在顶部搜索框输入关键词，即可快速找到需要的启动项",
        targetSelector: ".search-header",
        contentPosition: "bottom",
    },
];

const currentStepConfig = computed(() => stepConfigs[guideStore.currentStep]);

const spotlightStyle = computed(() => {
    return {
        borderRadius: "12px",
        boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.5)",
    };
});

const contentStyle = computed(() => {
    const position = currentStepConfig.value.contentPosition;
    if (position === "bottom") {
        return {
            top: "auto",
            bottom: "20px",
            left: "50%",
            transform: "translateX(-50%)",
        };
    }
    return {
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
    };
});

function onPrevious() {
    guideStore.previousStep();
}

function onNext() {
    guideStore.nextStep();
}

function onSkip() {
    guideStore.skipOnboarding();
}

function onComplete() {
    guideStore.completeOnboarding();
}
</script>

<style scoped>
.onboarding-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    z-index: 9999;
    pointer-events: none;
}

.onboarding-spotlight {
    position: absolute;
    pointer-events: none;
}

.onboarding-content {
    position: absolute;
    z-index: 10000;
    pointer-events: auto;
}

.step-indicator {
    display: flex;
    justify-content: center;
    gap: 8px;
    margin-bottom: 12px;
}

.step-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.3);
    transition: all 0.2s ease;
}

.step-dot.active {
    background: #fff;
    transform: scale(1.2);
}

.step-dot.completed {
    background: rgba(255, 255, 255, 0.6);
}

.guide-card {
    background: var(--card-bg-solid, #fff);
    border-radius: 16px;
    padding: 20px 24px;
    min-width: 280px;
    max-width: 320px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}

.guide-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-color, #333);
    margin-bottom: 8px;
}

.guide-description {
    font-size: 13px;
    color: var(--text-secondary, #666);
    line-height: 1.5;
    margin-bottom: 16px;
}

.guide-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
}

.btn-primary,
.btn-secondary,
.btn-skip {
    padding: 8px 16px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: opacity 0.15s ease;
    border: none;
}

.btn-primary:hover,
.btn-secondary:hover,
.btn-skip:hover {
    opacity: 0.9;
}

.btn-primary {
    background: var(--primary-color, #0078d4);
    color: #fff;
}

.btn-secondary {
    background: var(--bg-color-secondary, #f0f0f0);
    color: var(--text-color, #333);
}

.btn-skip {
    background: transparent;
    color: var(--text-tertiary, #999);
}
</style>
