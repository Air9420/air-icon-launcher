<template>
    <div
        class="icon-item"
        :class="{
            'is-pinned': pinned,
            'is-selected': selected,
            'is-keyboard-focus': keyboardFocus,
        }"
        data-menu-type="Icon-Item"
        :data-category-id="categoryId"
        :data-item-id="item.id"
        :data-item-path="item.path || ''"
        @mousedown="$emit('mousedown', item.id, $event)"
        @pointerdown="$emit('pointerdown', item.id, $event)"
        @pointerup="$emit('pointerup', item.id, $event)"
        @pointerleave="$emit('pointerleave')"
        @pointercancel="$emit('pointerleave')"
    >
        <div class="icon-img">
            <img
                v-if="item.iconBase64"
                class="icon-real"
                :src="getIconSrc(item.iconBase64)"
                alt=""
                draggable="false"
            />
            <div v-else class="icon-fallback">
                {{ getFallbackText(item.name) }}
            </div>
        </div>
        <div v-if="badgeText" class="url-badge">
            {{ badgeText }}
        </div>
        <div v-if="pinned" class="pinned-badge">📌</div>
        <div v-if="!hideName" class="icon-name" :title="item.name">
            {{ item.name }}
        </div>
        <div v-if="launchStatus === 'launching'" class="launch-status launching">
            <span class="spinner"></span>
        </div>
        <div v-if="launchStatus === 'success'" class="launch-status success">
            <span class="check-icon">✓</span>
        </div>
    </div>
</template>

<script setup lang="ts">
import type { LauncherItem } from "../../stores/launcherStore";
import { getLauncherItemBadgeText } from "../../utils/scanned-app-launch";

const props = defineProps<{
    item: LauncherItem;
    categoryId: string;
    pinned: boolean;
    selected: boolean;
    keyboardFocus: boolean;
    hideName: boolean;
    launchStatus?: "launching" | "success";
}>();

defineEmits<{
    (e: "mousedown", itemId: string, event: MouseEvent): void;
    (e: "pointerdown", itemId: string, event: PointerEvent): void;
    (e: "pointerup", itemId: string, event: PointerEvent): void;
    (e: "pointerleave"): void;
}>();

const badgeText = getLauncherItemBadgeText({
    itemType: props.item.itemType,
    url: props.item.url,
    launchDependencies: props.item.launchDependencies,
});

function getIconSrc(iconBase64: string) {
    if (iconBase64.startsWith("data:")) return iconBase64;
    return `data:image/png;base64,${iconBase64}`;
}

function getFallbackText(name: string) {
    const text = name.trim();
    if (!text) return "?";
    return text.slice(0, 1).toUpperCase();
}
</script>

<style lang="scss" scoped>
.icon-item {
    padding: min(8px, 5%);
    border-radius: 18px;
    border: 2px solid transparent;
    background: var(--card-bg);
    box-shadow: var(--card-shadow);
    user-select: none;
    opacity: 0.92;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-evenly;
    aspect-ratio: 1 / 1;
    position: relative;
}

.icon-item.is-pinned {
    border: 2px dashed color-mix(in srgb, var(--primary-color) 70%, transparent);
    background: color-mix(in srgb, var(--primary-color) 8%, var(--card-bg));
    opacity: 1;
}

.icon-item.is-selected {
    opacity: 1;
    border-style: solid;
    border-color: var(--success-color, #22c55e);
    background: color-mix(in srgb, var(--success-color, #22c55e) 12%, var(--card-bg));
}

.icon-item.is-keyboard-focus {
    opacity: 1;
    border-style: solid;
    border-color: var(--primary-color);
    box-shadow: 0 0 0 2px var(--primary-color, #0078d4), var(--card-shadow);
}

.icon-item.is-pinned.is-selected {
    border-style: solid;
}

.icon-img {
    width: 50%;
    aspect-ratio: 1 / 1;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
}

.pinned-badge {
    position: absolute;
    top: 5px;
    right: 5px;
    font-size: 12px;
    line-height: 1;
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.3));
}

.url-badge {
    position: absolute;
    top: 8px;
    left: 8px;
    padding: 1px 4px;
    font-size: 8px;
    font-weight: 600;
    color: #fff;
    background: #3b82f6;
    border-radius: 4px;
    z-index: 1;
}

.icon-real {
    width: 100%;
    height: 100%;
    object-fit: contain;
}

.icon-fallback {
    width: 100%;
    height: 100%;
    border-radius: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--icon-fallback-bg);
    font-weight: 800;
    color: var(--icon-fallback-text);
}

.icon-name {
    width: 100%;
    text-align: center;
    font-size: 12px;
    color: var(--icon-name-color);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}

.launch-status {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 18px;
    background: color-mix(in srgb, var(--bg-color) 55%, transparent);
    pointer-events: none;
}

.launch-status.success .check-icon {
    color: var(--success-color, #22c55e);
    font-size: 28px;
    font-weight: 700;
}

.spinner {
    width: 22px;
    height: 22px;
    border: 2px solid color-mix(in srgb, var(--primary-color) 30%, transparent);
    border-top-color: var(--primary-color);
    border-radius: 50%;
    animation: cat-spin 0.8s linear infinite;
}

@keyframes cat-spin {
    to {
        transform: rotate(360deg);
    }
}
</style>
