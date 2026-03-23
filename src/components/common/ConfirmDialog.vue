<template>
    <div v-if="visible" class="confirm-overlay" @click.self="onCancel">
        <div class="confirm-dialog">
            <div class="confirm-title">{{ title }}</div>
            <div class="confirm-message">{{ message }}</div>
            <div class="confirm-actions">
                <button class="confirm-btn cancel" type="button" @click="onCancel">
                    {{ cancelText }}
                </button>
                <button class="confirm-btn confirm" type="button" @click="onConfirm">
                    {{ confirmText }}
                </button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
defineProps<{
    visible: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
}>();

const emit = defineEmits<{
    (e: "confirm"): void;
    (e: "cancel"): void;
}>();

function onConfirm() {
    emit("confirm");
}

function onCancel() {
    emit("cancel");
}
</script>

<style lang="scss" scoped>
.confirm-overlay {
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

.confirm-dialog {
    background: var(--card-bg-solid);
    border-radius: 12px;
    padding: 20px;
    min-width: 300px;
    max-width: 400px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.confirm-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-color);
    margin-bottom: 12px;
}

.confirm-message {
    font-size: 14px;
    color: var(--text-color-secondary);
    line-height: 1.5;
    margin-bottom: 20px;
}

.confirm-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
}

.confirm-btn {
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
        background: var(--error-color, #e53935);
        color: white;

        &:hover {
            opacity: 0.9;
        }
    }
}
</style>
