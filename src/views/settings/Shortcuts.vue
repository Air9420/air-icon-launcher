<template>
    <div class="shortcuts-settings">
        <div class="section">
            <div class="section-title">快捷键</div>
            <div class="shortcut-row">
                <span class="shortcut-label">主窗口</span>
                <input
                    ref="mainInputRef"
                    v-model="shortcutDraft"
                    class="input shortcut-input"
                    :class="{ recording: recording && recordingTarget === 'main' }"
                    type="text"
                    placeholder="点击后按下快捷键"
                    readonly
                    @focus="startRecording('main')"
                    @blur="onInputBlur('main')"
                    @click="startRecording('main')"
                />
            </div>
            <div class="shortcut-row">
                <span class="shortcut-label">剪贴板</span>
                <input
                    ref="clipboardInputRef"
                    v-model="clipboardShortcutDraft"
                    class="input shortcut-input"
                    :class="{ recording: recording && recordingTarget === 'clipboard' }"
                    type="text"
                    placeholder="点击后按下快捷键"
                    readonly
                    @focus="startRecording('clipboard')"
                    @blur="onInputBlur('clipboard')"
                    @click="startRecording('clipboard')"
                />
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
                <span class="shortcut-label">⚡ 强力模式</span>
                <label class="toggle-switch">
                    <input
                        type="checkbox"
                        :checked="strongShortcutMode"
                        @change="onStrongShortcutModeChange"
                    />
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

const settingsStore = useSettingsStore();
const {
    toggleShortcut,
    clipboardShortcut,
    strongShortcutMode,
} = storeToRefs(settingsStore);

const shortcutDraft = ref<string>("");
const clipboardShortcutDraft = ref<string>("");
const recording = ref<boolean>(false);
const recordingTarget = ref<"main" | "clipboard">("main");
const suspendedMainShortcut = ref<string>("");
const shortcutError = ref<string>("");
const mainInputRef = ref<HTMLInputElement | null>(null);
const clipboardInputRef = ref<HTMLInputElement | null>(null);

watchEffect(() => {
    shortcutDraft.value = toggleShortcut.value;
    clipboardShortcutDraft.value = clipboardShortcut.value;
});

function startRecording(target: "main" | "clipboard") {
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
    shortcutError.value = "";
    if (recordingTarget.value === "main" && suspendedMainShortcut.value) {
        try {
            await invokeOrThrow("resume_toggle_shortcut", { shortcut: suspendedMainShortcut.value });
        } finally {
            suspendedMainShortcut.value = "";
        }
    }
}

async function onInputBlur(target: "main" | "clipboard") {
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
        if (next === clipboardShortcut.value) {
            shortcutError.value = "主窗口快捷键不能与剪贴板快捷键相同";
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
    } else {
        if (next === toggleShortcut.value) {
            shortcutError.value = "剪贴板快捷键不能与主窗口快捷键相同";
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

<style scoped>
.shortcuts-settings {
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

.shortcut-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 8px;
}

.shortcut-row:last-child {
    margin-bottom: 0;
}

.shortcut-label {
    font-size: 13px;
    color: var(--text-secondary);
    min-width: 60px;
}

.shortcut-input {
    flex: 1;
}

.input {
    flex: 1;
    height: 34px;
    padding: 0 10px;
    border-radius: 12px;
    border: 1px solid var(--border-color-strong);
    background: var(--input-bg);
    outline: none;
    -webkit-app-region: no-drag;
    color: var(--text-color);
}

.input.recording {
    border-color: var(--primary-color);
    box-shadow: 0 0 0 2px var(--primary-bg);
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

.toggle-switch input:checked + .toggle-slider {
    background-color: var(--primary-color);
}

.toggle-switch input:checked + .toggle-slider:before {
    transform: translateX(20px);
}
</style>
