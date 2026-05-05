<template>
    <div class="home-card" :class="{
        'is-launching': isLaunching,
        'is-success': isSuccess,
        'is-selected': !!isSelected
    }" :data-menu-type="menuType" :data-home-section="homeSection" :data-category-id="categoryId"
        :data-item-id="itemId" :data-item-path="itemPath || ''" v-on="longpressHandlers" @pointerdown="onPointerDown" @pointerup="onPointerUp"
        @pointerleave="onPointerLeave" data-no-drag>
        <div
            v-if="cornerBadgeText"
            class="corner-badge"
            :class="{ 'is-feature-badge': !!featureBadgeText }"
        >
            {{ cornerBadgeText }}
        </div>
        <div
            v-if="showShortcutBadge && shortcutIndex !== undefined && shortcutIndex >= 0 && shortcutIndex <= 9"
            class="shortcut-badge"
        >
            {{ shortcutIndex === 9 ? 0 : shortcutIndex + 1 }}
        </div>
        <div class="home-card-main">
            <div class="home-card-icon">
                <img v-if="iconBase64" class="icon-real" :src="getIconSrc(iconBase64)" alt="" draggable="false" />
                <div v-else class="icon-fallback">
                    {{ fallbackText }}
                </div>
            </div>
        </div>
        <div class="home-card-footer" v-if="!hideName">
            <div class="home-card-subtitle" :title="name">
                {{ name }}
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useLongPress } from "../../composables/useLongPress";

const props = defineProps<{
    itemId: string;
    categoryId: string;
    itemPath?: string | null;
    name: string;
    iconBase64?: string | null;
    itemType?: 'file' | 'url';
    hasDependencies?: boolean;
    featureBadgeText?: string;
    menuType?: string;
    homeSection?: string;
    launchStatus?: "launching" | "success" | undefined;
    cols?: number;
    shortcutIndex?: number;
    showShortcutBadge?: boolean;
    isSelected?: boolean;
}>();

const emit = defineEmits<{
    (e: "click"): void;
    (e: "longpress"): void;
}>();

const { handlers: longpressHandlers } = useLongPress({
    onLongPress: () => {
        emit("longpress");
    },
});

const PRESS_THRESHOLD = 200;
const pressTimer = ref<ReturnType<typeof setTimeout> | null>(null);

function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    pressTimer.value = setTimeout(() => {
        pressTimer.value = null;
    }, PRESS_THRESHOLD);
}

function onPointerUp() {
    if (pressTimer.value) {
        clearTimeout(pressTimer.value);
        pressTimer.value = null;
        emit("click");
    }
}

function onPointerLeave() {
    if (pressTimer.value) {
        clearTimeout(pressTimer.value);
        pressTimer.value = null;
    }
}

const isLaunching = computed(() => props.launchStatus === "launching");
const isSuccess = computed(() => props.launchStatus === "success");
const hideName = computed(() => (props.cols ?? 5) >= 7);
const featureBadgeText = computed(() => props.featureBadgeText?.trim() || "");
const badgeText = computed(() => {
    if (props.itemType === "url") return "URL";
    if (props.hasDependencies) return "依赖";
    return "";
});
const cornerBadgeText = computed(() => {
    if (featureBadgeText.value) {
        return badgeText.value
            ? `${featureBadgeText.value}:${badgeText.value}`
            : featureBadgeText.value;
    }

    return badgeText.value;
});

const fallbackText = computed(() => {
    const text = props.name?.trim() || "";
    if (!text) return "?";
    return text.slice(0, 1).toUpperCase();
});

function getIconSrc(iconBase64: string) {
    if (iconBase64.startsWith("data:")) return iconBase64;
    return `data:image/png;base64,${iconBase64}`;
}
</script>

<style lang="scss" scoped>
.home-card {
    aspect-ratio: 1 / 1;
    display: flex;
    flex-direction: column;
    padding: min(8px, 5%);
    background: var(--card-bg-solid);
    border-radius: 10px;
    cursor: pointer;
    transition: background 0.15s ease, transform 0.2s ease, box-shadow 0.2s ease;
    box-shadow: var(--card-shadow-light);
    border: 1px solid var(--border-color, transparent);
    min-width: 0;
    position: relative;
    scroll-margin-top: 8px;
    scroll-margin-bottom: 8px;

    &:hover {
        background: var(--card-bg-hover);

        @media (hover: hover) {
            transform: scale(calc(1 + 0.05 * (1 - var(--performance-mode, 0))));
            box-shadow: var(--card-shadow-light), 0 4px 12px calc(0px * var(--performance-mode, 0)) rgba(0, 0, 0, 0.15);
        }
    }

    &.is-launching {
        animation: launching-shadow 1.2s ease-in-out infinite;
    }

    &.is-success {
        animation: success-shadow 1.2s ease-in-out infinite;
    }

    &.is-selected {
        background: var(--card-bg-hover);
        box-shadow: 0 0 0 2px var(--primary-color, #0078d4), var(--card-shadow-light);
    }
}

.corner-badge {
    position: absolute;
    top: 4px;
    left: 4px;
    z-index: 1;
    padding: 1px 4px;
    font-size: 8px;
    font-weight: 600;
    color: #fff;
    border-radius: 4px;
    background: #3b82f6;
}

.corner-badge.is-feature-badge {
    background: linear-gradient(135deg, #f59e0b, #f97316);
}

.shortcut-badge {
    position: absolute;
    top: -8px;
    right: -18px;
    transform: translateX(-50%);
    z-index: 1;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--primary-color);
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    // line-height: 18px;
    pointer-events: none;
}

.home-card-main {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
}

.home-card-icon {
    aspect-ratio: 1 / 1;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    overflow: hidden;

    .icon-real {
        width: 100%;
        height: 100%;
        object-fit: contain;
    }

    .icon-fallback {
        width: 100%;
        height: 100%;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--bg-color-secondary);
        font-weight: 800;
        color: var(--text-color);
        font-size: 14px;
    }
}

.home-card-footer {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 min(4px, 5%);
}

.home-card-subtitle {
    flex: 1;
    min-width: 0;
    font-size: 10px;
    color: var(--text-color-tertiary);
    text-align: center;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}

@keyframes launching-shadow {
    0% {
        box-shadow: 0 0 0 2px rgba(0, 120, 212, 0.3), var(--card-shadow-light);
    }

    50% {
        box-shadow: 0 0 0 4px rgba(0, 120, 212, 0.6), var(--card-shadow-light);
    }

    100% {
        box-shadow: 0 0 0 2px rgba(0, 120, 212, 0.3), var(--card-shadow-light);
    }
}

@keyframes success-shadow {
    0% {
        box-shadow: 0 0 6px rgba(0, 0, 0, 0.3), 0 0 12px rgba(76, 175, 80, 0.3);
    }

    50% {
        box-shadow: 0 0 12px rgba(0, 0, 0, 0.3), 0 0 33px rgba(76, 175, 80, 0.6);
    }

    100% {
        box-shadow: 0 0 6px rgba(0, 0, 0, 0.3), 0 0 12px rgba(76, 175, 80, 0.3);
    }
}
</style>
