import { computed, ref, watch } from "vue";
import { useConfirmDialog } from "../../composables/useConfirmDialog";
import { useGlobalToast } from "../../composables/useGlobalToast";
import type { LauncherItem } from "../../stores/launcherStore";

export function useCategorySelection(options: {
    categoryId: () => string;
    items: import("vue").ComputedRef<LauncherItem[]>;
    itemById: import("vue").ComputedRef<Map<string, LauncherItem>>;
    store: {
        deleteLauncherItems: (categoryId: string, ids: string[]) => void;
        moveLauncherItems: (from: string, to: string, ids: string[]) => void;
        updateLauncherItems: (
            categoryId: string,
            ids: string[],
            patch: { launchDelaySeconds?: number }
        ) => void;
    };
    categoryStore: {
        categories: Array<{ id: string; name: string }>;
        getCategoryById: (id: string) => { id: string; name: string } | null | undefined;
    };
}) {
    const { confirm } = useConfirmDialog();
    const { showToast } = useGlobalToast();

    const selectedItemIds = ref<string[]>([]);
    const activeBulkPanel = ref<"move" | "edit" | null>(null);
    const bulkMoveTargetCategoryId = ref("");
    const bulkLaunchDelayInput = ref("0");

    const selectedItemIdSet = computed(() => new Set(selectedItemIds.value));
    const selectedItems = computed(() => {
        return selectedItemIds.value
            .map((itemId) => options.itemById.value.get(itemId))
            .filter((item): item is LauncherItem => item !== undefined);
    });
    const hasSelection = computed(() => selectedItemIds.value.length > 0);
    const selectedCount = computed(() => selectedItemIds.value.length);
    const availableMoveCategories = computed(() => {
        return options.categoryStore.categories.filter(
            (category) => category.id !== options.categoryId()
        );
    });

    watch(
        options.itemById,
        (nextMap) => {
            const nextSelected = selectedItemIds.value.filter((itemId) => nextMap.has(itemId));
            if (nextSelected.length !== selectedItemIds.value.length) {
                selectedItemIds.value = nextSelected;
            }
        },
        { immediate: true }
    );

    watch(hasSelection, (value) => {
        if (!value) {
            activeBulkPanel.value = null;
        }
    });

    watch(
        availableMoveCategories,
        (categories) => {
            const hasCurrentTarget = categories.some(
                (category) => category.id === bulkMoveTargetCategoryId.value
            );
            if (!hasCurrentTarget) {
                bulkMoveTargetCategoryId.value = categories[0]?.id ?? "";
            }
        },
        { immediate: true }
    );

    function isItemSelected(itemId: string): boolean {
        return selectedItemIdSet.value.has(itemId);
    }

    function clearSelection() {
        selectedItemIds.value = [];
        activeBulkPanel.value = null;
    }

    function toggleItemSelection(itemId: string) {
        if (selectedItemIdSet.value.has(itemId)) {
            selectedItemIds.value = selectedItemIds.value.filter((id) => id !== itemId);
            return;
        }
        selectedItemIds.value = [...selectedItemIds.value, itemId];
    }

    function toggleMovePanel() {
        if (availableMoveCategories.value.length === 0) return;
        if (activeBulkPanel.value === "move") {
            activeBulkPanel.value = null;
            return;
        }
        bulkMoveTargetCategoryId.value =
            bulkMoveTargetCategoryId.value || availableMoveCategories.value[0]?.id || "";
        activeBulkPanel.value = "move";
    }

    function toggleEditPanel() {
        if (activeBulkPanel.value === "edit") {
            activeBulkPanel.value = null;
            return;
        }
        const firstDelay = selectedItems.value[0]?.launchDelaySeconds ?? 0;
        const isSameDelay = selectedItems.value.every(
            (item) => item.launchDelaySeconds === firstDelay
        );
        bulkLaunchDelayInput.value = isSameDelay ? String(firstDelay) : "0";
        activeBulkPanel.value = "edit";
    }

    function closeBulkPanel() {
        activeBulkPanel.value = null;
    }

    async function onDeleteSelected() {
        if (!hasSelection.value) return;
        const count = selectedCount.value;
        const confirmed = await confirm({
            title: "批量删除启动项",
            message: `确定要删除已选中的 ${count} 个启动项吗？`,
            confirmText: "删除",
            cancelText: "取消",
        });
        if (!confirmed) return;
        options.store.deleteLauncherItems(options.categoryId(), selectedItemIds.value);
        clearSelection();
        showToast(`已删除 ${count} 个启动项`);
    }

    function onMoveSelected() {
        if (!hasSelection.value || !bulkMoveTargetCategoryId.value) return;
        const count = selectedCount.value;
        const targetCategory = options.categoryStore.getCategoryById(bulkMoveTargetCategoryId.value);
        options.store.moveLauncherItems(
            options.categoryId(),
            bulkMoveTargetCategoryId.value,
            selectedItemIds.value
        );
        clearSelection();
        showToast(
            targetCategory
                ? `已移动 ${count} 个启动项到“${targetCategory.name}”`
                : `已移动 ${count} 个启动项`
        );
    }

    function onApplyBulkEdit() {
        if (!hasSelection.value) return;
        const count = selectedCount.value;
        const parsedDelay = Number(bulkLaunchDelayInput.value);
        const normalizedDelay = Number.isFinite(parsedDelay)
            ? Math.max(0, Math.floor(parsedDelay))
            : 0;
        options.store.updateLauncherItems(options.categoryId(), selectedItemIds.value, {
            launchDelaySeconds: normalizedDelay,
        });
        clearSelection();
        bulkLaunchDelayInput.value = String(normalizedDelay);
        showToast(`已批量设置 ${count} 个启动项`);
    }

    return {
        selectedItemIds,
        activeBulkPanel,
        bulkMoveTargetCategoryId,
        bulkLaunchDelayInput,
        selectedItemIdSet,
        selectedItems,
        hasSelection,
        selectedCount,
        availableMoveCategories,
        isItemSelected,
        clearSelection,
        toggleItemSelection,
        toggleMovePanel,
        toggleEditPanel,
        closeBulkPanel,
        onDeleteSelected,
        onMoveSelected,
        onApplyBulkEdit,
    };
}
