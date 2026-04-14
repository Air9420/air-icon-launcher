<template>
    <div class="window-settings">
        <div class="section">
            <div class="section-title">窗口</div>
            <label class="check">
                <input
                    v-model="followMouseDraft"
                    type="checkbox"
                    @change="onApplyFollowMouse"
                />
                <span>显示时跟随鼠标位置</span>
            </label>
            <div class="segmented" :class="{ disabled: !followMouseDraft }">
                <button
                    class="seg-btn"
                    type="button"
                    :class="{ active: followMouseAnchorDraft === 'top' }"
                    :disabled="!followMouseDraft"
                    @click="onSetFollowMouseAnchor('top')"
                >
                    顶部
                </button>
                <button
                    class="seg-btn"
                    type="button"
                    :class="{ active: followMouseAnchorDraft === 'center' }"
                    :disabled="!followMouseDraft"
                    @click="onSetFollowMouseAnchor('center')"
                >
                    居中
                </button>
                <button
                    class="seg-btn"
                    type="button"
                    :class="{ active: followMouseAnchorDraft === 'bottom' }"
                    :disabled="!followMouseDraft"
                    @click="onSetFollowMouseAnchor('bottom')"
                >
                    底部
                </button>
            </div>
            <label class="check" style="margin-top: 6px;">
                <input
                    v-model="hideOnCtrlRightClickDraft"
                    type="checkbox"
                    @change="onHideOnCtrlRightClickChange"
                />
                <span>Ctrl + 右键隐藏窗口</span>
            </label>
        </div>

        <div class="section">
            <div class="section-title">拖拽</div>
            <label class="check">
                <input
                    v-model="ctrlDragDraft"
                    type="checkbox"
                    @change="onCtrlDragChange"
                />
                <span>Ctrl + 左键拖拽窗口</span>
            </label>
            <div class="hint">
                按住 Ctrl 键并在窗口任意位置按住左键可拖拽窗口
            </div>
        </div>

        <div class="section">
            <div class="section-title">启动</div>
            <label class="check">
                <input
                    v-model="autostartEnabledDraft"
                    type="checkbox"
                    :disabled="autostartLoading"
                    @change="onAutostartEnabledChange"
                />
                <span>开机自启</span>
            </label>
            <div v-if="autostartEnabledDraft" class="autostart-methods">
                <div class="method-label">自启方式</div>
                <div class="method-grid">
                    <button
                        v-for="method in autostartMethods"
                        :key="method.value"
                        class="method-btn"
                        type="button"
                        :class="{ active: autostartMethodDraft === method.value }"
                        :disabled="autostartLoading"
                        @click="onSelectAutostartMethod(method.value)"
                    >
                        <span class="method-icon">{{ method.icon }}</span>
                        <span class="method-name">{{ method.name }}</span>
                    </button>
                </div>
                <div class="method-desc">{{ currentMethodDesc }}</div>
            </div>
            <div v-if="autostartError" class="hint error">
                {{ autostartError }}
            </div>
        </div>

        <div class="section">
            <div class="section-title">启动项</div>
            <label class="check">
                <input
                    v-model="autoHideAfterLaunchDraft"
                    type="checkbox"
                    @change="onAutoHideAfterLaunchChange"
                />
                <span>启动成功后自动隐藏窗口</span>
            </label>
            <div class="hint">
                成功打开一个启动项后自动隐藏本程序窗口
            </div>
            <div class="hint" style="margin-top: 4px; color: var(--text-hint);">
                💡 按住 <kbd>Ctrl</kbd> 键可连续启动多个，松开后自动隐藏
            </div>
        </div>

        <div class="section">
            <div class="section-title">热角唤起</div>
            <label class="check">
                <input
                    v-model="cornerHotspotEnabledDraft"
                    type="checkbox"
                    @change="onCornerHotspotChange"
                />
                <span>启用热角唤起</span>
            </label>
            <div class="hint">
                鼠标移动到屏幕角落并停留后唤起界面
            </div>
            
            <div v-if="cornerHotspotEnabledDraft" class="corner-settings">
                <div class="setting-row">
                    <span class="setting-label">角落位置</span>
                    <div class="corner-grid">
                        <button
                            class="corner-btn"
                            type="button"
                            :class="{ active: cornerHotspotPositionDraft === 'top-left' }"
                            @click="onSetCornerPosition('top-left')"
                        >
                            左上
                        </button>
                        <button
                            class="corner-btn"
                            type="button"
                            :class="{ active: cornerHotspotPositionDraft === 'top-right' }"
                            @click="onSetCornerPosition('top-right')"
                        >
                            右上
                        </button>
                        <button
                            class="corner-btn"
                            type="button"
                            :class="{ active: cornerHotspotPositionDraft === 'bottom-left' }"
                            @click="onSetCornerPosition('bottom-left')"
                        >
                            左下
                        </button>
                        <button
                            class="corner-btn"
                            type="button"
                            :class="{ active: cornerHotspotPositionDraft === 'bottom-right' }"
                            @click="onSetCornerPosition('bottom-right')"
                        >
                            右下
                        </button>
                    </div>
                </div>
                
                <div class="setting-row">
                    <span class="setting-label">灵敏度</span>
                    <div class="sensitivity-row">
                        <button
                            class="sens-btn"
                            type="button"
                            :class="{ active: cornerHotspotSensitivityDraft === 'low' }"
                            @click="onSetCornerSensitivity('low')"
                        >
                            低
                        </button>
                        <button
                            class="sens-btn"
                            type="button"
                            :class="{ active: cornerHotspotSensitivityDraft === 'medium' }"
                            @click="onSetCornerSensitivity('medium')"
                        >
                            中
                        </button>
                        <button
                            class="sens-btn"
                            type="button"
                            :class="{ active: cornerHotspotSensitivityDraft === 'high' }"
                            @click="onSetCornerSensitivity('high')"
                        >
                            高
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { storeToRefs } from "pinia";
import { onMounted, ref, watchEffect, computed } from "vue";
import { safeInvoke } from "../../utils/invoke-wrapper";
import { useSettingsStore, type AutostartType } from "../../stores";

const settingsStore = useSettingsStore();
const {
    followMouseOnShow,
    followMouseYAnchor,
    autostartEnabled,
    autostartMethod,
    autostartLoading,
    autostartError,
    ctrlDragEnabled,
    autoHideAfterLaunch,
    cornerHotspotEnabled,
    cornerHotspotPosition,
    cornerHotspotSensitivity,
    hideOnCtrlRightClick,
} = storeToRefs(settingsStore);

const followMouseDraft = ref<boolean>(false);
const followMouseAnchorDraft = ref<"top" | "center" | "bottom">("center");
const autostartEnabledDraft = ref<boolean>(false);
const autostartMethodDraft = ref<AutostartType>("Registry");
const ctrlDragDraft = ref<boolean>(true);
const autoHideAfterLaunchDraft = ref<boolean>(false);
const cornerHotspotEnabledDraft = ref<boolean>(false);
const cornerHotspotPositionDraft = ref<string>("top-right");
const cornerHotspotSensitivityDraft = ref<string>("medium");
const hideOnCtrlRightClickDraft = ref<boolean>(false);

const autostartMethods = [
    {
        value: "Registry" as AutostartType,
        name: "注册表",
        icon: "📝",
        desc: "写入注册表，简单可靠，无需管理员权限，推荐默认使用。",
        recommended: true,
    },
    {
        value: "TaskScheduler" as AutostartType,
        name: "任务计划",
        icon: "⏰",
        desc: "创建 Windows 任务计划，使用最高权限，兼容性好。",
    },
    {
        value: "Service" as AutostartType,
        name: "服务",
        icon: "🔧",
        desc: "安装为系统服务，需要管理员权限，适合极特殊场景。",
    },
];

const currentMethodDesc = computed(() => {
    const method = autostartMethods.find((m) => m.value === autostartMethodDraft.value);
    return method?.desc ?? "";
});

watchEffect(() => {
    followMouseDraft.value = followMouseOnShow.value;
    followMouseAnchorDraft.value = followMouseYAnchor.value;
    autostartEnabledDraft.value = autostartEnabled.value;
    autostartMethodDraft.value = autostartMethod.value || "Registry";
    ctrlDragDraft.value = ctrlDragEnabled.value;
    autoHideAfterLaunchDraft.value = autoHideAfterLaunch.value;
    cornerHotspotEnabledDraft.value = cornerHotspotEnabled.value;
    cornerHotspotPositionDraft.value = cornerHotspotPosition.value;
    cornerHotspotSensitivityDraft.value = cornerHotspotSensitivity.value;
    hideOnCtrlRightClickDraft.value = hideOnCtrlRightClick.value;
});

onMounted(async () => {
    settingsStore.refreshAutostartStatus();
});

async function onApplyFollowMouse() {
    await settingsStore.setFollowMouseOnShow(!!followMouseDraft.value);
}

async function onSetFollowMouseAnchor(anchor: "top" | "center" | "bottom") {
    followMouseAnchorDraft.value = anchor;
    await settingsStore.setFollowMouseYAnchor(anchor);
}

async function onAutostartEnabledChange() {
    await settingsStore.setAutostartEnabled(!!autostartEnabledDraft.value, autostartMethodDraft.value);
}

async function onSelectAutostartMethod(method: AutostartType) {
    autostartMethodDraft.value = method;
    if (autostartEnabledDraft.value) {
        await settingsStore.setAutostartEnabled(true, method);
    }
}

function onCtrlDragChange() {
    settingsStore.setCtrlDragEnabled(ctrlDragDraft.value);
}

function onAutoHideAfterLaunchChange() {
    settingsStore.setAutoHideAfterLaunch(autoHideAfterLaunchDraft.value);
}

async function onCornerHotspotChange() {
    settingsStore.setCornerHotspotEnabled(cornerHotspotEnabledDraft.value);
    await safeInvoke('set_corner_hotspot_config', {
        enabled: cornerHotspotEnabledDraft.value,
        position: cornerHotspotPositionDraft.value,
        sensitivity: cornerHotspotSensitivityDraft.value,
    });
}

async function onSetCornerPosition(position: string) {
    cornerHotspotPositionDraft.value = position;
    settingsStore.setCornerHotspotPosition(position as "top-left" | "top-right" | "bottom-left" | "bottom-right");
    await safeInvoke('set_corner_hotspot_config', {
        enabled: cornerHotspotEnabledDraft.value,
        position,
        sensitivity: cornerHotspotSensitivityDraft.value,
    });
}

async function onSetCornerSensitivity(sensitivity: string) {
    cornerHotspotSensitivityDraft.value = sensitivity;
    settingsStore.setCornerHotspotSensitivity(sensitivity as "low" | "medium" | "high");
    await safeInvoke('set_corner_hotspot_config', {
        enabled: cornerHotspotEnabledDraft.value,
        position: cornerHotspotPositionDraft.value,
        sensitivity,
    });
}

function onHideOnCtrlRightClickChange() {
    settingsStore.setHideOnCtrlRightClick(hideOnCtrlRightClickDraft.value);
}
</script>

<style scoped>
.window-settings {
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

.segmented {
    display: flex;
    gap: 8px;
    margin-top: 10px;
}

.segmented.disabled {
    opacity: 0.6;
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

.seg-btn:disabled {
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

.hint.error {
    color: var(--error-color);
}

.autostart-methods {
    margin-top: 12px;
    padding: 12px;
    background: var(--input-bg);
    border-radius: 12px;
    border: 1px solid var(--border-color);
}

.method-label {
    font-size: 12px;
    color: var(--text-hint);
    margin-bottom: 8px;
}

.method-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
}

.method-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 10px 8px;
    border-radius: 10px;
    border: 1px solid var(--border-color-strong);
    background: var(--card-bg);
    cursor: pointer;
    transition: all 0.15s ease;
}

.method-btn.active {
    border-color: var(--primary-color);
    background: var(--primary-bg);
}

.method-btn:hover:not(:disabled) {
    border-color: var(--primary-color);
}

.method-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.method-icon {
    font-size: 18px;
}

.method-name {
    font-size: 12px;
    color: var(--text-color);
}

.method-desc {
    margin-top: 10px;
    font-size: 12px;
    color: var(--text-hint);
    line-height: 1.5;
}

.sim-autostart-btn {
    margin-top: 10px;
    padding: 8px 12px;
    font-size: 12px;
    border: 1px dashed var(--border-color);
    border-radius: 8px;
    background: var(--card-bg);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s ease;
}

.sim-autostart-btn:hover {
    background: var(--hover-bg);
    border-color: var(--primary-color);
    color: var(--primary-color);
}

.corner-settings {
    margin-top: 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.setting-row {
    display: flex;
    align-items: center;
    gap: 12px;
}

.setting-label {
    font-size: 13px;
    color: var(--text-secondary);
    min-width: 60px;
}

.corner-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 6px;
    flex: 1;
}

.corner-btn {
    height: 32px;
    border-radius: 8px;
    border: 1px solid var(--border-color-strong);
    background: var(--input-bg);
    cursor: pointer;
    -webkit-app-region: no-drag;
    color: var(--text-color);
    font-size: 12px;
}

.corner-btn.active {
    border-color: var(--primary-color);
    background: var(--primary-bg);
}

.sensitivity-row {
    display: flex;
    gap: 6px;
    flex: 1;
}

.sens-btn {
    flex: 1;
    height: 32px;
    border-radius: 8px;
    border: 1px solid var(--border-color-strong);
    background: var(--input-bg);
    cursor: pointer;
    -webkit-app-region: no-drag;
    color: var(--text-color);
    font-size: 12px;
}

.sens-btn.active {
    border-color: var(--primary-color);
    background: var(--primary-bg);
}
</style>
