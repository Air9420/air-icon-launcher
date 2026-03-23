<template>
    <div class="appearance-settings">
        <div class="section">
            <div class="section-title">窗口效果</div>
            <label class="check">
                <input v-model="windowEffectsDraft" type="checkbox" @change="onWindowEffectsChange" />
                <span>毛玻璃特效</span>
            </label>
            <div class="hint">
                关闭毛玻璃特效后将使用纯色背景，透明主题将不可用。需要重启程序生效。
            </div>
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
                    <button class="seg-btn" type="button" :class="{ active: categoryCols === 4 }"
                        @click="onSetCategoryCols(4)">
                        4
                    </button>
                    <button class="seg-btn" type="button" :class="{ active: categoryCols === 5 }"
                        @click="onSetCategoryCols(5)">
                        5
                    </button>
                </div>
            </div>
            <div class="icon-size-row">
                <span class="icon-size-label">启动项</span>
                <div class="segmented icon-size-segmented">
                    <button class="seg-btn" type="button" :class="{ active: launcherCols === 4 }"
                        @click="onSetLauncherCols(4)">
                        4
                    </button>
                    <button class="seg-btn" type="button" :class="{ active: launcherCols === 5 }"
                        @click="onSetLauncherCols(5)">
                        5
                    </button>
                    <button class="seg-btn" type="button" :class="{ active: launcherCols === 6 }"
                        @click="onSetLauncherCols(6)">
                        6
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
import { ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { invoke } from "@tauri-apps/api/core";
import { safeInvoke } from "../../utils/invoke-wrapper";
import { Store, useSettingsStore } from "../../stores";
import { useUIStore, HOME_LAYOUT_PRESETS, HomeLayoutPresetKey } from "../../stores/uiStore";

const store = Store();
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
} = storeToRefs(settingsStore);

const windowEffectsDraft = ref<boolean>(true);
const homeLayoutPresetOptions = HOME_LAYOUT_PRESETS.map((x) => x.preset);

watch(windowEffectsEnabled, (val) => {
    windowEffectsDraft.value = val;
}, { immediate: true });

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

function onSetTheme(newTheme: "light" | "dark" | "transparent" | "system") {
    if (newTheme === "transparent" && !windowEffectsEnabled.value) {
        return;
    }
    settingsStore.setTheme(newTheme);
}

async function onWindowEffectsChange() {
    const enabled = windowEffectsDraft.value;

    const shouldRestart = windowEffectsEnabled.value !== enabled;

    if (!enabled && theme.value === "transparent") {
        settingsStore.setTheme("system");
    }

    settingsStore.setWindowEffectsEnabled(enabled);

    try {
        await safeInvoke("set_window_effects", { enabled });

        if (shouldRestart) {
            if (confirm("毛玻璃特效设置已更改，需要重启程序才能完全生效。是否立即重启？")) {
                safeInvoke("restart_app");
            }
        }
    } catch (e) {
        console.error("Failed to set window effects:", e);
        windowEffectsDraft.value = !enabled;
        alert("设置失败：" + e);
    }
}
</script>

<style scoped>
.appearance-settings {
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

.icon-size-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 8px;
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
    margin-bottom: 8px;
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
    margin-top: 8px;
    font-size: 12px;
    color: var(--text-hint);
    -webkit-app-region: no-drag;
}
</style>
