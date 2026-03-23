<template>
    <div class="home-card" :class="{
        'is-launching': isLaunching,
        'is-success': isSuccess
    }" :data-menu-type="menuType" :data-home-section="homeSection" :data-category-id="categoryId"
        :data-item-id="itemId" v-on="longpressHandlers" @click="$emit('click')">
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
import { computed } from "vue";
import { useLongPress } from "../../composables/useLongPress";

const props = defineProps<{
    itemId: string;
    categoryId: string;
    name: string;
    iconBase64?: string | null;
    menuType?: string;
    homeSection?: string;
    launchStatus?: "launching" | "success" | undefined;
    cols?: number;
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

const isLaunching = computed(() => props.launchStatus === "launching");
const isSuccess = computed(() => props.launchStatus === "success");
const hideName = computed(() => (props.cols ?? 5) >= 7);

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
    transition: background 0.15s ease;
    box-shadow: var(--card-shadow-light);
    border: 1px solid var(--border-color, transparent);
    min-width: 0;
    position: relative;

    &:hover {
        background: var(--card-bg-hover);
    }

    &.is-launching {
        animation: launching-shadow 1.2s ease-in-out infinite;
    }

    &.is-success {
        animation: success-shadow 1.2s ease-in-out infinite;
    }
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
    // width: 34px;
    // height: 34px;
    aspect-ratio: 1 / 1;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;

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
