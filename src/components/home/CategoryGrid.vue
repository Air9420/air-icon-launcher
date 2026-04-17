<template>
    <draggable
        :model-value="categories"
        item-key="id"
        class="categorie-container"
        :style="{ '--cols': cols }"
        ghost-class="categorie-ghost"
        chosen-class="categorie-chosen"
        drag-class="categorie-drag"
        :delay="200"
        :delay-on-touch-only="false"
        :animation="150"
        :force-fallback="true"
        fallback-class="categorie-drag"
        :fallback-tolerance="5"
        data-menu-type="Home-Group-View"
        :disabled="isEditing"
        @update:model-value="$emit('update:categories', $event)"
    >
        <template #item="{ element }">
            <div
                class="categorie-item"
                :class="{
                    editing: isEditing && element.id === editingCategoryId,
                }"
                data-menu-type="Home-Group-Item"
                :data-category-id="element.id"
                @click="$emit('select', element)"
                data-no-drag
            >
                <template v-if="isEditing && element.id === editingCategoryId">
                    <input
                        ref="editingInputRef"
                        :value="editingCategoryName"
                        class="categorie-input"
                        :data-category-id="element.id"
                        @click.stop
                        @mousedown.stop
                        @input="$emit('update:editingCategoryName', ($event.target as HTMLInputElement).value)"
                        @keydown.enter.stop.prevent="$emit('confirm-edit')"
                        @keydown.escape.stop.prevent="$emit('cancel-edit')"
                        @blur="$emit('cancel-edit')"
                    />
                </template>
                <template v-else>
                    <div
                        v-if="element.customIconBase64"
                        class="categorie-icon-wrapper"
                        :data-category-id="element.id"
                    >
                        <img
                            :src="getIconSrc(element.customIconBase64)"
                            class="categorie-icon"
                            alt=""
                            draggable="false"
                            :data-category-id="element.id"
                        />
                    </div>
                    <div
                        v-else
                        class="categorie-name-text"
                        :style="{ fontSize: getNameFontSize(element.name) + 'px' }"
                        :data-category-id="element.id"
                    >
                        <span
                            v-for="(chunk, idx) in splitName(element.name)"
                            :key="idx"
                            class="name-chunk"
                        >{{ chunk }}</span>
                    </div>
                </template>
            </div>
        </template>
    </draggable>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from "vue";
import draggable from "vuedraggable";
import type { Category } from "../../stores";

const props = defineProps<{
    categories: Category[];
    cols: number;
    isEditing: boolean;
    editingCategoryId: string | null;
    editingCategoryName: string;
    isNewCategory?: boolean;
}>();

defineEmits<{
    (e: "update:categories", categories: Category[]): void;
    (e: "update:editingCategoryName", name: string): void;
    (e: "select", category: Category): void;
    (e: "confirm-edit"): void;
    (e: "cancel-edit"): void;
}>();

const editingInputRef = ref<HTMLInputElement | null>(null);

watch(
    () => props.editingCategoryId,
    async (newId) => {
        if (newId) {
            await nextTick();
            await nextTick();
            if (editingInputRef.value) {
                editingInputRef.value.focus();
                if (props.isNewCategory) {
                    editingInputRef.value.select();
                } else {
                    const len = editingInputRef.value.value.length;
                    editingInputRef.value.setSelectionRange(len, len);
                }
                scrollToEditingCategory();
            }
        }
    },
    { immediate: true }
);

function scrollToEditingCategory() {
    if (!editingInputRef.value) return;
    const container = editingInputRef.value.closest('.categorie-container');
    if (!container) return;
    
    const item = editingInputRef.value.closest('.categorie-item');
    if (!item) return;
    
    const containerRect = container.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    
    const isFullyVisible = 
        itemRect.top >= containerRect.top &&
        itemRect.bottom <= containerRect.bottom &&
        itemRect.left >= containerRect.left &&
        itemRect.right <= containerRect.right;
    
    if (!isFullyVisible) {
        item.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
}

function getIconSrc(iconBase64: string) {
    if (iconBase64.startsWith("data:")) return iconBase64;
    return `data:image/png;base64,${iconBase64}`;
}

function splitName(name: string): string[] {
    const isCjk = (char: string) => /[\u4e00-\u9fa5\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(char);

    const cjkChars: string[] = [];
    let otherChars = "";

    for (const char of name) {
        if (isCjk(char)) {
            if (otherChars) {
                cjkChars.push(otherChars);
                otherChars = "";
            }
            cjkChars.push(char);
        } else {
            otherChars += char;
        }
    }
    if (otherChars) {
        cjkChars.push(otherChars);
    }

    if (cjkChars.length <= 3) {
        return [name];
    }

    const result: string[] = [];
    for (let i = 0; i < cjkChars.length; i += 2) {
        if (i + 1 < cjkChars.length) {
            result.push(cjkChars[i] + cjkChars[i + 1]);
        } else {
            result.push(cjkChars[i]);
        }
    }

    return result;
}

function getNameFontSize(name: string): number {
    const chunks = splitName(name);
    const displayLines = chunks.length;
    if (displayLines <= 1) return 16;
    if (displayLines === 2) return 14;
    if (displayLines === 3) return 12;
    return 10;
}
</script>

<style lang="scss" scoped>
.categorie-container {
    display: grid;
    grid-template-columns: repeat(var(--cols), 1fr);
    grid-auto-rows: max-content;
    padding: 16px;
    flex-wrap: wrap;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: none;
    -ms-overflow-style: none;
    &::-webkit-scrollbar {
        display: none;
    }
    --gap: 8px;
    --cols: 5;
    gap: var(--gap);
    .categorie-item {
        overflow: hidden;
        flex: 0 0 auto;

        aspect-ratio: 1 / 1;
        opacity: 0.8;
        border-radius: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-color);
        font-size: 16px;
        font-weight: bold;
        background-color: var(--card-bg-solid);
        user-select: none;
        cursor: pointer;
        box-shadow: var(--card-shadow-light);
        transition: transform 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease;

        &:hover {
            @media (hover: hover) {
                transform: scale(calc(1 + 0.05 * (1 - var(--performance-mode, 0))));
                box-shadow: var(--card-shadow-light), 0 4px 12px calc(0px * var(--performance-mode, 0)) rgba(0, 0, 0, 0.15);
                opacity: 1;
            }
        }
    }
    .categorie-item.editing {
        pointer-events: auto;
        cursor: text;
        animation: categorie-editing-shadow 1.2s ease-in-out infinite;
    }
    .categorie-icon-wrapper {
        width: 60%;
        height: 60%;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    .categorie-icon {
        width: 100%;
        height: 100%;
        object-fit: contain;
    }
    .categorie-name-text {
        text-align: center;
        margin: 8px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        .name-chunk {
            display: block;
            line-height: 1.2;
        }
    }
}

.categorie-ghost {
    opacity: 0.4;
}

.categorie-chosen {
    cursor: grabbing;
}

.categorie-drag {
    cursor: grabbing;
    transition: none !important;

    .categorie-item {
        transition: none !important;
    }
}

.categorie-input {
    width: 80%;
    height: 24px;
    padding: 0;
    border: none;
    font-size: 14px;
    text-align: center;
    font-weight: bold;
    outline: none;
    pointer-events: auto;
    position: relative;
    background: transparent;
    color: var(--text-color);
}

@keyframes categorie-editing-shadow {
    0% {
        box-shadow: var(--editing-shadow-1);
    }
    50% {
        box-shadow: var(--editing-shadow-2);
    }
    100% {
        box-shadow: var(--editing-shadow-1);
    }
}
</style>
