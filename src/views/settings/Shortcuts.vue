<template>
    <div class="shortcuts-settings">
        <div class="section">
            <div class="section-title">快捷键</div>
            <div class="shortcut-row">
                <span class="shortcut-label">主窗口</span>
                <input ref="mainInputRef" v-model="shortcutDraft" class="input shortcut-input"
                    :class="{ recording: recording && recordingTarget === 'main' }" type="text" placeholder="点击后按下快捷键"
                    readonly @focus="startRecording('main')" @blur="onInputBlur('main')"
                    @click="startRecording('main')" />
            </div>
            <div class="hint">显示或隐藏启动器主界面</div>
            <div class="shortcut-row">
                <span class="shortcut-label">剪贴板</span>
                <input ref="clipboardInputRef" v-model="clipboardShortcutDraft" class="input shortcut-input"
                    :class="{ recording: recording && recordingTarget === 'clipboard' }" type="text"
                    placeholder="点击后按下快捷键" readonly @focus="startRecording('clipboard')"
                    @blur="onInputBlur('clipboard')" @click="startRecording('clipboard')" />
            </div>
            <div class="hint">快速打开剪贴板历史面板</div>
            <div class="shortcut-row">
                <span class="shortcut-label">投影切换</span>
                <input ref="displayInputRef" v-model="displayShortcutDraft" class="input shortcut-input"
                    :class="{ recording: recording && recordingTarget === 'display' }" type="text"
                    placeholder="点击后按下快捷键" readonly @focus="startRecording('display')" @blur="onInputBlur('display')"
                    @click="startRecording('display')" />
            </div>
            <div class="hint">
                在「仅电脑屏幕」和「扩展」模式之间快速切换（仅在多屏幕环境下可用）
            </div>
            <div class="hint">
                {{
                    recording
                        ? "正在录制…按下组合键即可绑定（Esc 取消）"
                        : "点击输入框后按下组合键进行绑定"
                }}
            </div>
            <div v-if="shortcutError" class="hint error">
                {{ shortcutError }}
            </div>
        </div>

        <div class="section">
            <div class="shortcut-row">
                <span class="shortcut-label">
                    <Infinite size="16" weight="Bold" /> 强力模式
                </span>
                <label class="toggle-switch">
                    <input type="checkbox" :checked="strongShortcutMode" @change="onStrongShortcutModeChange" />
                    <span class="toggle-slider"></span>
                </label>
            </div>
            <div class="hint">
                强力模式使用低级键盘钩子，可抢占其他应用的热键（如 WPS/Office）。可能影响游戏、远程桌面等场景。
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { storeToRefs } from "pinia";
import { onBeforeUnmount, ref, watchEffect } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { invokeOrThrow } from "../../utils/invoke-wrapper";
import { useSettingsStore } from "../../stores";
import { Infinite } from "@solar-icons/vue";

const settingsStore = useSettingsStore();
const {
    toggleShortcut,
    clipboardShortcut,
    displayShortcut,
    strongShortcutMode,
} = storeToRefs(settingsStore);

const shortcutDraft = ref<string>("");
const clipboardShortcutDraft = ref<string>("");
const displayShortcutDraft = ref<string>("");
const recording = ref<boolean>(false);
const recordingTarget = ref<"main" | "clipboard" | "display">("main");
const suspendedMainShortcut = ref<string>("");
const shortcutError = ref<string>("");
const mainInputRef = ref<HTMLInputElement | null>(null);
const clipboardInputRef = ref<HTMLInputElement | null>(null);
const displayInputRef = ref<HTMLInputElement | null>(null);

watchEffect(() => {
    shortcutDraft.value = toggleShortcut.value;
    clipboardShortcutDraft.value = clipboardShortcut.value;
    displayShortcutDraft.value = displayShortcut.value;
});

function startRecording(target: "main" | "clipboard" | "display") {
    if (recording.value) return;
    recording.value = true;
    recordingTarget.value = target;
    shortcutError.value = "";
    if (target === "main") {
        invoke<string>("suspend_toggle_shortcut")
            .then((s) => {
                suspendedMainShortcut.value = s || "";
            })
            .catch(() => {
                suspendedMainShortcut.value = "";
            });
    }
}

async function cancelRecording() {
    if (!recording.value) return;
    recording.value = false;
    shortcutDraft.value = toggleShortcut.value;
    clipboardShortcutDraft.value = clipboardShortcut.value;
    displayShortcutDraft.value = displayShortcut.value;
    shortcutError.value = "";
    if (recordingTarget.value === "main" && suspendedMainShortcut.value) {
        try {
            await invokeOrThrow("resume_toggle_shortcut", { shortcut: suspendedMainShortcut.value });
        } finally {
            suspendedMainShortcut.value = "";
        }
    }
}

async function onInputBlur(target: "main" | "clipboard" | "display") {
    if (recording.value && recordingTarget.value === target) {
        await cancelRecording();
    }
}

function isModifierKey(key: string) {
    return (
        key === "Shift" || key === "Control" || key === "Alt" || key === "Meta"
    );
}

function normalizeKey(key: string) {
    if (key === " ") return "space";
    if (key === "Escape") return "esc";
    return key.toLowerCase();
}

async function onRecordKeyDown(ev: KeyboardEvent) {
    if (!recording.value) return;
    ev.preventDefault();
    ev.stopPropagation();

    if (ev.key === "Escape") {
        await cancelRecording();
        return;
    }

    if (isModifierKey(ev.key)) return;

    const parts: string[] = [];
    if (ev.ctrlKey) parts.push("ctrl");
    if (ev.altKey) parts.push("alt");
    if (ev.shiftKey) parts.push("shift");
    if (ev.metaKey) parts.push("meta");
    parts.push(normalizeKey(ev.key));

    const next = parts.join("+");
    recording.value = false;
    shortcutError.value = "";

    if (recordingTarget.value === "main") {
        if (next === clipboardShortcut.value || next === displayShortcut.value) {
            shortcutError.value = "主窗口快捷键不能与其他快捷键相同";
            shortcutDraft.value = toggleShortcut.value;
            if (suspendedMainShortcut.value) {
                try {
                    await invokeOrThrow("resume_toggle_shortcut", { shortcut: suspendedMainShortcut.value });
                } finally {
                    suspendedMainShortcut.value = "";
                }
            }
            return;
        }
        shortcutDraft.value = next;
        if (suspendedMainShortcut.value && next === suspendedMainShortcut.value) {
            try {
                await invokeOrThrow("resume_toggle_shortcut", { shortcut: suspendedMainShortcut.value });
            } finally {
                suspendedMainShortcut.value = "";
            }
            return;
        }
        try {
            await settingsStore.setToggleShortcut(next);
            suspendedMainShortcut.value = "";
        } catch (e: unknown) {
            shortcutError.value = typeof e === "string" ? e : e instanceof Error ? e.message || "设置失败" : "设置失败";
            shortcutDraft.value = toggleShortcut.value;
            if (suspendedMainShortcut.value) {
                try {
                    await invokeOrThrow("resume_toggle_shortcut", { shortcut: suspendedMainShortcut.value });
                } finally {
                    suspendedMainShortcut.value = "";
                }
            }
        }
    } else if (recordingTarget.value === "clipboard") {
        if (next === toggleShortcut.value || next === displayShortcut.value) {
            shortcutError.value = "剪贴板快捷键不能与其他快捷键相同";
            clipboardShortcutDraft.value = clipboardShortcut.value;
            return;
        }
        clipboardShortcutDraft.value = next;
        try {
            await settingsStore.setClipboardShortcut(next);
        } catch (e: unknown) {
            shortcutError.value = typeof e === "string" ? e : e instanceof Error ? e.message || "设置失败" : "设置失败";
            clipboardShortcutDraft.value = clipboardShortcut.value;
        }
    } else if (recordingTarget.value === "display") {
        if (next === toggleShortcut.value || next === clipboardShortcut.value) {
            shortcutError.value = "投影切换快捷键不能与其他快捷键相同";
            displayShortcutDraft.value = displayShortcut.value;
            return;
        }
        displayShortcutDraft.value = next;
        try {
            await settingsStore.setDisplayShortcut(next);
        } catch (e: unknown) {
            shortcutError.value = typeof e === "string" ? e : e instanceof Error ? e.message || "设置失败" : "设置失败";
            displayShortcutDraft.value = displayShortcut.value;
        }
    }
}

async function onStrongShortcutModeChange(e: Event) {
    const target = e.target as HTMLInputElement;
    try {
        await settingsStore.setStrongShortcutMode(target.checked);
    } catch (err) {
        console.error(err);
    }
}

window.addEventListener("keydown", onRecordKeyDown, true);
onBeforeUnmount(() => {
    window.removeEventListener("keydown", onRecordKeyDown, true);
});
</script>

<style lang="scss" scoped>
@use "../../styles/settings/section" as settings;

.shortcuts-settings {
    @include settings.page-stack();
}

.section {
    @include settings.section-card();
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.section-title {
    @include settings.section-title();
}

.shortcut-row {
    @include settings.inline-row();
}

.shortcut-row:last-child {
    margin-bottom: 0;
}

.shortcut-label {
    @include settings.row-label(60px);
    display: flex;
    align-items: center;
    gap: 4px;
}

.shortcut-input {
    flex: 1;
}

.input {
    @include settings.input-control();
}

.input.recording {
    border-color: var(--primary-color);
    box-shadow: 0 0 0 2px var(--primary-bg);
}

.hint {
    @include settings.hint();
}

.hint.error {
    color: var(--error-color);
}

.toggle-switch {
    position: relative;
    display: inline-block;
    width: 44px;
    height: 24px;
}

.toggle-switch input {
    opacity: 0;
    width: 0;
    height: 0;
}

.toggle-slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: var(--border-color-strong);
    transition: 0.2s;
    border-radius: 24px;
}

.toggle-slider:before {
    position: absolute;
    content: "";
    height: 18px;
    width: 18px;
    left: 3px;
    bottom: 3px;
    background-color: white;
    transition: 0.2s;
    border-radius: 50%;
}

.toggle-switch input:checked+.toggle-slider {
    background-color: var(--primary-color);
}

.toggle-switch input:checked+.toggle-slider:before {
    transform: translateX(20px);
}
</style>
