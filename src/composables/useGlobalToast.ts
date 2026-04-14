import { shallowRef } from "vue";

export type ToastType = "info" | "success" | "error";
export type ToastPosition = "top" | "top-left" | "top-right" | "bottom" | "bottom-left" | "bottom-right";

export interface ToastOptions {
    type?: ToastType;
    duration?: number;
    position?: ToastPosition;
}

export interface ToastItem {
    id: number;
    message: string;
    type: ToastType;
    position: ToastPosition;
    leaving?: boolean;
}

const toastQueue = shallowRef<ToastItem[]>([]);
let toastIdCounter = 0;
const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();

const LEAVE_DURATION = 200;

export function showToast(message: string, options?: ToastOptions) {
    const id = ++toastIdCounter;
    const toast: ToastItem = {
        id,
        message,
        type: options?.type || "info",
        position: options?.position || "bottom",
    };

    toastQueue.value = [...toastQueue.value, toast];

    const timer = setTimeout(() => {
        startLeaveAnimation(id);
    }, options?.duration ?? 3000);
    toastTimers.set(id, timer);
}

function startLeaveAnimation(id: number) {
    toastQueue.value = toastQueue.value.map((t) =>
        t.id === id ? { ...t, leaving: true } : t
    );

    setTimeout(() => {
        removeToast(id);
    }, LEAVE_DURATION);
}

export function removeToast(id: number) {
    const timer = toastTimers.get(id);
    if (timer) {
        clearTimeout(timer);
        toastTimers.delete(id);
    }
    toastQueue.value = toastQueue.value.filter((t) => t.id !== id);
}

export function clearAllToasts() {
    toastTimers.forEach((timer) => clearTimeout(timer));
    toastTimers.clear();
    toastQueue.value = [];
}

export function useGlobalToast() {
    return {
        toastQueue,
        showToast,
        removeToast,
        clearAllToasts,
    };
}
