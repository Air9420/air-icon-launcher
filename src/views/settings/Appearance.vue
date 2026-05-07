<template>
    <div class="appearance-settings">
        <div class="section">
            <div class="section-title">窗口效果</div>
            <label class="check">
                <input v-model="performanceModeDraft" type="checkbox" @change="onPerformanceModeChange" />
                <span>性能模式</span>
            </label>
            <div v-if="performanceMode" class="hint">
                性能模式已启用，透明效果已关闭
            </div>
            <template v-else>
                <div class="effect-type-row">
                    <span class="effect-type-label">效果类型</span>
                    <div class="segmented effect-type-segmented">
                        <button class="seg-btn" type="button" :class="{ active: windowEffectType === 'blur', disabled: !blurSupported }"
                            :disabled="!blurSupported"
                            @click="onWindowEffectTypeChange('blur')">
                            Blur
                        </button>
                        <button class="seg-btn" type="button" :class="{ active: windowEffectType === 'acrylic', disabled: !acrylicSupported }"
                            :disabled="!acrylicSupported"
                            @click="onWindowEffectTypeChange('acrylic')">
                            Acrylic
                        </button>
                    </div>
                </div>
                <div class="hint">
                    Blur 效果更轻量, Acrylic 更耗性能但更美观
                </div>
                <div class="hint">
                    拖拽窗口卡顿时建议切换为 Blur 效果
                </div>
                <div v-if="supportHint" class="hint">
                    {{ supportHint }}
                </div>
            </template>
        </div>

        <div class="section">
            <div class="section-title">主题</div>
            <div class="segmented">
                <button class="seg-btn" type="button" :class="{ active: theme === 'light' }"
                    @click="onSetTheme('light')">
                    亮色
                </button>
                <button class="seg-btn" type="button" :class="{ active: theme === 'dark' }" @click="onSetTheme('dark')">
                    暗色
                </button>
                <button class="seg-btn" type="button"
                    :class="{ active: theme === 'transparent', disabled: !windowEffectsEnabled }"
                    :disabled="!windowEffectsEnabled" @click="onSetTheme('transparent')">
                    透明
                </button>
                <button class="seg-btn" type="button" :class="{ active: theme === 'system' }"
                    @click="onSetTheme('system')">
                    跟随系统
                </button>
            </div>
            <div v-if="!windowEffectsEnabled" class="hint">
                毛玻璃特效已关闭，透明主题不可用
            </div>
        </div>

        <div class="section">
            <div class="section-title">图标大小（每行数量）</div>
            <div class="icon-size-row">
                <span class="icon-size-label">分类</span>
                <div class="segmented icon-size-segmented">
                    <button v-for="cols in CATEGORY_COLS_PRESETS" :key="`cat-${cols}`" class="seg-btn" type="button"
                        :class="{ active: categoryCols === cols }" @click="onSetCategoryCols(cols)">
                        {{ cols }}
                    </button>
                </div>
            </div>
            <div class="icon-size-row">
                <span class="icon-size-label">启动项</span>
                <div class="segmented icon-size-segmented">
                    <button v-for="cols in LAUNCHER_COLS_PRESETS" :key="`launcher-${cols}`" class="seg-btn" type="button"
                        :class="{ active: launcherCols === cols }" @click="onSetLauncherCols(cols)">
                        {{ cols }}
                    </button>
                </div>
            </div>
        </div>

        <div class="section">
            <div class="section-title">主页分区布局</div>
            <div class="preset-grid">
                <div class="preset-row">
                    <span class="preset-label">固定启动项</span>
                    <div class="segmented preset-segmented">
                        <button v-for="preset in homeLayoutPresetOptions.slice(0, 4)" :key="`pinned-${preset}`"
                            class="seg-btn" type="button" :class="{
                                active:
                                    homeSectionLayouts.pinned.preset === preset,
                            }" @click="
                                onSetHomeSectionLayoutPreset(
                                    'pinned',
                                    preset
                                )
                                ">
                            {{ preset }}
                        </button>
                    </div>
                </div>
                <div class="preset-row">
                    <span class="preset-label"></span>
                    <div class="segmented preset-segmented">
                        <button v-for="preset in homeLayoutPresetOptions.slice(4)" :key="`pinned-${preset}`"
                            class="seg-btn" type="button" :class="{
                                active:
                                    homeSectionLayouts.pinned.preset === preset,
                            }" @click="
                                onSetHomeSectionLayoutPreset(
                                    'pinned',
                                    preset
                                )
                                ">
                            {{ preset }}
                        </button>
                    </div>
                </div>
            </div>
            <div class="preset-grid">
                <div class="preset-row">
                    <span class="preset-label">最近使用</span>
                    <div class="segmented preset-segmented">
                        <button v-for="preset in homeLayoutPresetOptions.slice(0, 4)" :key="`recent-${preset}`"
                            class="seg-btn" type="button" :class="{
                                active:
                                    homeSectionLayouts.recent.preset === preset,
                            }" @click="
                                onSetHomeSectionLayoutPreset(
                                    'recent',
                                    preset
                                )
                                ">
                            {{ preset }}
                        </button>
                    </div>
                </div>
                <div class="preset-row">
                    <span class="preset-label"></span>
                    <div class="segmented preset-segmented">
                        <button v-for="preset in homeLayoutPresetOptions.slice(4)" :key="`recent-${preset}`"
                            class="seg-btn" type="button" :class="{
                                active:
                                    homeSectionLayouts.recent.preset === preset,
                            }" @click="
                                onSetHomeSectionLayoutPreset(
                                    'recent',
                                    preset
                                )
                                ">
                            {{ preset }}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { useSettingsStore } from "../../stores";
import { useUIStore, HOME_LAYOUT_PRESETS, CATEGORY_COLS_PRESETS, LAUNCHER_COLS_PRESETS, HomeLayoutPresetKey } from "../../stores/uiStore";
import { showToast } from "../../composables/useGlobalToast";

const settingsStore = useSettingsStore();
const uiStore = useUIStore();
const {
    categoryCols,
    launcherCols,
    homeSectionLayouts,
} = storeToRefs(uiStore);
const {
    theme,
    windowEffectsEnabled,
    performanceMode,
    windowEffectType,
    windowEffectSupport,
} = storeToRefs(settingsStore);

const performanceModeDraft = ref<boolean>(false);
const homeLayoutPresetOptions = HOME_LAYOUT_PRESETS.map((x) => x.preset);
const blurSupported = computed(() => windowEffectSupport.value?.blurSupported ?? true);
const acrylicSupported = computed(() => windowEffectSupport.value?.acrylicSupported ?? true);
const supportHint = computed(() => {
    if (performanceMode.value) {
        return windowEffectSupport.value?.message ?? "";
    }
    if (windowEffectSupport.value && (!blurSupported.value || !acrylicSupported.value)) {
        return windowEffectSupport.value.message ?? "";
    }
    return "";
});

watch(performanceMode, (val) => {
    performanceModeDraft.value = val;
}, { immediate: true });

onMounted(() => {
    void settingsStore.refreshWindowEffectSupport();
});

function onSetCategoryCols(cols: number) {
    uiStore.setCategoryCols(cols);
}

function onSetLauncherCols(cols: number) {
    uiStore.setLauncherCols(cols);
}

function onSetHomeSectionLayoutPreset(
    section: "pinned" | "recent",
    preset: HomeLayoutPresetKey
) {
    uiStore.setHomeSectionLayoutPreset(section, preset);
}

async function onSetTheme(newTheme: "light" | "dark" | "transparent" | "system") {
    if (newTheme === "transparent" && !windowEffectsEnabled.value) {
        return;
    }
    await settingsStore.setTheme(newTheme);
}

async function onPerformanceModeChange() {
    const enabled = performanceModeDraft.value;
    try {
        const result = await settingsStore.setPerformanceMode(enabled);
        if (result.message) {
            showToast(result.message, { type: "info", duration: 5000 });
        }
    } catch (e) {
        console.error("设置失败:", e);
        showToast("设置失败，可能需要重启应用以完全生效", { type: "error" });
    }
}

async function onWindowEffectTypeChange(type: "blur" | "acrylic") {
    try {
        const result = await settingsStore.setWindowEffectType(type);
        if (result.message) {
            showToast(result.message, { type: "info", duration: 5000 });
        }
    } catch (e) {
        console.error("设置失败:", e);
        showToast("设置失败，可能需要重启应用以完全生效", { type: "error" });
    }
}
</script>

<style lang="scss" scoped>
@use "../../styles/settings/section" as settings;

.appearance-settings {
    @include settings.page-stack();
}

.section {
    @include settings.section-card();
}

.section-title {
    @include settings.section-title();
}

.icon-size-row {
    display: flex;
    align-items: center;
    gap: 12px;
}

.icon-size-row:last-child {
    margin-bottom: 0;
}

.icon-size-label {
    font-size: 13px;
    color: var(--text-secondary);
    min-width: 70px;
}

.icon-size-segmented {
    flex: 1;
}

.preset-grid {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.preset-grid:last-child {
    margin-bottom: 0;
}

.preset-row {
    display: flex;
    align-items: center;
    gap: 12px;
}

.preset-label {
    font-size: 13px;
    color: var(--text-secondary);
    min-width: 70px;
}

.preset-segmented {
    flex: 1;
    display: flex;
    gap: 6px;
}

.preset-segmented .seg-btn {
    flex: 1;
}

.segmented {
    display: flex;
    gap: 8px;
}

.seg-btn {
    flex: 1;
    height: 34px;
    border-radius: 12px;
    border: 1px solid var(--border-color-strong);
    background: var(--input-bg);
    cursor: pointer;
    -webkit-app-region: no-drag;
    color: var(--text-color);
}

.seg-btn.active {
    border-color: var(--primary-color);
    background: var(--primary-bg);
}

.seg-btn.disabled,
.seg-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.check {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    color: var(--text-secondary);
    -webkit-app-region: no-drag;
}

.check input {
    width: 16px;
    height: 16px;
}

.hint {
    @include settings.hint();
}

.effect-type-row {
    display: flex;
    align-items: center;
    gap: 12px;
}

.effect-type-label {
    font-size: 13px;
    color: var(--text-secondary);
    min-width: 70px;
}

.effect-type-segmented {
    flex: 1;
}
</style>
