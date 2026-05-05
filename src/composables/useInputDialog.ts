import { ref } from "vue";
import type { InputOptions } from "./useInputDialog.types";

export interface InputResult {
    values: string[];
}

const state = ref({
    visible: false,
    title: "",
    message: "",
    confirmText: "确认",
    cancelText: "取消",
    defaultValue: "",
    placeholder: "",
    inputType: "text",
    secondInputLabel: "",
    secondInputPlaceholder: "",
    secondInputType: "text",
    secondDefaultValue: "",
    selectOptions: [] as string[],
    resolve: null as ((value: string[] | null) => void) | null,
});

const inputValues = ref<string[]>([]);

export function useInputDialog() {
    async function input(options: InputOptions): Promise<string[] | null> {
        state.value = {
            visible: true,
            title: options.title,
            message: options.message,
            confirmText: options.confirmText || "确认",
            cancelText: options.cancelText || "取消",
            defaultValue: options.defaultValue || "",
            placeholder: options.placeholder || "",
            inputType: options.inputType || "text",
            secondInputLabel: options.secondInputLabel || "",
            secondInputPlaceholder: options.secondInputPlaceholder || "",
            secondInputType: options.secondInputType || "text",
            secondDefaultValue: options.secondDefaultValue || "",
            selectOptions: options.selectOptions || [],
            resolve: null,
        };
        inputValues.value = [options.defaultValue || "", options.secondDefaultValue || ""];

        return new Promise((resolve) => {
            state.value.resolve = resolve;
        });
    }

    function handleConfirm(values: string[]) {
        state.value.resolve?.(values);
        state.value.visible = false;
    }

    function handleCancel() {
        state.value.resolve?.(null);
        state.value.visible = false;
    }

    return {
        state,
        input,
        handleConfirm,
        handleCancel,
    };
}
