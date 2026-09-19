import { computed, nextTick, ref, watch, type Ref } from "vue";
import type { LauncherItem } from "../../stores/launcherStore";

export type CategoryTabRegion = "search" | "items" | "back";

export function useCategoryKeyboard(options: {
    categoryId: () => string;
    visibleLauncherItems: Ref<LauncherItem[]>;
    itemById: Ref<Map<string, LauncherItem>>;
    launcherCols: Ref<number>;
    localSearchKeyword: Ref<string>;
    categoryViewRef: Ref<HTMLElement | null>;
    searchBoxFocus: () => void;
    backBtnFocus: () => void;
    onBack: () => void;
    launchItem: (item: LauncherItem) => void;
    resetSelection: () => void;
    resetSearchForCategoryChange: () => void;
    rerunSearchAfterCategoryChange: () => Promise<void>;
}) {
    const tabRegion = ref<CategoryTabRegion>("search");
    const isLauncherKeyboardNavActive = ref(false);
    const focusedLauncherIndex = ref(0);

    const focusedLauncherItemId = computed<string | null>(() => {
        const list = options.visibleLauncherItems.value;
        if (list.length === 0) return null;
        const safeIndex = Math.max(0, Math.min(focusedLauncherIndex.value, list.length - 1));
        return list[safeIndex]?.id ?? null;
    });

    function resetTabCycleState() {
        tabRegion.value = "search";
        isLauncherKeyboardNavActive.value = false;
        focusedLauncherIndex.value = 0;
    }

    function blurSearchInput() {
        const input = options.categoryViewRef.value?.querySelector<HTMLInputElement>("input.search-input");
        input?.blur();
    }

    function scrollFocusedLauncherIntoView() {
        if (!isLauncherKeyboardNavActive.value || tabRegion.value !== "items") return;
        const focusedId = focusedLauncherItemId.value;
        if (!focusedId) return;
        const node = options.categoryViewRef.value?.querySelector<HTMLElement>(
            `.icon-item[data-item-id="${focusedId}"]`
        );
        node?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    }

    function rotateTabRegion(reverse = false) {
        const order: CategoryTabRegion[] = ["search", "items", "back"];
        const step = reverse ? -1 : 1;
        const current = order.indexOf(tabRegion.value);
        const nextIndex = (current + step + order.length) % order.length;
        const nextRegion = order[nextIndex];

        if (nextRegion === "search") {
            resetTabCycleState();
            nextTick(() => {
                options.searchBoxFocus();
            });
            return;
        }

        if (nextRegion === "items") {
            tabRegion.value = "items";
            isLauncherKeyboardNavActive.value = options.visibleLauncherItems.value.length > 0;
            blurSearchInput();
            nextTick(() => {
                scrollFocusedLauncherIntoView();
            });
            return;
        }

        tabRegion.value = "back";
        isLauncherKeyboardNavActive.value = false;
        blurSearchInput();
        nextTick(() => {
            options.backBtnFocus();
        });
    }

    function moveLauncherFocusByArrow(key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight") {
        const list = options.visibleLauncherItems.value;
        if (list.length === 0) return;
        const cols = Math.max(1, options.launcherCols.value || 1);
        const current = Math.max(0, Math.min(focusedLauncherIndex.value, list.length - 1));
        let next = current;

        if (key === "ArrowLeft") next = Math.max(0, current - 1);
        if (key === "ArrowRight") next = Math.min(list.length - 1, current + 1);
        if (key === "ArrowUp") next = Math.max(0, current - cols);
        if (key === "ArrowDown") next = Math.min(list.length - 1, current + cols);

        focusedLauncherIndex.value = next;
        nextTick(() => {
            scrollFocusedLauncherIntoView();
        });
    }

    function launchFocusedLauncherItem() {
        const focusedId = focusedLauncherItemId.value;
        if (!focusedId) return;
        const item = options.itemById.value.get(focusedId);
        if (!item) return;
        options.launchItem(item);
    }

    function onCategoryKeydown(e: KeyboardEvent) {
        const hasBlockingDialog = !!document.querySelector(".confirm-overlay, .input-overlay");
        if (hasBlockingDialog) return;

        if (e.key === "Tab") {
            e.preventDefault();
            rotateTabRegion(e.shiftKey);
            return;
        }

        if (e.key === "Escape") {
            const isSearchInputTarget = e.target instanceof HTMLInputElement
                && e.target.classList.contains("search-input");
            const targetInputValue = isSearchInputTarget ? e.target.value.trim() : "";

            if (isSearchInputTarget && targetInputValue.length > 0) {
                return;
            }

            e.preventDefault();
            if (isSearchInputTarget && options.localSearchKeyword.value.trim()) {
                options.localSearchKeyword.value = "";
                return;
            }
            options.onBack();
            return;
        }

        if (tabRegion.value === "items") {
            if (e.key === "Enter") {
                e.preventDefault();
                launchFocusedLauncherItem();
                return;
            }
            if (
                e.key === "ArrowUp"
                || e.key === "ArrowDown"
                || e.key === "ArrowLeft"
                || e.key === "ArrowRight"
            ) {
                e.preventDefault();
                moveLauncherFocusByArrow(
                    e.key as "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight"
                );
            }
            return;
        }

        if (tabRegion.value === "back" && e.key === "Enter") {
            e.preventDefault();
            options.onBack();
        }
    }

    function onCategoryMouseDown(event: MouseEvent) {
        if (tabRegion.value === "search") return;
        if (!(event.target instanceof Element)) return;

        const clickedBackButton = !!event.target.closest(".back-btn");
        const clickedSearch = !!event.target.closest(".header-search");
        const clickedLauncherItem = !!event.target.closest(".icon-item[data-item-id]");

        if (clickedBackButton) {
            tabRegion.value = "back";
            isLauncherKeyboardNavActive.value = false;
            return;
        }

        if (clickedSearch) {
            resetTabCycleState();
            return;
        }

        if (clickedLauncherItem) {
            tabRegion.value = "items";
            isLauncherKeyboardNavActive.value = true;
            return;
        }

        resetTabCycleState();
    }

    watch(options.visibleLauncherItems, (list) => {
        if (list.length === 0) {
            focusedLauncherIndex.value = 0;
            if (tabRegion.value === "items") {
                tabRegion.value = "search";
                isLauncherKeyboardNavActive.value = false;
                nextTick(() => {
                    options.searchBoxFocus();
                });
            }
            return;
        }
        focusedLauncherIndex.value = Math.max(0, Math.min(focusedLauncherIndex.value, list.length - 1));
    });

    watch(
        () => options.categoryId(),
        async () => {
            resetTabCycleState();
            options.resetSelection();
            options.resetSearchForCategoryChange();
            await options.rerunSearchAfterCategoryChange();
        }
    );

    return {
        tabRegion,
        isLauncherKeyboardNavActive,
        focusedLauncherIndex,
        focusedLauncherItemId,
        resetTabCycleState,
        onCategoryKeydown,
        onCategoryMouseDown,
        rotateTabRegion,
    };
}

export function useCategoryPointer(options: {
    isWindowFocused: Ref<boolean>;
    hasSelection: Ref<boolean>;
    itemById: Ref<Map<string, LauncherItem>>;
    toggleItemSelection: (itemId: string) => void;
    launchItem: (item: LauncherItem) => void;
}) {
    let pressTimer: ReturnType<typeof setTimeout> | null = null;
    let pressedItemId: string | null = null;
    let pointerMode: "launch" | "select" | null = null;
    let selectionHandledOnMouseDownItemId: string | null = null;
    let suppressDragForCurrentPress = false;
    const PRESS_THRESHOLD = 200;

    function clearPointerState() {
        if (pressTimer) {
            clearTimeout(pressTimer);
        }
        pressTimer = null;
        pressedItemId = null;
        pointerMode = null;
        suppressDragForCurrentPress = false;
    }

    function hasSelectionModifier(event: PointerEvent): boolean {
        return event.ctrlKey || event.metaKey;
    }

    function hasMouseSelectionModifier(event: MouseEvent): boolean {
        return event.ctrlKey || event.metaKey;
    }

    function onMouseDown(itemId: string, event: MouseEvent) {
        if (event.button !== 0) return;
        suppressDragForCurrentPress = !options.isWindowFocused.value;

        if (!options.hasSelection.value && !hasMouseSelectionModifier(event)) return;

        event.stopPropagation();
        clearPointerState();
        suppressDragForCurrentPress = !options.isWindowFocused.value;
        selectionHandledOnMouseDownItemId = itemId;
        options.toggleItemSelection(itemId);
    }

    function onPointerDown(itemId: string, e: PointerEvent) {
        if (e.button !== 0) return;
        const selectionHandledOnMouseDown = selectionHandledOnMouseDownItemId === itemId;
        if (
            selectionHandledOnMouseDown ||
            suppressDragForCurrentPress ||
            options.hasSelection.value ||
            hasSelectionModifier(e)
        ) {
            e.stopPropagation();
        }

        if (selectionHandledOnMouseDown) {
            clearPointerState();
            return;
        }

        clearPointerState();
        suppressDragForCurrentPress = !options.isWindowFocused.value;
        pressedItemId = itemId;

        if (options.hasSelection.value || hasSelectionModifier(e)) {
            pointerMode = "select";
            return;
        }

        pointerMode = "launch";
        pressTimer = setTimeout(() => {
            clearPointerState();
        }, PRESS_THRESHOLD);
    }

    function onPointerUp(itemId: string, e: PointerEvent) {
        if (e.button !== 0) return;
        if (selectionHandledOnMouseDownItemId === itemId) {
            selectionHandledOnMouseDownItemId = null;
            clearPointerState();
            return;
        }

        if (pressedItemId !== itemId) {
            clearPointerState();
            return;
        }

        if (pointerMode === "select") {
            options.toggleItemSelection(itemId);
            clearPointerState();
            return;
        }

        if (pressTimer && pointerMode === "launch") {
            clearTimeout(pressTimer);
            pressTimer = null;
            const item = options.itemById.value.get(itemId);
            if (item) {
                options.launchItem(item);
            }
        }

        clearPointerState();
    }

    function onPointerLeave() {
        selectionHandledOnMouseDownItemId = null;
        clearPointerState();
    }

    return {
        onMouseDown,
        onPointerDown,
        onPointerUp,
        onPointerLeave,
    };
}
