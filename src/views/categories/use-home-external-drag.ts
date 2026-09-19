import { computed, ref } from "vue";
import { showToast } from "../../composables/useGlobalToast";
import { Store, useCategoryStore } from "../../stores";
import { useStatsStore } from "../../stores/statsStore";
import { normalizePathForCompare } from "./home-hydration-helpers";

export const EXTERNAL_CONVERT_DRAG_EVENT = "external-convert-drag-start";

type ExternalConvertDragPayload = {
    itemPath: string;
    clientX: number;
    clientY: number;
};

export function useHomeExternalDrag() {
    const store = Store();
    const categoryStore = useCategoryStore();
    const statsStore = useStatsStore();

    const externalConvertDragVisible = ref(false);
    const externalConvertDragPath = ref("");
    const externalConvertDragName = ref("");
    const externalConvertDragIconBase64 = ref<string | null>(null);
    const externalConvertPointerId = ref<number | null>(null);
    const externalConvertPointerX = ref(0);
    const externalConvertPointerY = ref(0);

    const externalConvertGhostStyle = computed(() => ({
        left: `${externalConvertPointerX.value}px`,
        top: `${externalConvertPointerY.value}px`,
    }));

    function findExternalRecordByPath(path: string) {
        const normalized = normalizePathForCompare(path);
        return statsStore.externalRecentLaunches.find(
            (entry) => normalizePathForCompare(entry.path) === normalized
        );
    }

    function tryResolveCategoryIdFromPoint(x: number, y: number): string | null {
        const elements = document.elementsFromPoint(x, y);
        for (const element of elements) {
            if (!(element instanceof HTMLElement)) continue;
            const target = element.closest(".categorie-item[data-category-id]");
            if (!(target instanceof HTMLElement)) continue;
            const categoryId = target.dataset.categoryId || null;
            if (categoryId) return categoryId;
        }
        return null;
    }

    function addExternalPathToCategory(path: string, categoryId: string): boolean {
        const category = categoryStore.getCategoryById(categoryId);
        if (!category) return false;

        const normalizedPath = normalizePathForCompare(path);
        const duplicateExists = store
            .getLauncherItemsByCategoryId(categoryId)
            .some((item) => item.itemType === "file" && normalizePathForCompare(item.path) === normalizedPath);
        if (duplicateExists) {
            showToast(`「${category.name}」中已存在该启动项`);
            return false;
        }

        const externalRecord = findExternalRecordByPath(path);
        const createdItemIds = store.addLauncherItemsToCategory(categoryId, {
            paths: [path],
            directories: [],
            icon_base64s: [externalRecord?.iconBase64 ?? null],
            itemTypes: ["file"],
        });
        const createdItemId = createdItemIds[0];
        if (createdItemId) {
            store.recordItemUsage(
                categoryId,
                createdItemId,
                externalRecord?.usedAt ?? Date.now()
            );
        }
        showToast(`已添加到「${category.name}」`);
        return true;
    }

    function onExternalConvertDragStart(event: CustomEvent<ExternalConvertDragPayload>) {
        const payload = event.detail;
        const rawPath = payload?.itemPath?.trim() || "";
        if (!rawPath) return;

        const record = findExternalRecordByPath(rawPath);
        externalConvertDragPath.value = rawPath;
        externalConvertDragName.value =
            record?.name ||
            rawPath.split(/[\\/]/).pop() ||
            rawPath;
        externalConvertDragIconBase64.value = record?.iconBase64 || null;
        externalConvertDragVisible.value = true;
        externalConvertPointerId.value = null;
        externalConvertPointerX.value = Number.isFinite(payload.clientX)
            ? payload.clientX
            : window.innerWidth / 2;
        externalConvertPointerY.value = Number.isFinite(payload.clientY)
            ? payload.clientY
            : window.innerHeight / 2;
    }

    function onExternalConvertPointerMove(event: PointerEvent) {
        if (!externalConvertDragVisible.value) return;
        if (
            externalConvertPointerId.value !== null &&
            event.pointerId !== externalConvertPointerId.value
        ) {
            return;
        }
        externalConvertPointerId.value = event.pointerId;
        externalConvertPointerX.value = event.clientX;
        externalConvertPointerY.value = event.clientY;
    }

    function onExternalConvertPointerUp(event: PointerEvent) {
        if (!externalConvertDragVisible.value) return;
        if (
            externalConvertPointerId.value !== null &&
            event.pointerId !== externalConvertPointerId.value
        ) {
            return;
        }

        const targetCategoryId = tryResolveCategoryIdFromPoint(event.clientX, event.clientY);
        if (!targetCategoryId) {
            cancelExternalConvertDrag();
            return;
        }

        addExternalPathToCategory(externalConvertDragPath.value, targetCategoryId);
        cancelExternalConvertDrag();
    }

    function cancelExternalConvertDrag() {
        externalConvertDragVisible.value = false;
        externalConvertDragPath.value = "";
        externalConvertDragName.value = "";
        externalConvertDragIconBase64.value = null;
        externalConvertPointerId.value = null;
    }

    return {
        externalConvertDragVisible,
        externalConvertDragName,
        externalConvertGhostStyle,
        onExternalConvertDragStart,
        onExternalConvertPointerMove,
        onExternalConvertPointerUp,
        cancelExternalConvertDrag,
    };
}
