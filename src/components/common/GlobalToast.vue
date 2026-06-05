<template>
    <Teleport to="body">
        <div class="toast-container">
            <div
                v-for="pos in POSITION_GROUPS"
                :key="pos"
                class="toast-group"
                :class="`group-${pos}`"
            >
                <TransitionGroup :name="`toast-${pos}`">
                    <div
                        v-for="toast in getToastsByPosition(pos)"
                        :key="toast.id"
                        class="global-toast"
                        :class="[toast.type, toast.position]"
                        @click="removeToast(toast.id)"
                    >
                        {{ toast.message }}
                    </div>
                </TransitionGroup>
            </div>
        </div>
    </Teleport>
</template>

<script setup lang="ts">
import { useGlobalToast, type ToastItem, type ToastPosition } from "../../composables/useGlobalToast";

const { toastQueue, removeToast } = useGlobalToast();

const POSITION_GROUPS: ToastPosition[] = [
    "top", "top-left", "top-right",
    "bottom", "bottom-left", "bottom-right",
];

function getToastsByPosition(position: ToastPosition): ToastItem[] {
    return toastQueue.value.filter((t) => t.position === position);
}
</script>

<style lang="scss" scoped>
.toast-container {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 9999;
    user-select: none;
}

.toast-group {
    position: fixed;
    display: flex;
    gap: 8px;
    pointer-events: none;
}

.group-top {
    top: 24px;
    left: 50%;
    transform: translateX(-50%);
    flex-direction: column;
    align-items: center;
}

.group-top-left {
    top: 24px;
    left: 24px;
    flex-direction: column;
    align-items: flex-start;
}

.group-top-right {
    top: 24px;
    right: 24px;
    flex-direction: column;
    align-items: flex-end;
}

.group-bottom {
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%);
    flex-direction: column-reverse;
    align-items: center;
}

.group-bottom-left {
    bottom: 24px;
    left: 24px;
    flex-direction: column-reverse;
    align-items: flex-start;
}

.group-bottom-right {
    bottom: 24px;
    right: 24px;
    flex-direction: column-reverse;
    align-items: flex-end;
}

.global-toast {
    padding: 10px 20px;
    border-radius: 12px;
    font-size: 14px;
    color: white;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
    pointer-events: auto;
    max-width: 320px;
    word-break: break-word;
    cursor: pointer;
    will-change: transform, opacity;
    transition: transform 0.3s ease;
}

.global-toast.info {
    background: var(--toast-info-bg, #81b0fd);
}

.global-toast.success {
    background: var(--toast-success-bg, #22c55e);
}

.global-toast.error {
    background: var(--toast-error-bg, #ef4444);
}

// Top animations
.toast-top-enter-active,
.toast-top-left-enter-active,
.toast-top-right-enter-active {
    transition: opacity 0.3s ease, transform 0.3s ease;
}

.toast-top-leave-active,
.toast-top-left-leave-active,
.toast-top-right-leave-active {
    transition: opacity 0.2s ease, transform 0.2s ease;
    position: absolute;
    left: 0;
}

.toast-top-enter-from,
.toast-top-left-enter-from,
.toast-top-right-enter-from {
    opacity: 0;
    transform: translateY(-20px);
}

.toast-top-leave-to,
.toast-top-left-leave-to,
.toast-top-right-leave-to {
    opacity: 0;
    transform: scale(0.9);
}

.group-top .toast-top-enter-from,
.group-top .toast-top-leave-to {
    transform: translateX(-50%) translateY(-20px);
}

.group-top .toast-top-leave-to {
    transform: translateX(-50%) scale(0.9);
}

// Bottom animations
.toast-bottom-enter-active,
.toast-bottom-left-enter-active,
.toast-bottom-right-enter-active {
    transition: opacity 0.3s ease, transform 0.3s ease;
}

.toast-bottom-leave-active,
.toast-bottom-left-leave-active,
.toast-bottom-right-leave-active {
    transition: opacity 0.2s ease, transform 0.2s ease;
    position: absolute;
    left: 0;
}

.toast-bottom-enter-from,
.toast-bottom-left-enter-from,
.toast-bottom-right-enter-from {
    opacity: 0;
    transform: translateY(20px);
}

.toast-bottom-leave-to,
.toast-bottom-left-leave-to,
.toast-bottom-right-leave-to {
    opacity: 0;
    transform: scale(0.9);
}

.group-bottom .toast-bottom-enter-from,
.group-bottom .toast-bottom-leave-to {
    transform: translateX(-50%) translateY(20px);
}

.group-bottom .toast-bottom-leave-to {
    transform: translateX(-50%) scale(0.9);
}


</style>
