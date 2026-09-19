/**
 * Category domain actions: add / delete / rename / category icon.
 */
import { menuDeleteCategoryItems } from "../../menus/menuAppsGateway";
import type { CategoryActions, MenuActionDeps } from "./types";

export function createCategoryActions(deps: MenuActionDeps): CategoryActions {
    const {
        options: { currentCategoryId, closeContextMenu, confirm },
        store,
        categoryStore,
        statsStore,
    } = deps;

    function onAddCategory() {
        if (categoryStore.isEditingCategory) return;
        categoryStore.beginAddCategory();
        closeContextMenu();
    }

    async function onDeleteCategory() {
        if (categoryStore.isEditingCategory) return;
        if (!currentCategoryId.value) return;

        const confirmed = await confirm({
            title: "确认删除",
            message: "确定要删除此分类吗？该分类下的所有启动项也将被删除。",
            confirmText: "删除",
            cancelText: "取消",
        });

        if (!confirmed) {
            closeContextMenu();
            return;
        }

        categoryStore.deleteCategory(currentCategoryId.value);
        menuDeleteCategoryItems(store, statsStore, currentCategoryId.value);
        closeContextMenu();
    }

    function onRenameCategory() {
        if (categoryStore.isEditingCategory) return;
        if (!currentCategoryId.value) return;
        categoryStore.beginRenameCategory(currentCategoryId.value);
        closeContextMenu();
    }

    function onChangeCategoryIcon(base64: string) {
        if (!currentCategoryId.value) return;
        categoryStore.setCategoryIcon(currentCategoryId.value, base64);
    }

    function onResetCategoryIcon() {
        if (!currentCategoryId.value) return;
        categoryStore.resetCategoryIcon(currentCategoryId.value);
    }

    return {
        onAddCategory,
        onDeleteCategory,
        onRenameCategory,
        onChangeCategoryIcon,
        onResetCategoryIcon,
    };
}
