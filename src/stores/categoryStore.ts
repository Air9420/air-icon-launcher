import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { createVersionedPersistConfig } from "../utils/versioned-persist";

export type Category = {
    id: string;
    name: string;
    customIconBase64: string | null;
};

export const useCategoryStore = defineStore(
    "category",
    () => {
        const editingCategoryId = ref<string | null>(null);
        const editingCategoryName = ref<string>("");
        const isEditingCategory = computed(() => editingCategoryId.value !== null);
        const currentCategoryId = ref<string | null>(null);
        const isNewCategory = ref<boolean>(false);

        const categories = ref<Category[]>([
            { id: "cat-0", name: "Air", customIconBase64: null },
            { id: "cat-1", name: "游戏", customIconBase64: null },
            { id: "cat-2", name: "工具", customIconBase64: null },
            { id: "cat-3", name: "系统", customIconBase64: null },
            { id: "cat-4", name: "其他", customIconBase64: null },
        ]);

        function createCategoryId() {
            return `cat-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        }

        function setCurrentCategory(categoryId: string | null) {
            currentCategoryId.value = categoryId;
        }

        function getCategoryById(categoryId: string) {
            return categories.value.find((item) => item.id === categoryId) || null;
        }

        function beginAddCategory() {
            const newCategory = { id: createCategoryId(), name: "", customIconBase64: null };
            categories.value.push(newCategory);
            editingCategoryId.value = newCategory.id;
            editingCategoryName.value = "";
            isNewCategory.value = true;
        }

        function beginRenameCategory(categoryId: string) {
            const target = categories.value.find((item) => item.id === categoryId);
            if (!target) return;
            editingCategoryId.value = categoryId;
            editingCategoryName.value = target.name;
            isNewCategory.value = false;
        }

        function confirmCategoryEdit(name: string) {
            if (!editingCategoryId.value) return;
            const target = categories.value.find((item) => item.id === editingCategoryId.value);
            if (target) {
                target.name = name.trim();
            }
            editingCategoryId.value = null;
            editingCategoryName.value = "";
            isNewCategory.value = false;
        }

        function cancelCategoryEdit() {
            if (isNewCategory.value && editingCategoryId.value) {
                const index = categories.value.findIndex((item) => item.id === editingCategoryId.value);
                if (index !== -1) {
                    categories.value.splice(index, 1);
                }
            }
            editingCategoryId.value = null;
            editingCategoryName.value = "";
            isNewCategory.value = false;
        }

        function deleteCategory(categoryId: string) {
            const index = categories.value.findIndex((item) => item.id === categoryId);
            if (index === -1) return;
            categories.value.splice(index, 1);
            if (editingCategoryId.value === categoryId) {
                editingCategoryId.value = null;
                editingCategoryName.value = "";
            }
            if (currentCategoryId.value === categoryId) {
                currentCategoryId.value = null;
            }
        }

        function setCategoryIcon(categoryId: string, iconBase64: string) {
            const target = categories.value.find((item) => item.id === categoryId);
            if (target) {
                target.customIconBase64 = iconBase64;
            }
        }

        function resetCategoryIcon(categoryId: string) {
            const target = categories.value.find((item) => item.id === categoryId);
            if (target) {
                target.customIconBase64 = null;
            }
        }

        function importCategories(newCategories: Category[]) {
            categories.value = newCategories;
        }

        function reorderCategories(newOrder: Category[]) {
            categories.value = newOrder;
        }

        return {
            editingCategoryId,
            editingCategoryName,
            isEditingCategory,
            currentCategoryId,
            isNewCategory,
            categories,
            createCategoryId,
            setCurrentCategory,
            getCategoryById,
            beginAddCategory,
            beginRenameCategory,
            confirmCategoryEdit,
            cancelCategoryEdit,
            deleteCategory,
            setCategoryIcon,
            resetCategoryIcon,
            importCategories,
            reorderCategories,
        };
    },
    { persist: createVersionedPersistConfig("category", ["categories", "currentCategoryId"]) }
);
