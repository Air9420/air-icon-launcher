<template>
    <Teleport to="body">
        <div class="toast-container">
            <TransitionGroup name="toast">
                <div
                    v-for="toast in toastQueueWithOffset"
                    :key="toast.id"
                    class="global-toast"
                    :class="[toast.type, toast.position, { leaving: toast.leaving }]"
                    :style="toast.offsetStyle"
                    @click="removeToast(toast.id)"
                >
                    {{ toast.message }}
                </div>
            </TransitionGroup>
        </div>
    </Teleport>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useGlobalToast, type ToastItem } from "../../composables/useGlobalToast";

const { toastQueue, removeToast } = useGlobalToast();

const BASE_OFFSET = 24;
const OFFSET_STEP = 56;

const parsePixel = (value: string | undefined, fallback: number): number => {
    return parseInt(value || `${fallback}px`, 10);
};

function getBasePositionStyle(
    position: ToastItem["position"]
): Record<string, string> {
    const styles: Record<string, Record<string, string>> = {
        top: { top: "24px", left: "50%", transform: "translateX(-50%)" },
        "top-left": { top: "24px", left: "24px" },
        "top-right": { top: "24px", right: "24px" },
        bottom: { bottom: "80px", left: "50%", transform: "translateX(-50%)" },
        "bottom-left": { bottom: "24px", left: "24px" },
        "bottom-right": { bottom: "24px", right: "24px" },
    };
    return { ...styles[position] };
}

const toastQueueWithOffset = computed(() => {
    const groups: Record<string, ToastItem[]> = {};
    toastQueue.value.forEach((toast) => {
        const pos = toast.position;
        if (!groups[pos]) groups[pos] = [];
        groups[pos].push(toast);
    });

    const result: (ToastItem & { offsetStyle: Record<string, string> })[] = [];

    Object.entries(groups).forEach(([pos, toasts]) => {
        toasts.forEach((toast, index) => {
            const baseStyle = getBasePositionStyle(pos as ToastItem["position"]);
            const offset = index * OFFSET_STEP;

            if (pos.startsWith("top")) {
                baseStyle.top = `${parsePixel(baseStyle.top, BASE_OFFSET) + offset}px`;
            } else if (pos.startsWith("bottom")) {
                baseStyle.bottom = `${parsePixel(baseStyle.bottom, BASE_OFFSET) + offset}px`;
            }

            result.push({
                ...toast,
                offsetStyle: baseStyle,
            });
        });
    });

    return result;
});
</script>

<style lang="scss" scoped>
.toast-container {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 9999;
    user-select: none;
}

.global-toast {
    position: fixed;
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

@keyframes toastInTop {
    from {
        opacity: 0;
        transform: translateX(-50%) translateY(-20px);
    }
    to {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
    }
}

.global-toast.top {
    animation: toastInTop 0.3s ease forwards;
}

@keyframes toastInTopLeft {
    from {
        opacity: 0;
        transform: translateY(-20px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

.global-toast.top-left {
    animation: toastInTopLeft 0.3s ease forwards;
}

@keyframes toastInTopRight {
    from {
        opacity: 0;
        transform: translateY(-20px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

.global-toast.top-right {
    animation: toastInTopRight 0.3s ease forwards;
}

@keyframes toastInBottom {
    from {
        opacity: 0;
        transform: translateX(-50%) translateY(20px);
    }
    to {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
    }
}

.global-toast.bottom {
    animation: toastInBottom 0.3s ease forwards;
}

@keyframes toastInBottomLeft {
    from {
        opacity: 0;
        transform: translateY(20px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

.global-toast.bottom-left {
    animation: toastInBottomLeft 0.3s ease forwards;
}

@keyframes toastInBottomRight {
    from {
        opacity: 0;
        transform: translateY(20px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

.global-toast.bottom-right {
    animation: toastInBottomRight 0.3s ease forwards;
}

.global-toast.leaving {
    animation: toastLeave 0.2s ease forwards !important;
}

@keyframes toastLeave {
    to {
        opacity: 0;
        transform: scale(0.9);
    }
}

.global-toast.top.leaving {
    animation-name: toastLeaveTop !important;
}

@keyframes toastLeaveTop {
    to {
        opacity: 0;
        transform: translateX(-50%) scale(0.9);
    }
}

.global-toast.top-left.leaving,
.global-toast.top-right.leaving {
    animation-name: toastLeaveTopSide !important;
}

@keyframes toastLeaveTopSide {
    to {
        opacity: 0;
        transform: scale(0.9);
    }
}
</style>
