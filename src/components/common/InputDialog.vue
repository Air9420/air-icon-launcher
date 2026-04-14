<template>
    <div v-if="visible" class="input-overlay" @click.self="onCancel">
        <div class="input-dialog">
            <div class="input-title">{{ title }}</div>
            <div class="input-message">{{ message }}</div>
            <div class="input-field">
                <input
                    ref="inputRef"
                    v-model="localInputValue"
                    :type="inputType"
                    :placeholder="placeholder"
                    class="input"
                    @keyup.enter="onConfirm"
                    @keyup.escape="onCancel"
                />
            </div>
            <div v-if="secondInputLabel" class="input-field">
                <input
                    v-model="localSecondInputValue"
                    :type="secondInputType"
                    :placeholder="secondInputPlaceholder"
                    class="input"
                    @keyup.enter="onConfirm"
                    @keyup.escape="onCancel"
                />
            </div>
            <div class="input-actions">
                <button class="input-btn cancel" type="button" @click="onCancel">
                    {{ cancelText }}
                </button>
                <button class="input-btn confirm" type="button" @click="onConfirm">
                    {{ confirmText }}
                </button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from "vue";

interface InputOptions {
    visible: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    defaultValue?: string;
    placeholder?: string;
    inputType?: string;
    secondInputLabel?: string;
    secondInputPlaceholder?: string;
    secondInputType?: string;
    secondDefaultValue?: string;
}

const props = withDefaults(defineProps<InputOptions>(), {
    confirmText: "确认",
    cancelText: "取消",
    defaultValue: "",
    placeholder: "",
    inputType: "text",
    secondInputLabel: "",
    secondInputPlaceholder: "",
    secondInputType: "text",
    secondDefaultValue: "",
});

const emit = defineEmits<{
    (e: "confirm", values: string[]): void;
    (e: "cancel"): void;
}>();

const inputRef = ref<HTMLInputElement | null>(null);
const localInputValue = ref("");
const localSecondInputValue = ref("");

watch(() => props.defaultValue, (val) => {
    localInputValue.value = val || "";
}, { immediate: true });

watch(() => props.secondDefaultValue, (val) => {
    localSecondInputValue.value = val || "";
}, { immediate: true });

watch(() => props.visible, async (isVisible) => {
    if (isVisible) {
        localInputValue.value = props.defaultValue || "";
        localSecondInputValue.value = props.secondDefaultValue || "";
        await nextTick();
        inputRef.value?.focus();
    }
});

function onConfirm() {
    emit("confirm", [localInputValue.value, localSecondInputValue.value]);
}

function onCancel() {
    emit("cancel");
}
</script>

<style lang="scss" scoped>
.input-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
}

.input-dialog {
    background: var(--card-bg-solid);
    border-radius: 12px;
    padding: 20px;
    min-width: 320px;
    max-width: 420px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.input-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-color);
    margin-bottom: 8px;
}

.input-message {
    font-size: 14px;
    color: var(--text-color-secondary);
    line-height: 1.5;
    margin-bottom: 16px;
}

.input-field {
    margin-bottom: 12px;
}

.input-field .field-label {
    font-size: 12px;
    color: var(--text-tertiary);
    margin-bottom: 6px;
}

.input {
    width: 100%;
    height: 40px;
    padding: 0 12px;
    border-radius: 10px;
    border: 1px solid var(--border-color-strong);
    background: var(--input-bg);
    outline: none;
    color: var(--text-color);
    font-size: 14px;
    box-sizing: border-box;

    &:focus {
        border-color: var(--primary-color);
    }

    &::placeholder {
        color: var(--text-tertiary);
    }
}

.input-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 16px;
}

.input-btn {
    padding: 8px 16px;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;

    &.cancel {
        background: var(--hover-bg);
        color: var(--text-color);

        &:hover {
            background: var(--hover-bg-strong);
        }
    }

    &.confirm {
        background: var(--primary-color);
        color: white;

        &:hover {
            opacity: 0.9;
        }
    }
}
</style>
