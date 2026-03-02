<template>
    <div
        data-menu-type="categorie-view"
        class="categorie-view"
        :class="{ 'is-editing': isEditingCategory }"
    >
        <draggable
            v-model="categories"
            item-key="id"
            class="categorie-container"
            :style="{ '--cols': categoryCols }"
            ghost-class="categorie-ghost"
            chosen-class="categorie-chosen"
            drag-class="categorie-drag"
            :delay="200"
            :delay-on-touch-only="false"
            :animation="150"
            :force-fallback="true"
            fallback-class="categorie-drag"
            :fallback-tolerance="5"
            data-menu-type="categorie-view"
            :disabled="isEditingCategory"
        >
            <template #item="{ element }">
                <div
                    class="categorie-item"
                    :class="{
                        editing:
                            isEditingCategory &&
                            element.id === editingCategoryId,
                    }"
                    @contextmenu.self="1"
                    data-menu-type="categorie"
                    :data-category-id="element.id"
                    @click="onClickCategory(element)"
                >
                    <template
                        v-if="
                            isEditingCategory &&
                            element.id === editingCategoryId
                        "
                    >
                        <input
                            :ref="setEditingInputRef"
                            v-model="editingCategoryName"
                            class="categorie-input"
                            data-menu-type="categorie"
                            :data-category-id="element.id"
                            @click.stop
                            @mousedown.stop
                            @keydown.enter.stop.prevent="onConfirmCategoryEdit"
                        />
                    </template>
                    <template v-else>
                        {{ element.name }}
                    </template>
                </div>
            </template>
        </draggable>
    </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import type { ComponentPublicInstance } from "vue";
import { useRouter } from "vue-router";
import { Store } from "../stores";
import type { Category } from "../stores";
import { storeToRefs } from "pinia";
import draggable from "vuedraggable";

const store = Store();
const router = useRouter();
const {
    categories,
    categoryCols,
    editingCategoryId,
    editingCategoryName,
    isEditingCategory,
} = storeToRefs(store);
const editingInputRef = ref<HTMLInputElement | null>(null);

/**
 * 点击类目时，进入该类目的启动台页面。
 */
function onClickCategory(element: Category) {
    if (isEditingCategory.value) return;
    store.setCurrentCategory(element.id);
    router.push({ name: "category", params: { categoryId: element.id } });
}

/**
 * 设置当前编辑输入框的引用。
 */
function setEditingInputRef(el: Element | ComponentPublicInstance | null) {
    editingInputRef.value = el as HTMLInputElement | null;
}

/**
 * 提交类目名称的编辑结果。
 */
function onConfirmCategoryEdit() {
    store.confirmCategoryEdit(editingCategoryName.value);
}

/**
 * 当进入编辑状态时自动聚焦输入框。
 */
watch(editingCategoryId, async (value) => {
    if (!value) return;
    await nextTick();
    editingInputRef.value?.focus();
    editingInputRef.value?.select();
});
</script>

<style lang="scss" scoped>
.categorie-view {
    width: 100vw;
    height: 100vh;
}
.categorie-view.is-editing {
    pointer-events: none;
}
.categorie-container {
    display: flex;
    padding: 16px;
    flex-wrap: wrap;
    --gap: 16px;
    --cols: 5;
    gap: var(--gap);
    .categorie-item {
        overflow: hidden;
        flex: 0 0 calc((100% - (var(--gap) * (var(--cols) - 1))) / var(--cols));
        aspect-ratio: 1 / 1;
        opacity: 0.8;
        border-radius: 22px;
        // 居中显示文本
        display: flex;
        align-items: center;
        justify-content: center;
        color: #4d4d4d;
        font-size: 16px;
        font-weight: bold;
        background-color: #fff;
        // 不可选中文字
        user-select: none;
        // 阴影
        box-shadow: 0 0 10px rgba(0, 0, 0, 0.4);
    }
    .categorie-item.editing {
        pointer-events: auto;
        animation: categorie-editing-shadow 1.2s ease-in-out infinite;
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
    
}

@keyframes categorie-editing-shadow {
    0% {
        box-shadow: 0 0 6px rgba(0, 0, 0, 0.12), 0 0 12px rgba(74, 116, 255, 0.3);
    }
    50% {
        box-shadow: 0 0 12px rgba(0, 0, 0, 0.3), 0 0 22px rgba(74, 116, 255, 0.85);
    }
    100% {
        box-shadow: 0 0 6px rgba(0, 0, 0, 0.12), 0 0 12px rgba(74, 116, 255, 0.3);
    }
}
</style>
