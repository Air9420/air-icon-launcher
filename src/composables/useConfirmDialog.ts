import { ref } from "vue";

export interface ConfirmOptions {
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
}

export interface ConfirmState extends ConfirmOptions {
    visible: boolean;
    resolve: ((value: boolean) => void) | null;
}

const state = ref<ConfirmState>({
    visible: false,
    title: "",
    message: "",
    confirmText: "确认",
    cancelText: "取消",
    resolve: null,
});

async function confirm(options: ConfirmOptions): Promise<boolean> {
    state.value = {
        visible: true,
        title: options.title,
        message: options.message,
        confirmText: options.confirmText || "确认",
        cancelText: options.cancelText || "取消",
        resolve: null,
    };

    return new Promise((resolve) => {
        state.value.resolve = resolve;
    });
}

function handleConfirm() {
    state.value.resolve?.(true);
    state.value.visible = false;
}

function handleCancel() {
    state.value.resolve?.(false);
    state.value.visible = false;
}

export function useConfirmDialog() {
    return {
        state,
        confirm,
        handleConfirm,
        handleCancel,
    };
}

export type ConfirmDialogComposable = ReturnType<typeof useConfirmDialog>;
