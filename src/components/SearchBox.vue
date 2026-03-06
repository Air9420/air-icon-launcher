<template>
    <div class="search-box" :class="{ 'has-value': !!modelValue }">
        <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
        </svg>
        <input
            ref="inputRef"
            type="text"
            class="search-input"
            :value="modelValue"
            :placeholder="placeholder"
            @input="onInput"
            @keydown.escape="onClear"
        />
        <button
            v-show="modelValue"
            class="clear-btn"
            type="button"
            @click="onClear"
        >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
            </svg>
        </button>
    </div>
</template>

<script setup lang="ts">
import { ref } from "vue";

defineProps<{
    modelValue: string;
    placeholder?: string;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: string): void;
}>();

const inputRef = ref<HTMLInputElement | null>(null);

function onInput(event: Event) {
    const target = event.target as HTMLInputElement;
    emit("update:modelValue", target.value);
}

function onClear() {
    emit("update:modelValue", "");
}

function focus() {
    inputRef.value?.focus();
}

defineExpose({
    focus,
});
</script>

<style lang="scss" scoped>
.search-box {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: rgba(255, 255, 255, 0.92);
    border-radius: 12px;
    box-shadow: 0 0 10px rgba(0, 0, 0, 0.12);
    transition: box-shadow 0.2s ease;

    &:focus-within {
        box-shadow: 0 0 14px rgba(0, 0, 0, 0.2);
    }
}

.search-icon {
    width: 18px;
    height: 18px;
    color: #888;
    flex-shrink: 0;
}

.search-input {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    font-size: 14px;
    color: #333;
    min-width: 0;

    &::placeholder {
        color: #aaa;
    }
}

.clear-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    background: rgba(0, 0, 0, 0.08);
    border-radius: 50%;
    cursor: pointer;
    transition: background 0.15s ease;

    svg {
        width: 12px;
        height: 12px;
        color: #666;
    }

    &:hover {
        background: rgba(0, 0, 0, 0.15);
    }
}
</style>
