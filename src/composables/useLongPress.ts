import { ref } from "vue";

export interface UseLongPressOptions {
    onLongPressStart?: (e: MouseEvent | TouchEvent) => void;
    onLongPressEnd?: (e: MouseEvent | TouchEvent) => void;
    onLongPress?: (e: MouseEvent | TouchEvent) => void;
    threshold?: number;
}

export function useLongPress(options: UseLongPressOptions) {
    const {
        onLongPressStart,
        onLongPressEnd,
        onLongPress,
        threshold = 500,
    } = options;

    const isPressed = ref(false);
    let timer: ReturnType<typeof setTimeout> | null = null;

    function clearTimer() {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    }

    function handlePointerDown(e: MouseEvent | TouchEvent) {
        isPressed.value = true;
        onLongPressStart?.(e);

        timer = setTimeout(() => {
            onLongPress?.(e);
            clearTimer();
        }, threshold);
    }

    function handlePointerUp(e: MouseEvent | TouchEvent) {
        if (isPressed.value) {
            onLongPressEnd?.(e);
        }
        isPressed.value = false;
        clearTimer();
    }

    function handlePointerLeave(e: MouseEvent | TouchEvent) {
        if (isPressed.value) {
            onLongPressEnd?.(e);
        }
        isPressed.value = false;
        clearTimer();
    }

    function handlePointerCancel(e: MouseEvent | TouchEvent) {
        if (isPressed.value) {
            onLongPressEnd?.(e);
        }
        isPressed.value = false;
        clearTimer();
    }

    return {
        isPressed,
        handlers: {
            onPointerDown: handlePointerDown,
            onPointerUp: handlePointerUp,
            onPointerLeave: handlePointerLeave,
            onPointerCancel: handlePointerCancel,
        },
    };
}

export type LongPressComposable = ReturnType<typeof useLongPress>;
