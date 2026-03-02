<template>
    <div
        class="settings-view"
        data-menu-type="categorie-view"
        data-tauri-drag-region
    >
        <header class="settings-header" data-tauri-drag-region>
            <button
                class="back-btn"
                type="button"
                @click="onBack"
                @mousedown.stop
            >
                返回
            </button>
            <div class="title" data-tauri-drag-region>设置</div>
        </header>

        <div class="content">
            <div class="section">
                <div class="section-title">分类图标大小（每行数量）</div>
                <div class="segmented">
                    <button
                        class="seg-btn"
                        type="button"
                        :class="{ active: categoryCols === 4 }"
                        @click="onSetCategoryCols(4)"
                    >
                        4
                    </button>
                    <button
                        class="seg-btn"
                        type="button"
                        :class="{ active: categoryCols === 5 }"
                        @click="onSetCategoryCols(5)"
                    >
                        5
                    </button>
                </div>
            </div>

            <div class="section">
                <div class="section-title">启动项图标大小（每行数量）</div>
                <div class="segmented">
                    <button
                        class="seg-btn"
                        type="button"
                        :class="{ active: launcherCols === 4 }"
                        @click="onSetLauncherCols(4)"
                    >
                        4
                    </button>
                    <button
                        class="seg-btn"
                        type="button"
                        :class="{ active: launcherCols === 5 }"
                        @click="onSetLauncherCols(5)"
                    >
                        5
                    </button>
                    <button
                        class="seg-btn"
                        type="button"
                        :class="{ active: launcherCols === 6 }"
                        @click="onSetLauncherCols(6)"
                    >
                        6
                    </button>
                </div>
            </div>

            <div class="section">
                <div class="section-title">快捷键</div>
                <div class="row">
                    <input
                        v-model="shortcutDraft"
                        class="input"
                        type="text"
                        placeholder="点击后按下快捷键"
                        readonly
                        @focus="startRecording"
                        @click="startRecording"
                    />
                </div>
                <div class="hint">
                    {{
                        recording
                            ? "正在录制…按下组合键即可绑定（Esc 取消）"
                            : "点击输入框后按下组合键进行绑定"
                    }}
                </div>
            </div>

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
            </div>

            <div class="section">
                <div class="section-title">说明</div>
                <div class="note">启动台隐藏后可通过系统托盘左键唤醒窗口。</div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { storeToRefs } from "pinia";
import { onBeforeUnmount, ref, watchEffect } from "vue";
import { useRouter } from "vue-router";
import { Store } from "../stores";

const router = useRouter();
const store = Store();
const { categoryCols, launcherCols, toggleShortcut, followMouseOnShow, followMouseYAnchor } =
    storeToRefs(store);
const shortcutDraft = ref<string>("");
const followMouseDraft = ref<boolean>(false);
const followMouseAnchorDraft = ref<"top" | "center" | "bottom">("center");
const recording = ref<boolean>(false);

watchEffect(() => {
    shortcutDraft.value = toggleShortcut.value;
    followMouseDraft.value = followMouseOnShow.value;
    followMouseAnchorDraft.value = followMouseYAnchor.value;
});

/**
 * 返回主界面。
 */
function onBack() {
    router.push("/categories");
}

/**
 * 设置分类图标每行数量。
 */
function onSetCategoryCols(cols: number) {
    store.setCategoryCols(cols);
}

/**
 * 设置启动项图标每行数量。
 */
function onSetLauncherCols(cols: number) {
    store.setLauncherCols(cols);
}

function startRecording() {
    if (recording.value) return;
    recording.value = true;
}

async function onApplyFollowMouse() {
    await store.setFollowMouseOnShow(!!followMouseDraft.value);
}

async function onSetFollowMouseAnchor(anchor: "top" | "center" | "bottom") {
    followMouseAnchorDraft.value = anchor;
    await store.setFollowMouseYAnchor(anchor);
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
        recording.value = false;
        shortcutDraft.value = toggleShortcut.value;
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
    shortcutDraft.value = next;
    recording.value = false;
    await store.setToggleShortcut(next);
}

window.addEventListener("keydown", onRecordKeyDown, true);
onBeforeUnmount(() => {
    window.removeEventListener("keydown", onRecordKeyDown, true);
});
</script>

<style scoped>
.settings-view {
    width: 100vw;
    height: 100vh;
    display: flex;
    flex-direction: column;
    background: rgba(245, 246, 248, 1);
}

.settings-header {
    height: 52px;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 12px;
    background: rgba(255, 255, 255, 0.92);
    border-bottom: 1px solid rgba(0, 0, 0, 0.06);
    backdrop-filter: blur(10px);
}

.back-btn {
    border: 0;
    padding: 8px 10px;
    border-radius: 10px;
    background: rgba(0, 0, 0, 0.06);
    cursor: pointer;
    -webkit-app-region: no-drag;
}

.back-btn:hover {
    background: rgba(0, 0, 0, 0.1);
}

.title {
    font-size: 16px;
    font-weight: 700;
    color: #2b2b2b;
}

.content {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
}

.section {
    background: rgba(255, 255, 255, 0.92);
    border: 1px solid rgba(0, 0, 0, 0.06);
    border-radius: 16px;
    padding: 14px;
}

.section-title {
    font-size: 13px;
    font-weight: 700;
    color: rgba(0, 0, 0, 0.78);
    margin-bottom: 10px;
}

.segmented {
    display: flex;
    gap: 8px;
}

.segmented.disabled {
    opacity: 0.6;
}

.seg-btn {
    flex: 1;
    height: 34px;
    border-radius: 12px;
    border: 1px solid rgba(0, 0, 0, 0.12);
    background: rgba(255, 255, 255, 0.92);
    cursor: pointer;
    -webkit-app-region: no-drag;
}

.seg-btn.active {
    border-color: rgba(74, 116, 255, 0.9);
    background: rgba(74, 116, 255, 0.12);
}

.row {
    display: flex;
    gap: 10px;
    align-items: center;
}

.input {
    flex: 1;
    height: 34px;
    padding: 0 10px;
    border-radius: 12px;
    border: 1px solid rgba(0, 0, 0, 0.12);
    background: rgba(255, 255, 255, 0.92);
    outline: none;
    -webkit-app-region: no-drag;
}

.btn {
    height: 34px;
    padding: 0 14px;
    border-radius: 12px;
    border: 1px solid rgba(0, 0, 0, 0.12);
    background: rgba(255, 255, 255, 0.92);
    cursor: pointer;
    -webkit-app-region: no-drag;
    white-space: nowrap;
}

.btn:hover {
    background: rgba(0, 0, 0, 0.06);
}

.hint {
    margin-top: 8px;
    font-size: 12px;
    color: rgba(0, 0, 0, 0.56);
    -webkit-app-region: no-drag;
}

.check {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    color: rgba(0, 0, 0, 0.78);
    -webkit-app-region: no-drag;
}

.check input {
    width: 16px;
    height: 16px;
}

.note {
    font-size: 12px;
    color: rgba(0, 0, 0, 0.62);
    line-height: 1.5;
    -webkit-app-region: no-drag;
}
</style>

