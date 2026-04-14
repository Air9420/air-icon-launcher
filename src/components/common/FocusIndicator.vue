<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";

const isFocused = ref(false);

let unlistenFocus: (() => void) | null = null;
let unlistenCornerHotspotShown: (() => void) | null = null;

async function initialize() {
    const win = getCurrentWindow();

    isFocused.value = await win.isFocused();

    unlistenFocus = await win.onFocusChanged(({ payload: focused }) => {
        isFocused.value = focused;
    });

    unlistenCornerHotspotShown = await listen("corner-hotspot-shown", async () => {
        isFocused.value = await win.isFocused();
    });
}

async function checkFocus() {
    const win = getCurrentWindow();
    isFocused.value = await win.isFocused();
}

function cleanup() {
    if (unlistenFocus) {
        unlistenFocus();
        unlistenFocus = null;
    }
    if (unlistenCornerHotspotShown) {
        unlistenCornerHotspotShown();
        unlistenCornerHotspotShown = null;
    }
}

onMounted(initialize);
onUnmounted(cleanup);

defineExpose({
    isFocused,
    checkFocus,
});
</script>

<template>
    <div class="focus-indicator" :class="{ focused: isFocused }"></div>
</template>

<style scoped>
.focus-indicator {
    position: fixed;
    top: 4px;
    left: 4px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #ff4444;
    box-shadow: 0 0 6px rgba(255, 68, 68, 0.6);
    transition: background 0.2s ease, box-shadow 0.2s ease;
    z-index: 9999;
    pointer-events: none;

    &.focused {
        background: #44ff44;
        box-shadow: 0 0 6px rgba(68, 255, 68, 0.6);
    }
}
</style>