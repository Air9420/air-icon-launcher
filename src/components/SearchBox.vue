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
            @keydown.up="onNavUp"
            @keydown.down="onNavDown"
            @keydown.enter="onNavEnter"
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
    (e: "nav", direction: "up" | "down" | "enter"): void;
}>();

const inputRef = ref<HTMLInputElement | null>(null);

function onInput(event: Event) {
    const target = event.target as HTMLInputElement;
    emit("update:modelValue", target.value);
}

function onClear() {
    emit("update:modelValue", "");
}

function onNavUp(e: Event) {
    e.stopPropagation();
    emit("nav", "up");
}

function onNavDown(e: Event) {
    e.stopPropagation();
    emit("nav", "down");
}

function onNavEnter(e: Event) {
    e.stopPropagation();
    emit("nav", "enter");
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
    background: var(--input-bg);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    box-shadow: var(--card-shadow);
    transition: box-shadow 0.2s ease, border-color 0.2s ease, background 0.2s ease;

    &:focus-within {
        border-color: var(--primary-color);
        box-shadow: 0 0 0 1px color-mix(in srgb, var(--primary-color) 40%, transparent);
    }
}

.search-icon {
    width: 18px;
    height: 18px;
    color: var(--text-hint);
    flex-shrink: 0;
}

.search-input {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    font-size: 14px;
    color: var(--text-color);
    min-width: 0;

    &::placeholder {
        color: var(--text-hint);
    }
}

.clear-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: none;
    background: var(--hover-bg);
    border-radius: 50%;
    cursor: pointer;
    transition: background 0.15s ease;

    svg {
        width: 12px;
        height: 12px;
        color: var(--text-secondary);
    }

    &:hover {
        background: var(--hover-bg-strong);
    }
}
</style>
